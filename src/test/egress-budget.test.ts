import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { checkEgressBudget } from '../../scripts/lib/egressBudget.mjs'

const config = { organizationRef: 'xwvpzlbyhlbdmtdmtdbn', dailyBudgetBytes: 120_000_000 }
const now = Date.parse('2026-10-18T02:00:00Z')
const hash = 'a'.repeat(64)
const start = '2026-10-16T00:00:00Z'
const end = '2026-10-17T00:00:00Z'

// Invented data exercises validation only; no actual provider observation is claimed.
function fixture() {
  return {
    schema: 'helm-egress-reading/v1',
    source: { kind: 'provider', organizationRef: config.organizationRef, projectScope: 'all-projects',
      services: ['database', 'auth', 'storage', 'functions', 'realtime', 'shared-pooler', 'log-drains'],
      precision: 'exact-bytes', evidenceSha256: hash, collectedAt: '2026-10-18T00:00:00Z', dataThrough: end },
    buckets: [{ start, end, totalIncludingCachedBytes: 140_000_000, cachedBytes: 20_000_000, complete: true }],
    release: { helmCommit: 'b'.repeat(40), servicesCommit: 'c'.repeat(40),
      liveVerifiedAt: '2026-10-15T23:00:00Z', fixtureCleanupVerifiedAt: '2026-10-15T23:10:00Z', evidenceSha256: hash },
    workload: { start, end, windowsAlwaysOpen: true, macAlwaysOpen: true, normalAgentUse: true,
      remindersPassed: true, approvedMcpPassed: true, revokedMcpPassed: true, calendarConvergencePassed: true,
      evidenceSha256: hash },
    diagnostics: [{ service: 'prayer', callsBefore: 10, callsAfter: 30, rowsBefore: 50, rowsAfter: 70,
      statsResetAtBefore: '2026-10-15T00:00:00Z', statsResetAtAfter: '2026-10-15T00:00:00Z' }],
  }
}

describe('egress receipt completeness, budget and privacy', () => {
  it('accepts exact inclusive 120 decimal MB, subtracts cached once, retains paired counter deltas', () => {
    const result = checkEgressBudget(fixture(), config, now)
    expect(result).toMatchObject({ status: 'within-budget', exitCode: 0, peakDailyBytes: 120_000_000,
      acceptance: 'controller-review-required', diagnostics: [{ comparable: true, callsDelta: 20, rowsDelta: 20 }] })
  })

  it('fails one byte over budget, including when a configured limit tries to relax the ticket', () => {
    const input = fixture()
    input.buckets[0].totalIncludingCachedBytes++
    expect(checkEgressBudget(input, config, now)).toMatchObject({ status: 'over-budget', exitCode: 1 })
    expect(checkEgressBudget(input, { ...config, dailyBudgetBytes: 150_000_000 }, now).status).toBe('over-budget')
    expect(checkEgressBudget(fixture(), { ...config, dailyBudgetBytes: 100_000_000 }, now).status).toBe('over-budget')
  })

  it.each([
    ['short day', () => { const x = fixture(); x.buckets[0].end = '2026-10-16T23:00:00Z'; return x }],
    ['partial bucket', () => { const x = fixture(); x.buckets[0].complete = false; return x }],
    ['rounded bytes', () => { const x = fixture(); x.source.precision = 'rounded'; return x }],
    ['partial project scope', () => { const x = fixture(); x.source.projectScope = 'partial'; return x }],
    ['wrong organization', () => { const x = fixture(); x.source.organizationRef = 'z'.repeat(20); return x }],
    ['missing service', () => { const x = fixture(); x.source.services.pop(); return x }],
    ['duplicate service', () => { const x = fixture(); x.source.services[0] = 'auth'; return x }],
    ['provider still delayed', () => { const x = fixture(); x.source.dataThrough = start; return x }],
    ['future collection', () => { const x = fixture(); x.source.collectedAt = '2026-10-19T00:00:00Z'; return x }],
    ['workload coverage gap', () => { const x = fixture(); x.workload.start = end; return x }],
    ['missing Mac', () => { const x = fixture(); x.workload.macAlwaysOpen = false; return x }],
    ['behavior regression', () => { const x = fixture(); x.workload.remindersPassed = false; return x }],
    ['cleanup after start', () => { const x = fixture(); x.release.fixtureCleanupVerifiedAt = end; return x }],
    ['synthetic source', () => { const x = fixture(); x.source.kind = 'synthetic'; return x }],
    ['missing bytes', () => { const x = fixture(); return { ...x, buckets: [{ ...x.buckets[0], cachedBytes: null }] } }],
    ['missing provenance', () => { const x = fixture(); return { ...x, source: { ...x.source, evidenceSha256: null } } }],
  ])('keeps %s Measuring', (_name, sample) => {
    expect(checkEgressBudget(sample(), config, now)).toMatchObject({ status: 'measuring', exitCode: 2 })
  })

  it.each([NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '120MB', 'NaNundefined', '120000000'])('rejects ambiguous byte value %s', value => {
    const x = fixture()
    const input = { ...x, buckets: [{ ...x.buckets[0], totalIncludingCachedBytes: value }] }
    expect(checkEgressBudget(input, config, now).status).toBe('invalid')
  })

  it('does not hide an over-budget day in a multi-day average or accept a gap/overlap', () => {
    const x = fixture()
    x.buckets[0].totalIncludingCachedBytes = 150_000_000
    x.buckets.push({ ...x.buckets[0], start: end, end: '2026-10-18T00:00:00Z', totalIncludingCachedBytes: 20_000_000 })
    x.workload.end = x.buckets[1].end
    x.source.dataThrough = x.workload.end
    expect(checkEgressBudget(x, config, now)).toMatchObject({ status: 'over-budget', peakDailyBytes: 130_000_000 })
    x.buckets[1].start = '2026-10-17T01:00:00Z'
    x.buckets[1].end = '2026-10-18T01:00:00Z'
    expect(checkEgressBudget(x, config, now).status).toBe('measuring')
  })

  it('invalidates reset/decreasing diagnostics without confusing rows with billing bytes', () => {
    const x = fixture()
    x.diagnostics[0].statsResetAtAfter = start
    expect(checkEgressBudget(x, config, now)).toMatchObject({ status: 'within-budget',
      diagnostics: [{ comparable: false, callsDelta: null, rowsDelta: null }] })
  })

  it('CLI refuses private fields without echoing them, hashes input and never overwrites evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'helm-egress-'))
    try {
      const input = join(directory, 'input.json')
      const output = join(directory, 'result.json')
      const sentinel = 'private-business-token-sentinel'
      writeFileSync(input, JSON.stringify({ ...fixture(), authorization: sentinel }))
      const run = () => spawnSync(process.execPath, [resolve('scripts/check-egress-budget.mjs'),
        '--input', input, '--output', output], { encoding: 'utf8' })
      const invalid = run()
      expect(invalid.status).toBe(1)
      expect(invalid.stdout + invalid.stderr + readFileSync(output, 'utf8')).not.toContain(sentinel)
      const original = readFileSync(output, 'utf8')
      writeFileSync(input, JSON.stringify(fixture()))
      expect(run().status).toBe(1)
      expect(readFileSync(output, 'utf8')).toBe(original)
      rmSync(output)
      const synthetic = fixture()
      synthetic.source.kind = 'synthetic'
      writeFileSync(input, JSON.stringify(synthetic))
      const valid = run()
      expect(valid.status).toBe(2)
      expect(JSON.parse(readFileSync(output, 'utf8')).inputSha256).toMatch(/^[a-f0-9]{64}$/u)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
