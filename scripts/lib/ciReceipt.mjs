export const CI_RECEIPT_SCHEMA_VERSION = 1

export const REQUIRED_SOURCE_JOBS = [
  'lint',
  'agent-policy',
  'typecheck',
  'unit',
  'e2e',
  'build',
  'database',
  'codex-review',
]

const SHA_PATTERN = /^[0-9a-f]{40,64}$/u

function isSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value)
}

function addFailure(failures, condition, message) {
  if (!condition) failures.push(message)
}

export function receiptRunTitle(sourceRunId, testedTree) {
  return `CI receipt source ${sourceRunId} tree ${testedTree}`
}

export function deployRunTitle(kind, sourceRunId, deploySha) {
  return `Deploy ${kind} receipt ${sourceRunId} ${deploySha}`
}

export function findReusableWorkflowDispatch(workflowRuns, expectedTitle) {
  return workflowRuns
    .filter(run => (
      run?.display_title === expectedTitle
      && (
        run.status !== 'completed'
        || run.conclusion === 'success'
      )
    ))
    .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0] ?? null
}

export function createTreeRecord({
  repository,
  sourceHeadSha,
  sourceMergeSha,
  sourcePr,
  sourceRunAttempt,
  sourceRunId,
  testedTree,
}) {
  return {
    schemaVersion: CI_RECEIPT_SCHEMA_VERSION,
    repository,
    sourceHeadSha,
    sourceMergeSha,
    sourcePr,
    sourceRunAttempt,
    sourceRunId,
    testedTree,
  }
}

export function evaluateTreeRecord(record, expected) {
  const failures = []

  addFailure(
    failures,
    record?.schemaVersion === CI_RECEIPT_SCHEMA_VERSION,
    `Source tree record schema must be ${CI_RECEIPT_SCHEMA_VERSION}.`,
  )
  addFailure(
    failures,
    record?.repository === expected.repository,
    'Source tree record belongs to a different repository.',
  )
  addFailure(
    failures,
    Number(record?.sourceRunId) === Number(expected.sourceRunId),
    'Source tree record belongs to a different workflow run.',
  )
  addFailure(
    failures,
    Number(record?.sourcePr) === Number(expected.sourcePr),
    'Source tree record belongs to a different pull request.',
  )
  addFailure(
    failures,
    record?.testedTree === expected.testedTree,
    'Source tree record does not match the requested tested tree.',
  )
  addFailure(failures, isSha(record?.sourceHeadSha), 'Source tree record has an invalid head SHA.')
  addFailure(failures, isSha(record?.sourceMergeSha), 'Source tree record has an invalid merge SHA.')
  addFailure(failures, isSha(record?.testedTree), 'Source tree record has an invalid tree SHA.')

  return {
    failures,
    ok: failures.length === 0,
  }
}

export function evaluateMergedTree({
  masterSha,
  masterTree,
  pullRequest,
  record,
}) {
  const failures = []

  addFailure(failures, pullRequest?.merged_at, 'The source pull request is not merged.')
  addFailure(
    failures,
    pullRequest?.base?.ref === 'master',
    'The source pull request does not target master.',
  )
  addFailure(
    failures,
    pullRequest?.head?.sha === record.sourceHeadSha,
    'The merged pull request head does not match the tested source head.',
  )
  addFailure(
    failures,
    pullRequest?.merge_commit_sha === masterSha,
    'The resulting squash commit is not the current origin/master head.',
  )
  addFailure(
    failures,
    masterTree === record.testedTree,
    'The resulting master tree does not match the tested pull request merge-tree.',
  )

  return {
    failures,
    ok: failures.length === 0,
  }
}

export function evaluatePreMergeTree({
  currentMasterSha,
  record,
  sourceBaseSha,
  sourceHeadSha,
  sourceMergeSha,
  sourceTree,
}) {
  const failures = []

  addFailure(
    failures,
    sourceMergeSha === record.sourceMergeSha,
    'The checked-out pull request merge commit differs from the recorded source merge.',
  )
  addFailure(
    failures,
    sourceHeadSha === record.sourceHeadSha,
    'The checked-out pull request head differs from the recorded source head.',
  )
  addFailure(
    failures,
    sourceTree === record.testedTree,
    'The checked-out pull request merge-tree differs from the recorded tested tree.',
  )
  addFailure(
    failures,
    sourceBaseSha === currentMasterSha,
    'Master advanced after this pull request merge-tree was tested.',
  )

  return {
    failures,
    ok: failures.length === 0,
  }
}

function evaluateRequiredJobs(jobs) {
  const failures = []

  for (const requiredName of REQUIRED_SOURCE_JOBS) {
    const job = jobs
      .filter(candidate => candidate.name === requiredName)
      .sort((left, right) => (
        Number(right.run_attempt ?? 0) - Number(left.run_attempt ?? 0)
        || Number(right.id ?? 0) - Number(left.id ?? 0)
      ))[0]
    if (!job) {
      failures.push(`Source CI is missing required job ${requiredName}.`)
      continue
    }
    if (job.status !== 'completed' || job.conclusion !== 'success') {
      failures.push(
        `Source CI required job ${requiredName} did not pass (${job.status}/${job.conclusion ?? 'none'}).`,
      )
    }
  }

  return failures
}

export function evaluateCiReceipt({
  currentSha,
  currentTree,
  jobs,
  liveMasterSha,
  liveMasterTree,
  pullRequest,
  record,
  repository,
  sourcePr,
  sourceRun,
  sourceRunId,
  testedTree,
}) {
  const failures = []
  const recordResult = evaluateTreeRecord(record, {
    repository,
    sourcePr,
    sourceRunId,
    testedTree,
  })
  failures.push(...recordResult.failures)

  addFailure(failures, isSha(testedTree), 'The requested tested tree is not a valid Git SHA.')
  addFailure(
    failures,
    currentTree === testedTree,
    'The verification checkout tree does not match the tested pull request merge-tree.',
  )
  addFailure(
    failures,
    liveMasterSha === currentSha,
    'Live origin/master advanced beyond the verification checkout.',
  )
  addFailure(
    failures,
    liveMasterTree === testedTree,
    'Live origin/master no longer has the tested pull request tree.',
  )
  addFailure(
    failures,
    Number(sourceRun?.id) === Number(sourceRunId),
    'GitHub returned a different source workflow run.',
  )
  addFailure(
    failures,
    sourceRun?.path === '.github/workflows/ci.yml',
    'The source workflow run did not execute .github/workflows/ci.yml.',
  )
  addFailure(
    failures,
    Number(sourceRun?.run_attempt) === Number(record?.sourceRunAttempt),
    'Source CI run attempt does not match the recorded attempt.',
  )
  addFailure(
    failures,
    sourceRun?.event === 'pull_request',
    'The source workflow run was not triggered by a pull request.',
  )
  addFailure(
    failures,
    sourceRun?.status === 'completed' && sourceRun?.conclusion === 'success',
    `Source CI did not complete successfully (${sourceRun?.status ?? 'unknown'}/${sourceRun?.conclusion ?? 'none'}).`,
  )
  addFailure(
    failures,
    sourceRun?.head_sha === record?.sourceHeadSha,
    'Source CI head SHA does not match the recorded pull request head.',
  )
  addFailure(
    failures,
    Number(pullRequest?.number) === Number(sourcePr),
    'GitHub returned a different source pull request.',
  )
  addFailure(failures, pullRequest?.merged_at, 'The source pull request is not merged.')
  addFailure(
    failures,
    pullRequest?.base?.ref === 'master',
    'The source pull request does not target master.',
  )
  addFailure(
    failures,
    pullRequest?.head?.sha === sourceRun?.head_sha,
    'The source workflow run belongs to a different pull request head.',
  )
  addFailure(
    failures,
    pullRequest?.merge_commit_sha === currentSha,
    'The verification checkout is not the source pull request squash commit.',
  )
  failures.push(...evaluateRequiredJobs(jobs))

  return {
    failures,
    ok: failures.length === 0,
  }
}

export async function waitForSourceRun(
  loadRun,
  {
    attempts = 20,
    intervalMs = 2_000,
    sleep = duration => new Promise(resolve => setTimeout(resolve, duration)),
  } = {},
) {
  let lastRun = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastRun = await loadRun()
    if (lastRun?.status === 'completed') return lastRun
    if (attempt < attempts) await sleep(intervalMs)
  }

  throw new Error(
    `Source CI run did not complete after ${attempts} checks (last status: ${lastRun?.status ?? 'unknown'}).`,
  )
}
