import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createTreeRecord,
  evaluateCiReceipt,
  evaluateMergedTree,
  evaluatePreMergeTree,
  evaluateTreeRecord,
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

async function githubRequest(path) {
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com'
  const token = requiredEnvironment('GH_TOKEN')
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'helm-ci-receipt',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed with ${response.status}.`)
  }
  return response.json()
}

async function loadSourceRun(repository, sourceRunId) {
  return githubRequest(`/repos/${repository}/actions/runs/${sourceRunId}`)
}

async function loadPullRequest(repository, sourcePr) {
  return githubRequest(`/repos/${repository}/pulls/${sourcePr}`)
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

async function verifyReceipt() {
  const inputs = receiptInputs()
  const record = readRecord()
  git([
    'fetch',
    '--no-tags',
    'origin',
    '+refs/heads/master:refs/remotes/origin/master',
  ])
  const [sourceRun, pullRequest, jobsResponse] = await Promise.all([
    loadSourceRun(inputs.repository, inputs.sourceRunId),
    loadPullRequest(inputs.repository, inputs.sourcePr),
    githubRequest(
      `/repos/${inputs.repository}/actions/runs/${inputs.sourceRunId}/jobs?filter=all&per_page=100`,
    ),
  ])
  const currentSha = git(['rev-parse', 'HEAD'])
  const currentTree = git(['rev-parse', 'HEAD^{tree}'])
  const liveMasterSha = git(['rev-parse', 'refs/remotes/origin/master'])
  const liveMasterTree = git(['rev-parse', `${liveMasterSha}^{tree}`])
  const result = evaluateCiReceipt({
    currentSha,
    currentTree,
    jobs: Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [],
    liveMasterSha,
    liveMasterTree,
    pullRequest,
    record,
    repository: inputs.repository,
    sourcePr: inputs.sourcePr,
    sourceRun,
    sourceRunId: inputs.sourceRunId,
    testedTree: inputs.testedTree,
  })
  if (!report(result)) return

  console.log(
    `Verified source CI ${inputs.sourceRunId}, PR #${inputs.sourcePr}, and master tree ${currentTree}.`,
  )
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
  } else {
    throw new Error(
      'Usage: node scripts/verify-ci-receipt.mjs <record|wait|merge-state|pre-merge|merged-tree|verify>',
    )
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
