import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  buildGitHubPagesUrl,
  evaluateHandoffVerification,
  findSuccessfulRunForHead,
  isIgnoredWorkingTreePath,
  parseBranchList,
  parseGitHubRemoteUrl,
  parseStatusPaths,
} from './lib/handoffVerification.mjs'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

function run(command, args) {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return output.replace(/(?:\r?\n)+$/u, '')
}

function runStatus(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function runJson(command, args) {
  return JSON.parse(run(command, args))
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}.`)
  }
  return response.text()
}

async function fetchLiveBundleVersionState(pagesUrl) {
  const html = await fetchText(pagesUrl)
  const bundleMatch = html.match(/<script[^>]+src="([^"]*assets\/[^"]+\.js)"/iu)
  if (!bundleMatch) {
    throw new Error(`Could not find the built JavaScript asset in ${pagesUrl}.`)
  }

  const assetUrl = new URL(bundleMatch[1], pagesUrl).toString()
  const bundle = await fetchText(assetUrl)
  return {
    assetUrl,
    bundle,
  }
}

async function main() {
  const version = packageJson.version
  const remoteUrl = run('git', ['remote', 'get-url', 'origin'])
  const currentHead = run('git', ['rev-parse', 'HEAD'])
  const masterHead = run('git', ['rev-parse', 'origin/master'])
  const remote = parseGitHubRemoteUrl(remoteUrl)
  const pagesUrl = buildGitHubPagesUrl(remote)
  const currentBranch = run('git', ['branch', '--show-current']) || '(detached HEAD)'
  const isHeadMergedIntoMaster = runStatus('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/master']).status === 0
  const blockingWorkingTreeChanges = parseStatusPaths(
    run('git', ['status', '--short', '--untracked-files=all']),
  ).filter((path) => !isIgnoredWorkingTreePath(path))

  const mergedLocalTopicBranches = parseBranchList(
    run('git', ['branch', '--format=%(refname:short)', '--merged', 'origin/master']),
  ).filter((branch) => branch.startsWith('codex/'))

  const mergedRemoteTopicBranches = parseBranchList(
    run('git', ['branch', '-r', '--format=%(refname:short)', '--merged', 'origin/master']),
  ).filter((branch) => branch.startsWith('origin/codex/'))

  const ciRuns = runJson('gh', [
    'run',
    'list',
    '--branch',
    'master',
    '--workflow',
    'CI',
    '--limit',
    '10',
    '--json',
    'databaseId,workflowName,displayTitle,headSha,headBranch,status,conclusion,url,event',
  ])

  const pagesRuns = runJson('gh', [
    'run',
    'list',
    '--branch',
    'master',
    '--workflow',
    'Deploy to GitHub Pages',
    '--limit',
    '10',
    '--json',
    'databaseId,workflowName,displayTitle,headSha,headBranch,status,conclusion,url,event',
  ])

  const supabaseRuns = runJson('gh', [
    'run',
    'list',
    '--branch',
    'master',
    '--workflow',
    'Deploy Supabase Assistant Function',
    '--limit',
    '10',
    '--json',
    'databaseId,workflowName,displayTitle,headSha,headBranch,status,conclusion,url,event',
  ])

  const ciRun = findSuccessfulRunForHead(ciRuns, masterHead)
  const pagesRun = findSuccessfulRunForHead(pagesRuns, masterHead)
  const supabaseRun = findSuccessfulRunForHead(supabaseRuns, masterHead)

  let assetUrl = null
  let liveSiteContainsVersion = false

  try {
    const liveBundle = await fetchLiveBundleVersionState(pagesUrl)
    assetUrl = liveBundle.assetUrl
    liveSiteContainsVersion = liveBundle.bundle.includes(version)
  } catch (error) {
    console.error(`Failed to verify the live site bundle: ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = evaluateHandoffVerification({
    assetUrl,
    blockingWorkingTreeChanges,
    ciRun,
    currentBranch,
    currentHead,
    isHeadMergedIntoMaster,
    liveSiteContainsVersion,
    masterHead,
    mergedLocalTopicBranches,
    mergedRemoteTopicBranches,
    pagesRun,
    pagesUrl,
    supabaseRun,
    version,
  })

  console.log(`handoff:check for ${currentBranch}`)
  console.log(`version: ${version}`)
  console.log(`origin/master: ${masterHead}`)
  console.log(`live site: ${pagesUrl}`)
  console.log('')

  for (const pass of result.passes) {
    console.log(`PASS ${pass}`)
  }

  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`)
  }

  if (!result.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
