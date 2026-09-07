import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import {
  createTreeRecord,
  deployRunTitle,
  evaluateCiReceipt,
  evaluateDeploymentSource,
  evaluateLatestSourceRun,
  evaluateMergedTree,
  evaluatePreMergeTree,
  evaluateTreeRecord,
  findReusableWorkflowDispatch,
  findLatestWorkflowRun,
  receiptRunTitle,
  resolveDeploymentInputs,
  waitForSourceRun,
} from './lib/ciReceipt.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const recordPath = resolve(
  rootDir,
  process.env.CI_TREE_RECORD_PATH || 'test-results/ci-receipt/source-tree.json',
)

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function positiveIntegerEnvironment(name) {
  const value = Number(requiredEnvironment(name))
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function git(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
  }
}

function readRecord() {
  return JSON.parse(readFileSync(recordPath, 'utf8'))
}

function receiptInputs() {
  return {
    repository: requiredEnvironment('GITHUB_REPOSITORY'),
    sourcePr: positiveIntegerEnvironment('SOURCE_PR'),
    sourceRunId: positiveIntegerEnvironment('SOURCE_RUN_ID'),
    testedTree: requiredEnvironment('TESTED_TREE'),
  }
}

async function githubRequest(path, { body, method = 'GET' } = {}) {
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
  const token = requiredEnvironment('GH_TOKEN')
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'User-Agent': 'helm-ci-receipt',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed with ${response.status}.`)
  }
  if (response.status === 204) return null
  return response.json()
}

async function loadSourceRun(repository, sourceRunId) {
  return githubRequest(`/repos/${repository}/actions/runs/${sourceRunId}`)
}

async function loadPullRequest(repository, sourcePr) {
  return githubRequest(`/repos/${repository}/pulls/${sourcePr}`)
}

async function loadLatestSourceRun(repository, sourceRun) {
  const runs = []
  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/repos/${repository}/actions/workflows/ci.yml/runs?per_page=100&page=${page}`
      + `&event=${encodeURIComponent(sourceRun.event)}&head_sha=${encodeURIComponent(sourceRun.head_sha)}`,
    )
    runs.push(...response.workflow_runs)
    if (response.workflow_runs.length < 100 || runs.length >= response.total_count) break
  }
  return findLatestWorkflowRun(runs)
}

async function loadWorkflowDispatchRuns(repository, workflowFile) {
  const runs = []
  const encodedWorkflow = encodeURIComponent(workflowFile)

  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/repos/${repository}/actions/workflows/${encodedWorkflow}/runs`
      + `?event=workflow_dispatch&per_page=100&page=${page}`,
    )
    const pageRuns = Array.isArray(response?.workflow_runs) ? response.workflow_runs : []
    runs.push(...pageRuns)
    const totalCount = Number(response?.total_count)
    if (pageRuns.length < 100 || (Number.isFinite(totalCount) && runs.length >= totalCount)) break
  }

  return runs
}

async function loadSourceJobs(repository, sourceRunId) {
  const jobs = []

  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/repos/${repository}/actions/runs/${sourceRunId}/jobs`
      + `?filter=all&per_page=100&page=${page}`,
    )
    const pageJobs = Array.isArray(response?.jobs) ? response.jobs : []
    jobs.push(...pageJobs)
    const totalCount = Number(response?.total_count)
    if (pageJobs.length < 100 || (Number.isFinite(totalCount) && jobs.length >= totalCount)) break
  }

  return jobs
}

async function dispatchWorkflowOnce({
  inputs,
  repository,
  runTitle,
  workflowFile,
}) {
  const runs = await loadWorkflowDispatchRuns(repository, workflowFile)
  const existing = findReusableWorkflowDispatch(runs, runTitle)
  if (existing) {
    console.log(
      `Workflow ${workflowFile} already has ${existing.status}/${existing.conclusion ?? 'none'}`
      + ` run ${existing.id} for this receipt; skipping duplicate dispatch.`,
    )
    return
  }

  await githubRequest(
    `/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
    {
      body: {
        inputs,
        ref: 'master',
      },
      method: 'POST',
    },
  )
  console.log(`Dispatched ${workflowFile} once for ${runTitle}.`)
}

function report(result) {
  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`)
  }
  if (!result.ok) process.exitCode = 1
  return result.ok
}

async function recordTree() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY')
  const sourcePr = positiveIntegerEnvironment('SOURCE_PR')
  const sourceRunId = positiveIntegerEnvironment('GITHUB_RUN_ID')
  const sourceRunAttempt = positiveIntegerEnvironment('GITHUB_RUN_ATTEMPT')
  const sourceHeadSha = requiredEnvironment('SOURCE_HEAD_SHA')
  const sourceMergeSha = git(['rev-parse', 'HEAD'])
  const testedTree = git(['rev-parse', 'HEAD^{tree}'])
  const record = createTreeRecord({
    repository,
    sourceHeadSha,
    sourceMergeSha,
    sourcePr,
    sourceRunAttempt,
    sourceRunId,
    testedTree,
  })

  mkdirSync(dirname(recordPath), { recursive: true })
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  writeOutput('tested_tree', testedTree)
  console.log(`Recorded pull request merge-tree ${testedTree} for source run ${sourceRunId}.`)
}

async function waitForRun() {
  const { repository, sourceRunId } = receiptInputs()
  const sourceRun = await waitForSourceRun(
    () => loadSourceRun(repository, sourceRunId),
  )
  if (sourceRun.conclusion !== 'success') {
    throw new Error(`Source CI concluded ${sourceRun.conclusion ?? 'without a conclusion'}.`)
  }
  console.log(`Source CI run ${sourceRunId} completed successfully.`)
}

async function verifyMergedTree() {
  const inputs = receiptInputs()
  const record = readRecord()
  if (!report(evaluateTreeRecord(record, inputs))) return

  const pullRequest = await loadPullRequest(inputs.repository, inputs.sourcePr)
  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/master:refs/remotes/origin/master',
  ])
  const masterSha = git(['rev-parse', 'refs/remotes/origin/master'])
  const masterTree = git(['rev-parse', `${masterSha}^{tree}`])
  const result = evaluateMergedTree({
    masterSha,
    masterTree,
    pullRequest,
    record,
  })
  if (!report(result)) return

  writeOutput('merged_sha', masterSha)
  console.log(`Verified squash commit ${masterSha} has tested tree ${masterTree}.`)
}

async function inspectMergeState() {
  const inputs = receiptInputs()
  const record = readRecord()
  if (!report(evaluateTreeRecord(record, inputs))) return

  const pullRequest = await loadPullRequest(inputs.repository, inputs.sourcePr)
  if (!pullRequest.merged_at) {
    writeOutput('already_merged', 'false')
    console.log(`Pull request #${inputs.sourcePr} is not merged yet.`)
    return
  }

  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/master:refs/remotes/origin/master',
  ])
  const masterSha = git(['rev-parse', 'refs/remotes/origin/master'])
  const masterTree = git(['rev-parse', `${masterSha}^{tree}`])
  const result = evaluateMergedTree({
    masterSha,
    masterTree,
    pullRequest,
    record,
  })
  if (!report(result)) return

  writeOutput('already_merged', 'true')
  console.log(`Pull request #${inputs.sourcePr} is already merged at verified tree ${masterTree}.`)
}

async function verifyPreMergeTree() {
  const inputs = receiptInputs()
  const record = readRecord()
  if (!report(evaluateTreeRecord(record, inputs))) return
  const sourceRun = await loadSourceRun(inputs.repository, inputs.sourceRunId)
  const latestSourceRun = await loadLatestSourceRun(inputs.repository, sourceRun)
  if (!report(evaluateLatestSourceRun(sourceRun, latestSourceRun))) return
  if (sourceRun.run_attempt !== record.sourceRunAttempt) {
    throw new Error('Source CI run attempt changed before merge.')
  }

  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/master:refs/remotes/origin/master',
  ])
  const sourceMergeSha = git(['rev-parse', 'HEAD'])
  const sourceBaseSha = git(['rev-parse', 'HEAD^1'])
  const sourceHeadSha = git(['rev-parse', 'HEAD^2'])
  const sourceTree = git(['rev-parse', 'HEAD^{tree}'])
  const currentMasterSha = git(['rev-parse', 'refs/remotes/origin/master'])
  const result = evaluatePreMergeTree({
    currentMasterSha,
    record,
    sourceBaseSha,
    sourceHeadSha,
    sourceMergeSha,
    sourceTree,
  })
  if (!report(result)) return

  console.log(`Verified tested merge-tree is still based on master ${currentMasterSha}.`)
}

async function verifyReceipt(inputs = receiptInputs(), record = readRecord()) {
  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/master:refs/remotes/origin/master',
  ])
  const [sourceRun, pullRequest, sourceJobs] = await Promise.all([
    loadSourceRun(inputs.repository, inputs.sourceRunId),
    loadPullRequest(inputs.repository, inputs.sourcePr),
    loadSourceJobs(inputs.repository, inputs.sourceRunId),
  ])
  const latestSourceRun = await loadLatestSourceRun(inputs.repository, sourceRun)
  const currentSha = git(['rev-parse', 'HEAD'])
  const currentTree = git(['rev-parse', 'HEAD^{tree}'])
  const liveMasterSha = git(['rev-parse', 'refs/remotes/origin/master'])
  const liveMasterTree = git(['rev-parse', `${liveMasterSha}^{tree}`])
  const result = evaluateCiReceipt({
    currentSha,
    currentTree,
    jobs: sourceJobs,
    liveMasterSha,
    liveMasterTree,
    latestSourceRun,
    pullRequest,
    record,
    repository: inputs.repository,
    sourcePr: inputs.sourcePr,
    sourceRun,
    sourceRunId: inputs.sourceRunId,
    testedTree: inputs.testedTree,
  })
  if (!report(result)) return

  writeOutput('verified_sha', currentSha)
  console.log(
    `Verified source CI ${inputs.sourceRunId}, PR #${inputs.sourcePr}, and master tree ${currentTree}.`,
  )
}

async function verifyDeployment() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY')
  const inputs = resolveDeploymentInputs({
    event: JSON.parse(readFileSync(requiredEnvironment('GITHUB_EVENT_PATH'), 'utf8')),
    eventName: requiredEnvironment('GITHUB_EVENT_NAME'),
    ref: requiredEnvironment('GITHUB_REF'),
  })
  let sourceRun = await loadSourceRun(repository, inputs.sourceRunId)
  const [latestSourceRun, jobs] = await Promise.all([
    loadLatestSourceRun(repository, sourceRun),
    loadSourceJobs(repository, inputs.sourceRunId),
  ])
  if (!report(evaluateDeploymentSource({
    currentSha: git(['rev-parse', 'HEAD']), inputs, jobs, latestSourceRun, repository, sourceRun,
  }))) return

  // A completed master CI trigger still needs the protected PR's tested-tree
  // receipt. Never manufacture a receipt from the deployment checkout.
  if (inputs.eventName === 'workflow_run') {
    const pullRequests = await githubRequest(`/repos/${repository}/commits/${inputs.deploySha}/pulls`)
    const matching = pullRequests.filter(pr => pr.merged_at && pr.merge_commit_sha === inputs.deploySha && pr.base.ref === 'master')
    if (matching.length !== 1) throw new Error('Deployment requires exactly one matching merged pull request.')
    sourceRun = await loadLatestSourceRun(repository, { event: 'pull_request', head_sha: matching[0].head.sha })
    if (!sourceRun) throw new Error('Deployment has no matching pull request CI run.')
  }

  const artifactDir = mkdtempSync(resolve(tmpdir(), 'helm-deployment-receipt-'))
  try {
    execFileSync('gh', ['run', 'download', String(sourceRun.id), '--repo', repository,
      '--name', 'ci-tested-tree', '--dir', artifactDir], { stdio: 'pipe' })
    const record = JSON.parse(readFileSync(resolve(artifactDir, 'source-tree.json'), 'utf8'))
    await verifyReceipt({
      repository,
      sourcePr: record.sourcePr,
      sourceRunId: sourceRun.id,
      testedTree: record.testedTree,
    }, record)
  } finally {
    rmSync(artifactDir, { recursive: true, force: true })
  }
}

async function dispatchReceipt() {
  const inputs = receiptInputs()
  await dispatchWorkflowOnce({
    inputs: {
      source_pr: String(inputs.sourcePr),
      source_run_id: String(inputs.sourceRunId),
      tested_tree: inputs.testedTree,
    },
    repository: inputs.repository,
    runTitle: receiptRunTitle(inputs.sourceRunId, inputs.testedTree),
    workflowFile: 'ci.yml',
  })
}

async function dispatchDeploys() {
  const repository = requiredEnvironment('GITHUB_REPOSITORY')
  const sourceRunId = positiveIntegerEnvironment('SOURCE_RUN_ID')
  const deploySha = requiredEnvironment('DEPLOY_SHA')
  if (!/^[0-9a-f]{40,64}$/u.test(deploySha)) {
    throw new Error('DEPLOY_SHA must be a full Git SHA.')
  }

  const dispatches = [
    {
      runTitle: deployRunTitle('Pages', sourceRunId, deploySha),
      workflowFile: 'deploy.yml',
    },
    {
      runTitle: deployRunTitle('Supabase', sourceRunId, deploySha),
      workflowFile: 'deploy-supabase-assistant.yml',
    },
  ]
  const results = await Promise.allSettled(dispatches.map(dispatch => dispatchWorkflowOnce({
    inputs: {
      deploy_sha: deploySha,
      source_run_id: String(sourceRunId),
    },
    repository,
    ...dispatch,
  })))
  const failures = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
  if (failures.length > 0) {
    throw new Error(`Deployment dispatch failed: ${failures.join('; ')}`)
  }
}

const command = process.argv[2]

try {
  if (command === 'record') {
    await recordTree()
  } else if (command === 'wait') {
    await waitForRun()
  } else if (command === 'merge-state') {
    await inspectMergeState()
  } else if (command === 'pre-merge') {
    await verifyPreMergeTree()
  } else if (command === 'merged-tree') {
    await verifyMergedTree()
  } else if (command === 'verify') {
    await verifyReceipt()
  } else if (command === 'deployment') {
    await verifyDeployment()
  } else if (command === 'dispatch-receipt') {
    await dispatchReceipt()
  } else if (command === 'dispatch-deploys') {
    await dispatchDeploys()
  } else {
    throw new Error(
      'Usage: node scripts/verify-ci-receipt.mjs '
      + '<record|wait|merge-state|pre-merge|merged-tree|verify|deployment|dispatch-receipt|dispatch-deploys>',
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
