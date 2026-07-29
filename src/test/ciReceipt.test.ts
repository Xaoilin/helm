// @vitest-environment node
import {
  REQUIRED_SOURCE_JOBS,
  createTreeRecord,
  evaluateCiReceipt,
  evaluateMergedTree,
  evaluatePreMergeTree,
  waitForSourceRun,
} from '../../scripts/lib/ciReceipt.mjs'

const testedTree = 'a'.repeat(40)
const sourceHeadSha = 'b'.repeat(40)
const sourceMergeSha = 'c'.repeat(40)
const currentSha = 'd'.repeat(40)
const repository = 'Xaoilin/helm'
const sourcePr = 91
const sourceRunId = 12345

function passingState() {
  const record = createTreeRecord({
    repository,
    sourceHeadSha,
    sourceMergeSha,
    sourcePr,
    sourceRunAttempt: 1,
    sourceRunId,
    testedTree,
  })
  return {
    currentSha,
    currentTree: testedTree,
    jobs: REQUIRED_SOURCE_JOBS.map(name => ({
      conclusion: 'success',
      id: REQUIRED_SOURCE_JOBS.indexOf(name) + 1,
      name,
      run_attempt: 1,
      status: 'completed',
    })),
    liveMasterSha: currentSha,
    liveMasterTree: testedTree,
    pullRequest: {
      base: { ref: 'master' },
      head: { sha: sourceHeadSha },
      merge_commit_sha: currentSha,
      merged_at: '2026-07-29T15:00:00Z',
      number: sourcePr,
    },
    record,
    repository,
    sourcePr,
    sourceRun: {
      conclusion: 'success',
      event: 'pull_request',
      head_sha: sourceHeadSha,
      id: sourceRunId,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      run_attempt: 1,
      status: 'completed',
    },
    sourceRunId,
    testedTree,
  }
}

describe('exact-tree CI receipts', () => {
  it('accepts a successful source run for the exact merged tree', () => {
    expect(evaluateCiReceipt(passingState())).toEqual({
      failures: [],
      ok: true,
    })
  })

  it('fails closed when the verification tree differs', () => {
    const state = passingState()
    state.currentTree = 'e'.repeat(40)

    expect(evaluateCiReceipt(state)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'The verification checkout tree does not match the tested pull request merge-tree.',
      ]),
    })
  })

  it('fails closed when live master advances before deployment dispatch', () => {
    const state = passingState()
    state.liveMasterSha = 'e'.repeat(40)
    state.liveMasterTree = 'f'.repeat(40)

    expect(evaluateCiReceipt(state)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Live origin/master advanced beyond the verification checkout.',
        'Live origin/master no longer has the tested pull request tree.',
      ]),
    })
  })

  it('fails closed when source CI was unsuccessful', () => {
    const state = passingState()
    state.sourceRun.conclusion = 'failure'

    expect(evaluateCiReceipt(state)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source CI did not complete successfully (completed/failure).',
      ]),
    })
  })

  it('rejects another workflow path or run attempt', () => {
    const wrongWorkflow = passingState()
    wrongWorkflow.sourceRun.path = '.github/workflows/other.yml'
    expect(evaluateCiReceipt(wrongWorkflow)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'The source workflow run did not execute .github/workflows/ci.yml.',
      ]),
    })

    const wrongAttempt = passingState()
    wrongAttempt.sourceRun.run_attempt = 2
    expect(evaluateCiReceipt(wrongAttempt)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source CI run attempt does not match the recorded attempt.',
      ]),
    })
  })

  it('fails closed when the source run belongs to another pull request', () => {
    const state = passingState()
    state.pullRequest.head.sha = 'f'.repeat(40)

    expect(evaluateCiReceipt(state)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'The source workflow run belongs to a different pull request head.',
      ]),
    })
  })

  it('fails closed when verification names the wrong pull request', () => {
    const state = passingState()
    state.sourcePr = sourcePr + 1

    expect(evaluateCiReceipt(state)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source tree record belongs to a different pull request.',
        'GitHub returned a different source pull request.',
      ]),
    })
  })

  it('fails closed when a required job is missing or failed', () => {
    const missing = passingState()
    missing.jobs = missing.jobs.filter(job => job.name !== 'native')
    expect(evaluateCiReceipt(missing)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source CI is missing required job native.',
      ]),
    })

    const failed = passingState()
    const e2e = failed.jobs.find(job => job.name === 'e2e')
    if (e2e) e2e.conclusion = 'failure'
    expect(evaluateCiReceipt(failed)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source CI required job e2e did not pass (completed/failure).',
      ]),
    })

    const latestFailed = passingState()
    latestFailed.jobs.push({
      conclusion: 'failure',
      id: 999,
      name: 'e2e',
      run_attempt: 2,
      status: 'completed',
    })
    expect(evaluateCiReceipt(latestFailed)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Source CI required job e2e did not pass (completed/failure).',
      ]),
    })
  })

  it('requires the squash result to remain the tested master tree', () => {
    const state = passingState()
    expect(evaluateMergedTree({
      masterSha: currentSha,
      masterTree: testedTree,
      pullRequest: state.pullRequest,
      record: state.record,
    }).ok).toBe(true)

    expect(evaluateMergedTree({
      masterSha: currentSha,
      masterTree: 'e'.repeat(40),
      pullRequest: state.pullRequest,
      record: state.record,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'The resulting master tree does not match the tested pull request merge-tree.',
      ]),
    })
  })

  it('rejects a changed master before the irreversible squash merge', () => {
    const state = passingState()
    const sourceBaseSha = '1'.repeat(40)
    expect(evaluatePreMergeTree({
      currentMasterSha: sourceBaseSha,
      record: state.record,
      sourceBaseSha,
      sourceHeadSha,
      sourceMergeSha,
      sourceTree: testedTree,
    }).ok).toBe(true)

    expect(evaluatePreMergeTree({
      currentMasterSha: '2'.repeat(40),
      record: state.record,
      sourceBaseSha,
      sourceHeadSha,
      sourceMergeSha,
      sourceTree: testedTree,
    })).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'Master advanced after this pull request merge-tree was tested.',
      ]),
    })
  })

  it('waits briefly for the source run and times out closed', async () => {
    const states = [
      { status: 'in_progress' },
      { conclusion: 'success', status: 'completed' },
    ]
    const sleep = vi.fn(async () => undefined)
    await expect(waitForSourceRun(
      async () => states.shift(),
      { attempts: 2, intervalMs: 1, sleep },
    )).resolves.toMatchObject({ status: 'completed' })
    expect(sleep).toHaveBeenCalledOnce()

    await expect(waitForSourceRun(
      async () => ({ status: 'in_progress' }),
      { attempts: 2, intervalMs: 1, sleep },
    )).rejects.toThrow('Source CI run did not complete after 2 checks')
  })
})
