import assert from 'node:assert/strict'
import test from 'node:test'

import { runAvailabilityMonitor } from './monitor-availability.mjs'

const pagesBaseUrl = 'https://xaoilin.github.io/helm/'
const supabaseUrl = 'https://project.supabase.co'
const supabasePublicKey = 'public-key-must-never-enter-report'
const profileBaseUrl = 'https://profile.sabah.test'
const expectedVersion = '1.2.3'
const expectedSourceSha = 'a'.repeat(40)

function healthyFetch(overrides = {}) {
  return async (input, init = {}) => {
    const url = new URL(input)
    const key = `${init.method ?? 'GET'} ${url.pathname}`
    if (overrides[key]) return overrides[key](url, init)
    if (url.pathname === '/helm/release.json') {
      return Response.json({ version: expectedVersion })
    }
    if (url.pathname === '/helm/') {
      return new Response('<script type="module" src="/helm/assets/app-test.js"></script>', {
        headers: { 'content-type': 'text/html' },
      })
    }
    if (url.pathname === '/helm/assets/app-test.js' && init.method === 'HEAD') {
      return new Response(null, { headers: { 'content-type': 'application/javascript' } })
    }
    if (url.pathname === '/auth/v1/health') {
      const headers = new Headers(init.headers)
      assert.equal(headers.get('apikey'), supabasePublicKey)
      assert.equal(headers.get('authorization'), null)
      return Response.json({ name: 'GoTrue' })
    }
    if (url.origin === profileBaseUrl && url.pathname === '/api/profile/health') {
      return Response.json({ status: 'UP', service: 'profile-service' })
    }
    throw new Error(`Unexpected test request: ${key}`)
  }
}

function run(fetchImpl, extra = {}) {
  return runAvailabilityMonitor({
    pagesBaseUrl,
    supabaseUrl,
    supabasePublicKey,
    profileBaseUrl,
    expectedVersion,
    expectedSourceSha,
    fetchImpl,
    correlationId: '11111111-1111-4111-8111-111111111111',
    ...extra,
  })
}

test('fails a timed-out probe within the injected deadline', async () => {
  const fetchImpl = healthyFetch({
    'GET /auth/v1/health': (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }),
  })
  const report = await run(fetchImpl, { fetchTimeoutMs: 5 })
  assert.equal(report.status, 'failed')
  assert.deepEqual(report.failures, [{ probe: 'supabase-auth', code: 'timeout' }])
})

test('reports an injected 503 without retaining its response body', async () => {
  const privateBody = `provider failure ${supabasePublicKey}`
  const fetchImpl = healthyFetch({
    'GET /api/profile/health': () => new Response(privateBody, { status: 503 }),
  })
  const report = await run(fetchImpl)
  assert.equal(report.status, 'failed')
  assert.deepEqual(report.failures, [{ probe: 'operational-collector', code: 'http_error' }])
  assert.equal(JSON.stringify(report).includes(privateBody), false)
  assert.equal(JSON.stringify(report).includes(supabasePublicKey), false)
})

test('passes after the injected dependency recovers', async () => {
  const report = await run(healthyFetch())
  assert.equal(report.status, 'passed')
  assert.equal(report.probes.length, 5)
  assert.equal(report.probes.every(probe => probe.outcome === 'passed'), true)
})

test('synthetic mismatch uses the observed public version and genuinely fails the assertion', async () => {
  const report = await run(healthyFetch(), { faultMode: 'expected_version_mismatch' })
  assert.equal(report.status, 'failed')
  const release = report.probes.find(probe => probe.id === 'pages-release')
  assert.equal(release.outcome, 'failed')
  assert.equal(release.code, 'version_mismatch')
  assert.equal(release.observedVersion, expectedVersion)
  assert.equal(release.expectedVersion, `${expectedVersion}-expected-version-mismatch`)
})

test('bounds oversized responses and emits a small redacted report', async () => {
  const remoteSentinel = `remote-sensitive-${supabasePublicKey}`
  const fetchImpl = healthyFetch({
    'GET /auth/v1/health': () => new Response(`${'x'.repeat(20_000)}${remoteSentinel}`),
  })
  const report = await run(fetchImpl)
  const serialized = JSON.stringify(report)
  assert.equal(report.status, 'failed')
  assert.deepEqual(report.failures, [{ probe: 'supabase-auth', code: 'response_too_large' }])
  assert.equal(serialized.includes(remoteSentinel), false)
  assert.equal(serialized.includes(supabasePublicKey), false)
  assert.ok(serialized.length < 10_000)
})
