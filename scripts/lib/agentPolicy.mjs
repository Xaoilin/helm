import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const REQUIRED_CI_CHECKS = [
  'lint',
  'typecheck',
  'unit',
  'e2e',
  'build',
  'agent-policy',
  'codex-review',
]

const LOCAL_DATE_UTC_SLICING_PATTERN =
  /\.toISOString\(\)\s*\.split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/u

const TRACKED_POLICY_PATHS = ['src', 'docs', 'AGENTS.md', 'README.md']
const TEXT_FILE_PATTERN = /\.(?:js|jsx|mjs|cjs|ts|tsx|md|json|yml|yaml)$/u

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function listTrackedPolicyFiles(rootDir) {
  const output = execFileSync('git', ['ls-files', ...TRACKED_POLICY_PATHS], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((filePath) => filePath.length > 0 && TEXT_FILE_PATTERN.test(filePath))
}

export function findForbiddenLocalDateSlicingInText(filePath, text) {
  const findings = []
  const lines = text.split(/\r?\n/u)

  lines.forEach((line, index) => {
    if (LOCAL_DATE_UTC_SLICING_PATTERN.test(line)) {
      findings.push({
        filePath,
        line: index + 1,
      })
    }
  })

  return findings
}

export function findForbiddenLocalDateSlicing(rootDir, filePaths) {
  const findings = []

  for (const filePath of filePaths) {
    const absolutePath = resolve(rootDir, filePath)
    if (!existsSync(absolutePath)) {
      continue
    }

    findings.push(...findForbiddenLocalDateSlicingInText(filePath, readFileSync(absolutePath, 'utf8')))
  }

  return findings
}

export function evaluateCiWorkflow(rawWorkflow) {
  const failures = []
  const passes = []

  for (const checkName of REQUIRED_CI_CHECKS) {
    const jobPattern = new RegExp(`^\\s{2}${escapeRegex(checkName)}:\\s*$`, 'mu')
    const namePattern = new RegExp(`^\\s{4}name:\\s*${escapeRegex(checkName)}\\s*$`, 'mu')

    if (!jobPattern.test(rawWorkflow)) {
      failures.push(`CI workflow is missing the ${checkName} job.`)
    } else if (!namePattern.test(rawWorkflow)) {
      failures.push(`CI workflow job ${checkName} must set name: ${checkName}.`)
    } else {
      passes.push(`CI workflow defines required check ${checkName}.`)
    }
  }

  const requiredAutoPromoteSnippets = [
    'auto-promote:',
    "github.event.pull_request.draft == false",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "github.event.pull_request.base.ref == 'master'",
    "startsWith(github.event.pull_request.head.ref, 'codex/')",
    'gh pr merge "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --squash --delete-branch',
    'gh workflow run "CI" --ref master',
  ]

  for (const snippet of requiredAutoPromoteSnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow auto-promote job is missing expected guard or command: ${snippet}`)
    }
  }

  if (requiredAutoPromoteSnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push('CI workflow keeps auto-promote limited to non-draft same-repo codex/* PRs into master.')
  }

  const requiredCodexReviewSnippets = [
    'id: codex_review_secret',
    "steps.codex_review_secret.outputs.available == 'true'",
    'continue-on-error: true',
    'Codex review did not produce output',
    'treating review as advisory unavailable',
  ]

  for (const snippet of requiredCodexReviewSnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow codex-review job is missing expected advisory-review guard: ${snippet}`)
    }
  }

  if (requiredCodexReviewSnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push('CI workflow keeps OpenAI quota and availability from blocking release promotion.')
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}

export function evaluateAgentPolicy(rootDir) {
  const failures = []
  const passes = []

  const trackedFiles = listTrackedPolicyFiles(rootDir)
  const forbiddenLocalDateFindings = findForbiddenLocalDateSlicing(rootDir, trackedFiles)

  if (forbiddenLocalDateFindings.length > 0) {
    failures.push(
      `Forbidden UTC local-date slicing found: ${forbiddenLocalDateFindings
        .map((finding) => `${finding.filePath}:${finding.line}`)
        .join(', ')}.`,
    )
  } else {
    passes.push('No forbidden UTC local-date slicing pattern was found in tracked source/docs.')
  }

  const ciWorkflowPath = resolve(rootDir, '.github', 'workflows', 'ci.yml')
  const ciResult = evaluateCiWorkflow(readFileSync(ciWorkflowPath, 'utf8'))
  failures.push(...ciResult.failures)
  passes.push(...ciResult.passes)

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}
