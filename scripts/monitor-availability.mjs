import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_JSON_BYTES = 16 * 1024
const MAX_HTML_BYTES = 256 * 1024
const ALLOWED_FAULTS = new Set(['none', 'expected_version_mismatch'])
const RELEASE_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,48})?$/u
const RELEASE_SHA = /^[a-f0-9]{40}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ASSET_NAME = /^app-[0-9A-Za-z._-]{1,120}\.js$/u

function elapsedMs(startedAt, now) {
  return Math.max(0, Math.round(now() - startedAt))
}

function failedProbe(id, code, durationMs = 0, extra = {}) {
  return { id, outcome: 'failed', code, durationMs, ...extra }
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) return { bytes: 0, text: '' }
  const declaredBytes = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body.cancel().catch(() => undefined)
    throw new Error('response_too_large')
  }

  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.length
      if (bytes > maxBytes) throw new Error('response_too_large')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return { bytes, text: new TextDecoder().decode(body) }
}

async function requestBounded({
  fetchImpl,
  url,
  method = 'GET',
  headers = {},
  timeoutMs,
  maxBytes,
  now,
}) {
  const controller = new AbortController()
  const startedAt = now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return {
        ok: false,
        code: 'http_error',
        status: response.status,
        durationMs: elapsedMs(startedAt, now),
        responseBytes: 0,
        text: '',
      }
    }
    const body = method === 'HEAD'
      ? { bytes: 0, text: '' }
      : await readBoundedBody(response, maxBytes)
    const result = {
      ok: response.ok,
      status: response.status,
      durationMs: elapsedMs(startedAt, now),
      responseBytes: body.bytes,
      text: body.text,
    }
    return result
  } catch (error) {
    return {
      ok: false,
      code: controller.signal.aborted || error?.name === 'AbortError'
        ? 'timeout'
        : error?.message === 'response_too_large'
          ? 'response_too_large'
          : 'network_error',
      durationMs: elapsedMs(startedAt, now),
      responseBytes: 0,
      text: '',
    }
  } finally {
    clearTimeout(timer)
  }
}

function responseFailure(id, response) {
  return failedProbe(id, response.code ?? 'http_error', response.durationMs, {
    ...(Number.isInteger(response.status) ? { httpStatus: response.status } : {}),
    responseBytes: response.responseBytes,
  })
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function findAppAsset(html, pagesBaseUrl) {
  const base = new URL(pagesBaseUrl)
  const assetBasePath = new URL('assets/', base).pathname
  const candidates = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/giu)]
  for (const match of candidates) {
    const asset = new URL(match[1], base)
    const assetName = asset.pathname.split('/').at(-1) ?? ''
    if (asset.origin === base.origin && asset.pathname.startsWith(assetBasePath) && ASSET_NAME.test(assetName)) {
      return asset
    }
  }
  return null
}

function validateConfiguration(config) {
  const failures = []
  try {
    const pages = new URL(config.pagesBaseUrl)
    if (pages.protocol !== 'https:') failures.push('pages_url_invalid')
  } catch {
    failures.push('pages_url_invalid')
  }
  try {
    const supabase = new URL(config.supabaseUrl)
    if (supabase.protocol !== 'https:') failures.push('supabase_url_invalid')
  } catch {
    failures.push('supabase_url_invalid')
  }
  if (!config.supabasePublicKey) failures.push('supabase_public_key_missing')
  if (!RELEASE_VERSION.test(config.expectedVersion)) failures.push('expected_version_invalid')
  if (!RELEASE_SHA.test(config.expectedSourceSha)) failures.push('expected_source_sha_invalid')
  if (!ALLOWED_FAULTS.has(config.faultMode)) failures.push('fault_mode_invalid')
  return failures
}

function syntheticExpectedVersion(observedVersion) {
  return `${observedVersion}-expected-version-mismatch`
}

export async function runAvailabilityMonitor(input) {
  const now = input.now ?? Date.now
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, input.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS))
  const config = {
    pagesBaseUrl: input.pagesBaseUrl,
    supabaseUrl: input.supabaseUrl,
    supabasePublicKey: input.supabasePublicKey,
    expectedVersion: input.expectedVersion,
    expectedSourceSha: input.expectedSourceSha,
    faultMode: input.faultMode ?? 'none',
  }
  const startedAt = now()
  const startedAtIso = new Date(startedAt).toISOString()
  const correlationId = UUID_V4.test(input.correlationId ?? '') ? input.correlationId : randomUUID()
  const configurationFailures = validateConfiguration(config)
  if (configurationFailures.length > 0) {
    const probes = configurationFailures.map(code => failedProbe('configuration', code))
    return {
      schemaVersion: 1,
      correlationId,
      startedAt: startedAtIso,
      completedAt: new Date(now()).toISOString(),
      durationMs: elapsedMs(startedAt, now),
      status: 'failed',
      faultMode: ALLOWED_FAULTS.has(config.faultMode) ? config.faultMode : 'invalid',
      protectedSource: {
        version: RELEASE_VERSION.test(config.expectedVersion) ? config.expectedVersion : null,
        releaseSha: RELEASE_SHA.test(config.expectedSourceSha) ? config.expectedSourceSha : null,
      },
      probes,
      failures: probes.map(({ id, code }) => ({ probe: id, code })),
    }
  }

  const pagesBase = new URL(config.pagesBaseUrl)
  const supabaseBase = config.supabaseUrl.replace(/\/+$/u, '')
  const cacheKey = encodeURIComponent(correlationId)
  const common = { fetchImpl, timeoutMs, now }
  const [releaseResponse, indexResponse, authResponse, collectorResponse] = await Promise.all([
    requestBounded({
      ...common,
      url: new URL(`release.json?availability=${cacheKey}`, pagesBase),
      headers: { Accept: 'application/json' },
      maxBytes: MAX_JSON_BYTES,
    }),
    requestBounded({
      ...common,
      url: new URL(`?availability=${cacheKey}`, pagesBase),
      headers: { Accept: 'text/html' },
      maxBytes: MAX_HTML_BYTES,
    }),
    requestBounded({
      ...common,
      url: `${supabaseBase}/auth/v1/health`,
      headers: { Accept: 'application/json', apikey: config.supabasePublicKey },
      maxBytes: MAX_JSON_BYTES,
    }),
    requestBounded({
      ...common,
      url: `${supabaseBase}/functions/v1/operational-events/availability-${cacheKey}`,
      headers: { Accept: 'application/json', 'X-Correlation-Id': correlationId },
      maxBytes: MAX_JSON_BYTES,
    }),
  ])

  const probes = []
  let observedVersion = null
  if (!releaseResponse.ok) {
    probes.push(responseFailure('pages-release', releaseResponse))
  } else {
    const release = parseJson(releaseResponse.text)
    observedVersion = typeof release?.version === 'string' && RELEASE_VERSION.test(release.version)
      ? release.version
      : null
    if (!observedVersion) {
      probes.push(failedProbe('pages-release', 'invalid_release_manifest', releaseResponse.durationMs, {
        httpStatus: releaseResponse.status,
        responseBytes: releaseResponse.responseBytes,
      }))
    } else {
      const expectedVersion = config.faultMode === 'expected_version_mismatch'
        ? syntheticExpectedVersion(observedVersion)
        : config.expectedVersion
      probes.push({
        id: 'pages-release',
        outcome: observedVersion === expectedVersion ? 'passed' : 'failed',
        ...(observedVersion === expectedVersion ? {} : { code: 'version_mismatch' }),
        httpStatus: releaseResponse.status,
        durationMs: releaseResponse.durationMs,
        responseBytes: releaseResponse.responseBytes,
        expectedVersion,
        observedVersion,
      })
    }
  }

  let appAsset = null
  if (!indexResponse.ok) {
    probes.push(responseFailure('pages-index', indexResponse))
  } else {
    appAsset = findAppAsset(indexResponse.text, pagesBase)
    probes.push(appAsset
      ? {
          id: 'pages-index',
          outcome: 'passed',
          httpStatus: indexResponse.status,
          durationMs: indexResponse.durationMs,
          responseBytes: indexResponse.responseBytes,
          assetName: appAsset.pathname.split('/').at(-1),
        }
      : failedProbe('pages-index', 'app_asset_not_found', indexResponse.durationMs, {
          httpStatus: indexResponse.status,
          responseBytes: indexResponse.responseBytes,
        }))
  }

  if (appAsset) {
    const assetResponse = await requestBounded({
      ...common,
      url: appAsset,
      method: 'HEAD',
      headers: { Accept: 'application/javascript' },
      maxBytes: 0,
    })
    probes.push(assetResponse.ok
      ? {
          id: 'pages-app-asset',
          outcome: 'passed',
          httpStatus: assetResponse.status,
          durationMs: assetResponse.durationMs,
          responseBytes: 0,
          assetName: appAsset.pathname.split('/').at(-1),
        }
      : responseFailure('pages-app-asset', assetResponse))
  } else {
    probes.push(failedProbe('pages-app-asset', 'not_attempted'))
  }

  probes.push(authResponse.ok
    ? {
        id: 'supabase-auth',
        outcome: 'passed',
        httpStatus: authResponse.status,
        durationMs: authResponse.durationMs,
        responseBytes: authResponse.responseBytes,
      }
    : responseFailure('supabase-auth', authResponse))

  if (!collectorResponse.ok) {
    probes.push(responseFailure('operational-collector', collectorResponse))
  } else {
    const health = parseJson(collectorResponse.text)
    const releaseSha = typeof health?.releaseSha === 'string' && RELEASE_SHA.test(health.releaseSha)
      ? health.releaseSha
      : null
    let code = null
    if (health?.ok !== true || health?.schemaVersion !== 1 || !releaseSha) code = 'invalid_collector_health'
    else if (health.enabled !== true) code = 'collector_disabled'
    else if (releaseSha !== config.expectedSourceSha) code = 'release_sha_mismatch'
    probes.push({
      id: 'operational-collector',
      outcome: code ? 'failed' : 'passed',
      ...(code ? { code } : {}),
      httpStatus: collectorResponse.status,
      durationMs: collectorResponse.durationMs,
      responseBytes: collectorResponse.responseBytes,
      schemaVersion: health?.schemaVersion === 1 ? 1 : null,
      enabled: health?.enabled === true,
      expectedReleaseSha: config.expectedSourceSha,
      observedReleaseSha: releaseSha,
    })
  }

  const failures = probes
    .filter(probe => probe.outcome === 'failed')
    .map(({ id, code }) => ({ probe: id, code }))
  return {
    schemaVersion: 1,
    correlationId,
    startedAt: startedAtIso,
    completedAt: new Date(now()).toISOString(),
    durationMs: elapsedMs(startedAt, now),
    status: failures.length === 0 ? 'passed' : 'failed',
    faultMode: config.faultMode,
    protectedSource: { version: config.expectedVersion, releaseSha: config.expectedSourceSha },
    observed: {
      pagesVersion: observedVersion,
      collectorReleaseSha: probes.find(probe => probe.id === 'operational-collector')?.observedReleaseSha ?? null,
    },
    probes,
    failures,
  }
}

export function formatStepSummary(report) {
  const lines = [
    '## Sabah One availability monitor',
    '',
    `**Result:** ${report.status === 'passed' ? 'PASS' : 'FAIL'}`,
    '',
    `Correlation: \`${report.correlationId}\`  `,
    `Protected source: \`${report.protectedSource.version ?? 'invalid'}\` / \`${report.protectedSource.releaseSha ?? 'invalid'}\`  `,
    `Synthetic fault: \`${report.faultMode}\``,
    '',
    '| Probe | Result | HTTP | Duration | Code |',
    '| --- | --- | ---: | ---: | --- |',
  ]
  for (const probe of report.probes) {
    lines.push(`| ${probe.id} | ${probe.outcome} | ${probe.httpStatus ?? '-'} | ${probe.durationMs} ms | ${probe.code ?? '-'} |`)
  }
  if (report.failures.length > 0) {
    lines.push('', 'Expected and observed release identities are retained in the JSON artifact for actionable mismatch diagnosis.')
  }
  return `${lines.join('\n')}\n`
}

async function loadPackageVersion() {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  return JSON.parse(raw).version
}

async function main() {
  const outputPath = process.env.MONITOR_OUTPUT_PATH || 'test-results/availability-monitor.json'
  const report = await runAvailabilityMonitor({
    pagesBaseUrl: process.env.PAGES_BASE_URL || 'https://xaoilin.github.io/helm/',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabasePublicKey: process.env.SUPABASE_PUBLIC_KEY || '',
    expectedVersion: process.env.EXPECTED_VERSION || await loadPackageVersion(),
    expectedSourceSha: process.env.EXPECTED_SOURCE_SHA || '',
    faultMode: process.env.SYNTHETIC_FAULT || 'none',
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, formatStepSummary(report))
  }
  console.log(`Availability monitor ${report.status}: correlation=${report.correlationId}`)
  for (const failure of report.failures) console.error(`${failure.probe}: ${failure.code}`)
  if (report.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
