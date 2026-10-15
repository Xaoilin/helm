import { z } from 'zod'

const instant = z.iso.datetime({ offset: true })
const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u)
const commit = z.string().regex(/^[a-f0-9]{40}$/u)
const services = ['database', 'auth', 'storage', 'functions', 'realtime', 'shared-pooler', 'log-drains']
const service = z.enum(['prayer', 'profile', 'planner', 'calendar', 'life', 'finance', 'knowledge'])
const DAY_MS = 86_400_000
const TICKET_BUDGET_BYTES = 120_000_000 // Decimal MB; never infer the provider's display units.

export const budgetConfigSchema = z.strictObject({
  organizationRef: z.string().regex(/^[a-z]{20}$/u),
  dailyBudgetBytes: bytes.positive(),
})

// An operator transcription contract, not an invented Supabase API response.
// Unknown fields are rejected so tokens, SQL text and business payloads cannot be copied to output.
const readingSchema = z.strictObject({
  schema: z.literal('helm-egress-reading/v1'),
  source: z.strictObject({
    kind: z.enum(['provider', 'synthetic']),
    organizationRef: z.string().regex(/^[a-z]{20}$/u),
    projectScope: z.enum(['all-projects', 'partial']),
    services: z.array(z.enum(services)).max(services.length),
    precision: z.enum(['exact-bytes', 'rounded', 'unknown']),
    evidenceSha256: sha256.nullable(),
    collectedAt: instant,
    dataThrough: instant.nullable(),
  }),
  buckets: z.array(z.strictObject({
    start: instant,
    end: instant,
    totalIncludingCachedBytes: bytes.nullable(),
    cachedBytes: bytes.nullable(),
    complete: z.boolean(),
  })).min(1).max(31),
  release: z.strictObject({
    helmCommit: commit.nullable(),
    servicesCommit: commit.nullable(),
    liveVerifiedAt: instant.nullable(),
    fixtureCleanupVerifiedAt: instant.nullable(),
    evidenceSha256: sha256.nullable(),
  }),
  workload: z.strictObject({
    start: instant,
    end: instant,
    windowsAlwaysOpen: z.boolean(),
    macAlwaysOpen: z.boolean(),
    normalAgentUse: z.boolean(),
    remindersPassed: z.boolean(),
    approvedMcpPassed: z.boolean(),
    revokedMcpPassed: z.boolean(),
    calendarConvergencePassed: z.boolean(),
    evidenceSha256: sha256.nullable(),
  }),
  // Optional paired aggregate counters, never query text/IDs, labels or account data.
  diagnostics: z.array(z.strictObject({
    service,
    callsBefore: bytes,
    callsAfter: bytes,
    rowsBefore: bytes,
    rowsAfter: bytes,
    statsResetAtBefore: instant,
    statsResetAtAfter: instant,
  })).max(7).optional(),
})

export function checkEgressBudget(input, configuration, now = Date.now()) {
  const config = budgetConfigSchema.safeParse(configuration)
  const parsed = readingSchema.safeParse(input)
  if (!config.success || !parsed.success || !Number.isFinite(now)) {
    return { schema: 'helm-egress-budget/v1', status: 'invalid', reasons: ['invalid_schema'], exitCode: 1 }
  }

  const reading = parsed.data
  const reasons = new Set()
  const source = reading.source
  const start = Date.parse(reading.buckets[0].start)
  const end = Date.parse(reading.buckets.at(-1).end)
  const collectedAt = Date.parse(source.collectedAt)
  const dataThrough = source.dataThrough && Date.parse(source.dataThrough)
  if (source.kind !== 'provider') reasons.add('synthetic_source')
  if (source.organizationRef !== config.data.organizationRef || source.projectScope !== 'all-projects'
      || new Set(source.services).size !== services.length) reasons.add('incomplete_scope')
  if (source.precision !== 'exact-bytes' || !source.evidenceSha256) reasons.add('provider_bytes_unverified')
  if (!dataThrough || dataThrough < end || dataThrough > collectedAt || collectedAt > now) {
    reasons.add('provider_window_not_final')
  }

  const release = reading.release
  if (!release.helmCommit || !release.servicesCommit || !release.evidenceSha256
      || !release.liveVerifiedAt || !release.fixtureCleanupVerifiedAt
      || Date.parse(release.liveVerifiedAt) > start || Date.parse(release.fixtureCleanupVerifiedAt) > start) {
    reasons.add('release_or_cleanup_unverified')
  }
  const workload = reading.workload
  const workloadChecks = ['windowsAlwaysOpen', 'macAlwaysOpen', 'normalAgentUse', 'remindersPassed',
    'approvedMcpPassed', 'revokedMcpPassed', 'calendarConvergencePassed']
  if (Date.parse(workload.start) > start || Date.parse(workload.end) < end || Date.parse(workload.end) > now
      || !workload.evidenceSha256 || workloadChecks.some(key => !workload[key])) {
    reasons.add('representative_workload_unverified')
  }

  let priorEnd = start
  const dailyBytes = []
  for (const bucket of reading.buckets) {
    const bucketStart = Date.parse(bucket.start)
    const bucketEnd = Date.parse(bucket.end)
    if (bucketStart !== priorEnd || bucketEnd - bucketStart !== DAY_MS || !bucket.complete) {
      reasons.add('incomplete_or_noncontiguous_day')
    }
    priorEnd = bucketEnd
    if (bucket.totalIncludingCachedBytes === null || bucket.cachedBytes === null
        || bucket.cachedBytes > bucket.totalIncludingCachedBytes) {
      reasons.add('missing_or_inconsistent_bytes')
    } else {
      dailyBytes.push(bucket.totalIncludingCachedBytes - bucket.cachedBytes)
    }
  }
  // A long average must not hide a day over budget. No short-window extrapolation.
  const peakDailyBytes = dailyBytes.length === reading.buckets.length ? Math.max(...dailyBytes) : null
  const diagnostics = (reading.diagnostics ?? []).map(counter => {
    const comparable = counter.statsResetAtBefore === counter.statsResetAtAfter
      && counter.callsAfter >= counter.callsBefore && counter.rowsAfter >= counter.rowsBefore
    return { service: counter.service, comparable,
      callsDelta: comparable ? counter.callsAfter - counter.callsBefore : null,
      rowsDelta: comparable ? counter.rowsAfter - counter.rowsBefore : null }
  })
  const budgetBytes = config.data.dailyBudgetBytes
  const overBudget = peakDailyBytes !== null && peakDailyBytes > Math.min(budgetBytes, TICKET_BUDGET_BYTES)
  const status = reasons.size ? 'measuring' : overBudget ? 'over-budget' : 'within-budget'
  return {
    schema: 'helm-egress-budget/v1', status, reasons: [...reasons],
    window: { start: reading.buckets[0].start, end: reading.buckets.at(-1).end },
    budgetBytes, ticketBudgetBytes: TICKET_BUDGET_BYTES, peakDailyBytes, dailyBytes, diagnostics,
    evidence: { provider: source.evidenceSha256, release: release.evidenceSha256, workload: workload.evidenceSha256 },
    // Hashes/attestations must still be independently read back by Sol.
    acceptance: 'controller-review-required',
    exitCode: status === 'within-budget' ? 0 : status === 'over-budget' ? 1 : 2,
  }
}
