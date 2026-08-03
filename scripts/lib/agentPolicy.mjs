import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const REQUIRED_CI_CHECKS = [
  'lint',
  'agent-policy',
  'typecheck',
  'unit',
  'e2e',
  'build',
  'database',
  'native',
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
    'always() &&',
    "github.event.pull_request.draft == false",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "github.event.pull_request.base.ref == 'master'",
    "startsWith(github.event.pull_request.head.ref, 'codex/')",
    "needs.lint.result == 'success'",
    "needs['agent-policy'].result == 'success'",
    "needs.typecheck.result == 'success'",
    "needs.unit.result == 'success'",
    "needs.e2e.result == 'success'",
    "needs.build.result == 'success'",
    "needs.database.result == 'success'",
    "needs.native.result == 'success'",
    "needs['codex-review'].result == 'success'",
    'group: helm-auto-promote-master',
    'cancel-in-progress: false',
    'overwrite: true',
    'node ./scripts/verify-ci-receipt.mjs merge-state',
    'node ./scripts/verify-ci-receipt.mjs pre-merge',
    'gh pr merge "$PR_NUMBER"',
    '--squash',
    '--delete-branch',
    '--match-head-commit "$SOURCE_HEAD_SHA"',
    '--subject "$pr_title (#$PR_NUMBER)"',
    'node ./scripts/verify-ci-receipt.mjs merged-tree',
    'node ./scripts/verify-ci-receipt.mjs dispatch-receipt',
  ]

  for (const snippet of requiredAutoPromoteSnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow auto-promote job is missing expected guard or command: ${snippet}`)
    }
  }

  if (requiredAutoPromoteSnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push(
      'CI workflow keeps auto-promote limited to validated non-draft codex/* PRs and dispatches exact-tree verification.',
    )
  }

  const promotionLockCount = rawWorkflow.match(/group:\s*helm-auto-promote-master/gu)?.length ?? 0
  const promotionQueueCount = rawWorkflow.match(
    /group:\s*helm-auto-promote-master[\s\S]*?cancel-in-progress:\s*false[\s\S]*?queue:\s*max/gu,
  )?.length ?? 0
  if (promotionLockCount < 2 || promotionQueueCount < 2) {
    failures.push(
      'CI workflow must FIFO-queue auto-promote and receipt deployment dispatch with the same lock.',
    )
  } else {
    passes.push('Auto-promote and receipt deployment dispatch share the FIFO promotion queue.')
  }

  const forbiddenAutoPromoteDeployDispatches = [
    '"Deploy to GitHub Pages"',
    '"Deploy Supabase Assistant Function"',
  ]
  const autoPromoteStart = rawWorkflow.indexOf('\n  auto-promote:')
  const autoPromoteBody = autoPromoteStart >= 0
    ? rawWorkflow.slice(autoPromoteStart)
    : ''
  for (const workflowName of forbiddenAutoPromoteDeployDispatches) {
    if (autoPromoteBody.includes(workflowName)) {
      failures.push(
        `CI workflow must let successful verification trigger deploys instead of dispatching ${workflowName}.`,
      )
    }
  }
  if (forbiddenAutoPromoteDeployDispatches.every(name => !autoPromoteBody.includes(name))) {
    passes.push('Auto-promote leaves deployment dispatch to the verified receipt.')
  }

  const requiredEfficiencySnippets = [
    'converted_to_draft',
    "github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id",
    "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    'node ./scripts/detect-ci-native-impact.mjs',
    'uses: actions/cache@v5',
    'npm run test -- --config vite.config.ts',
    'name: unit-${{ matrix.shard }}-of-2',
    '--shard=${{ matrix.shard }}/2',
    "UNIT_SHARDS_RESULT: ${{ needs['unit-shard'].result }}",
    'name: e2e-${{ matrix.shard }}-of-3',
    'shard: [1, 2, 3]',
    'npm run test:e2e -- --fully-parallel --workers=2 --shard=${{ matrix.shard }}/3 --reporter=line',
    "E2E_SHARDS_RESULT: ${{ needs['e2e-shard'].result }}",
    'google-chrome --version',
    "needs['native-changes'].outputs.native == 'true'",
  ]

  for (const snippet of requiredEfficiencySnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow is missing required fast-feedback behavior: ${snippet}`)
    }
  }

  if (requiredEfficiencySnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push('CI workflow cancels stale PR runs and conditionally caches native validation.')
  }

  const requiredReceiptSnippets = [
    "format('CI receipt source {0} tree {1}', inputs.source_run_id, inputs.tested_tree)",
    'tested_tree:',
    'source_run_id:',
    'source_pr:',
    'node ./scripts/verify-ci-receipt.mjs record',
    'uses: actions/upload-artifact@v5',
    'node ./scripts/verify-ci-receipt.mjs wait',
    'uses: actions/download-artifact@v5',
    'run-id: ${{ inputs.source_run_id }}',
    'node ./scripts/verify-ci-receipt.mjs verify',
    'DEPLOY_SHA: ${{ steps.verify.outputs.verified_sha }}',
    'Trigger deploy workflows after verified receipt',
    'node ./scripts/verify-ci-receipt.mjs dispatch-deploys',
  ]

  for (const snippet of requiredReceiptSnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow is missing exact-tree receipt behavior: ${snippet}`)
    }
  }

  if (requiredReceiptSnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push('CI workflow verifies an exact-tree source-run receipt before dispatching deploys.')
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

export function evaluateDeployWorkflow(rawWorkflow, workflowName) {
  const failures = []
  const passes = []
  const receiptTitle = workflowName === 'Deploy to GitHub Pages'
    ? "format('Deploy Pages receipt {0} {1}', inputs.source_run_id, inputs.deploy_sha)"
    : "format('Deploy Supabase receipt {0} {1}', inputs.source_run_id, inputs.deploy_sha)"

  if (!rawWorkflow.includes('workflow_dispatch:')) {
    failures.push(`${workflowName} workflow must support workflow_dispatch for verified receipts.`)
  } else {
    passes.push(`${workflowName} workflow supports verified receipt dispatch.`)
  }

  if (!rawWorkflow.includes('workflow_run:')) {
    failures.push(`${workflowName} workflow must keep its successful-CI workflow_run trigger.`)
  } else {
    passes.push(`${workflowName} workflow keeps the successful-CI workflow_run trigger.`)
  }

  if (!rawWorkflow.includes("github.event_name == 'workflow_dispatch'")) {
    failures.push(`${workflowName} workflow jobs must run when a verified receipt dispatches it.`)
  } else {
    passes.push(`${workflowName} workflow jobs run for verified receipt dispatch.`)
  }

  const requiredPinnedDispatchSnippets = [
    receiptTitle,
    "!startsWith(github.event.workflow_run.display_title, 'CI receipt source ')",
    'deploy_sha:',
    'source_run_id:',
    "ref: ${{ inputs.deploy_sha || github.event.workflow_run.head_sha || 'master' }}",
    'cancel-in-progress: false',
    'queue: max',
  ]
  for (const snippet of requiredPinnedDispatchSnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`${workflowName} workflow is missing pinned/idempotent dispatch behavior: ${snippet}`)
    }
  }
  if (requiredPinnedDispatchSnippets.every(snippet => rawWorkflow.includes(snippet))) {
    passes.push(`${workflowName} pins verified deploys and serializes dispatches safely.`)
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}

export function evaluateSupabaseOAuthOrigin(rawWorkflow) {
  const failures = []
  const passes = []
  const productionSiteUrl = 'https://xaoilin.github.io/helm'
  const expectedPatch = `--data '{"site_url":"${productionSiteUrl}","oauth_server_enabled":true,"oauth_server_allow_dynamic_registration":true,"oauth_server_authorization_path":"/helm/oauth/consent"}'`
  const expectedVerification = `.site_url == "${productionSiteUrl}"`

  if (!rawWorkflow.includes(expectedPatch)) {
    failures.push(
      `Supabase deploy workflow must configure the production OAuth Site URL in the same fail-closed PATCH as the OAuth server settings: ${productionSiteUrl}.`,
    )
  } else {
    passes.push('Supabase deploy workflow configures the production Sabah One OAuth origin atomically.')
  }

  if (!rawWorkflow.includes(expectedVerification)) {
    failures.push(
      `Supabase deploy workflow must verify the returned production OAuth Site URL: ${productionSiteUrl}.`,
    )
  } else {
    passes.push('Supabase deploy workflow verifies the returned production Sabah One OAuth origin.')
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}

export function evaluateNativeStoreAllowlist(rootDir) {
  const failures = []
  const passes = []
  const storeKeysSource = readFileSync(resolve(rootDir, 'src', 'store', 'storeKeys.ts'), 'utf8')
  const projectPersistenceSource = readFileSync(
    resolve(rootDir, 'src', 'store', 'projectPersistence.ts'),
    'utf8',
  )
  const commandsSource = readFileSync(resolve(rootDir, 'src-tauri', 'src', 'commands.rs'), 'utf8')

  const sharedKeys = [...storeKeysSource.matchAll(/\{\s*key:\s*'([^']+)'/gu)]
    .map((match) => match[1])
  const deviceKeys = [...projectPersistenceSource.matchAll(
    /export const PROJECT_[A-Z_]+_STORE_KEY\s*=\s*'([^']+)'/gu,
  )].map((match) => `device-${match[1]}`)
  const allowlistBody = commandsSource.match(
    /const ALLOWED_STORE_KEYS:\s*&\[&str\]\s*=\s*&\[(.*?)\];/su,
  )?.[1] ?? ''
  const allowedKeys = [...allowlistBody.matchAll(/"([^"]+)"/gu)].map((match) => match[1])
  const expectedKeys = [...new Set([...sharedKeys, ...deviceKeys, 'workspaces'])].sort()
  const actualKeys = [...new Set(allowedKeys)].sort()
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key))
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key))

  if (missing.length > 0) {
    failures.push(`Native store allowlist is missing: ${missing.join(', ')}.`)
  }
  if (unexpected.length > 0) {
    failures.push(`Native store allowlist has undeclared keys: ${unexpected.join(', ')}.`)
  }
  if (missing.length === 0 && unexpected.length === 0) {
    passes.push('Native store allowlist matches every declared shared, device, and legacy store key.')
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

  const deployWorkflows = [
    ['Deploy to GitHub Pages', resolve(rootDir, '.github', 'workflows', 'deploy.yml')],
    [
      'Deploy Supabase Assistant Function',
      resolve(rootDir, '.github', 'workflows', 'deploy-supabase-assistant.yml'),
    ],
  ]

  for (const [workflowName, workflowPath] of deployWorkflows) {
    const deployResult = evaluateDeployWorkflow(readFileSync(workflowPath, 'utf8'), workflowName)
    failures.push(...deployResult.failures)
    passes.push(...deployResult.passes)
  }

  const supabaseOAuthOriginResult = evaluateSupabaseOAuthOrigin(
    readFileSync(resolve(rootDir, '.github', 'workflows', 'deploy-supabase-assistant.yml'), 'utf8'),
  )
  failures.push(...supabaseOAuthOriginResult.failures)
  passes.push(...supabaseOAuthOriginResult.passes)

  const nativeStoreResult = evaluateNativeStoreAllowlist(rootDir)
  failures.push(...nativeStoreResult.failures)
  passes.push(...nativeStoreResult.passes)

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}
