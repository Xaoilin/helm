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
const TEXT_FILE_PATTERN = /\.(?:js|jsx|mjs|cjs|ts|tsx|md|json|toml|yml|yaml)$/u
const HOSTED_WEB_POLICY_PATHS = [
  'src',
  'scripts',
  '.github',
  '.relay/relay.toml',
  'AGENTS.md',
  'docs',
  'README.md',
  '.gitignore',
  'eslint.config.js',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
]
const HOSTED_WEB_POLICY_EXCLUDED_PATHS = new Set([
  'scripts/lib/agentPolicy.mjs',
  'src/test/agentWorkflow.test.ts',
])
const SABAH_ONE_NATIVE_SUPPORT_PATTERN = /(?:\b(?:Sabah One|HELM)\b[^\r\n]*(?:\b(?:desktop|local|native)\b[ _-]?(?:app(?:lication)?|assistant|runtime|runner|support|notification(?:s)?|path(?:s)?|project|folder|execution|timer|process)\b)|\b(?:desktop|local|native)\b[ _-]?(?:app(?:lication)?|assistant|runtime|runner|support|notification(?:s)?|path(?:s)?|project|folder|execution|timer|process)\b[^\r\n]*\b(?:Sabah One|HELM)\b|\bnative\s+(?:Sabah One|HELM)\b)/iu
const SABAH_ONE_LOCAL_RUNTIME_API_PATTERN = /@tauri-apps|\bsrc-tauri\b|\bTAURI_[A-Z0-9_]*\b|__TAURI(?:_[A-Z0-9]+)?__|\btauri\b|\b(?:isTauri|isTauriRuntime|tauriAvailable|readTauriRaw|getDeviceTauriKey|desktopRuntimeAvailable|projectRuntime|projectPaths|nativePrayerReminder|canUseDesktopProjectPaths|canUseProjectRuntime|pickProjectDirectory|canonicalizeProjectPath|openProjectPath|createProjectRunFingerprint|approveProjectProfile|revokeProjectProfile|revokeProjectProfilesForProject|listApprovedProjectProfiles|listProjectSessions|startProjectProfile|stopProjectSession|subscribeProjectSession|canonicalize_project_path|isAbsoluteProjectRoot|normalizePendingLegacyProjectPaths|canonicalizeProjectRoot|PROJECT_PENDING_LEGACY_PATHS_STORE_KEY|localPath)\b/iu
const NATIVE_CACHE_MACHINERY_PATTERN = /\b(?:cargo|rustup|rust|src-tauri|tauri)\b|\bnative(?:[-_ ](?:cache|build|runtime|platform|dependencies|toolchain|target|artifacts?))\b/iu

const HOSTED_WEB_POLICY_PATTERNS = {
  source: [
    {
      label: 'Tauri or native runtime reference',
      pattern: SABAH_ONE_LOCAL_RUNTIME_API_PATTERN,
    },
    {
      label: 'explicit Sabah One desktop or local application support wording',
      pattern: SABAH_ONE_NATIVE_SUPPORT_PATTERN,
    },
  ],
  scripts: [
    {
      label: 'native build or runtime tooling',
      pattern: /@tauri-apps|\bsrc-tauri\b|\b(?:cargo|rustup)\b|\btauri(?:[-./_]|$)|\bnative-(?:impact|changes|platform)\b|\btest:native\b/iu,
    },
  ],
  ci: [
    {
      label: 'native CI, platform, or release machinery',
      pattern: /@tauri-apps|\bsrc-tauri\b|\b(?:cargo|rustup)\b|\btauri(?:[-./_]|$)|\bnative-(?:impact|changes|platform)\b|\b(?:codesign|notariz(?:e|ation)?|\.dmg\b|\.msi\b|\.nsis\b)/iu,
    },
  ],
  config: [
    {
      label: 'native build or runtime configuration',
      pattern: /@tauri-apps|\bsrc-tauri\b|\b(?:cargo|rustup)\b|\btauri(?:[-./_]|$)|\bnative-(?:impact|changes|platform)\b|\b(?:codesign|notariz(?:e|ation)?|\.dmg\b|\.msi\b|\.nsis\b)/iu,
    },
  ],
  docs: [
    {
      label: 'native application support wording',
      pattern: /@tauri-apps|\bsrc-tauri\b|\b(?:cargo|rustup|tauri)\b/iu,
    },
    {
      label: 'explicit Sabah One desktop or local application support wording',
      pattern: SABAH_ONE_NATIVE_SUPPORT_PATTERN,
    },
  ],
}

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

function hostedWebPolicyCategory(filePath) {
  if (filePath.startsWith('src/')) return 'source'
  if (filePath.startsWith('scripts/')) return 'scripts'
  if (filePath.startsWith('.github/')) return 'ci'
  if (filePath === 'AGENTS.md' || filePath.startsWith('docs/') || filePath === 'README.md') return 'docs'
  return 'config'
}

function findForbiddenNativeCacheMachinery(filePath, text, category) {
  if (category !== 'ci' && category !== 'config') return []

  const findings = []
  const lines = text.split(/\r?\n/u)

  for (let index = 0; index < lines.length; index += 1) {
    const cacheStep = lines[index].match(/^(\s*)-\s+uses:\s*actions\/cache@/iu)
    if (!cacheStep) continue

    const stepIndent = cacheStep[1]
    const nextStepPattern = new RegExp(`^${escapeRegex(stepIndent)}-\\s`, 'u')
    let end = index + 1
    while (end < lines.length && !nextStepPattern.test(lines[end])) end += 1

    if (NATIVE_CACHE_MACHINERY_PATTERN.test(lines.slice(index, end).join('\n'))) {
      findings.push({
        category,
        filePath,
        line: index + 1,
        label: 'native/Cargo/Rust/src-tauri cache machinery',
      })
    }
  }

  return findings
}

export function listHostedWebPolicyFiles(rootDir) {
  const output = execFileSync('git', ['ls-files', ...HOSTED_WEB_POLICY_PATHS], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((filePath) => (
      filePath.length > 0
      && (filePath === '.gitignore' || TEXT_FILE_PATTERN.test(filePath))
      && !HOSTED_WEB_POLICY_EXCLUDED_PATHS.has(filePath)
    ))
}

export function findForbiddenHostedWebPolicyInText(filePath, text, category = hostedWebPolicyCategory(filePath)) {
  const findings = []
  const patterns = HOSTED_WEB_POLICY_PATTERNS[category] ?? []
  const lines = text.split(/\r?\n/u)

  lines.forEach((line, index) => {
    for (const { label, pattern } of patterns) {
      if (pattern.test(line)) {
        findings.push({
          category,
          filePath,
          line: index + 1,
          label,
        })
        break
      }
    }
  })

  findings.push(...findForbiddenNativeCacheMachinery(filePath, text, category))

  return findings
}

function packageNameFromLockPath(filePath) {
  const packagePath = filePath.replace(/^node_modules\//u, '')
  const parts = packagePath.split('/')
  return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function isForbiddenHostedWebPackageName(packageName) {
  return /^@tauri-apps\//iu.test(packageName)
    || /(?:^|[-/])tauri(?:$|[-/])/iu.test(packageName)
}

export function findForbiddenHostedWebDependencies(packageManifest, packageLock) {
  const findings = []
  const dependencySections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]

  for (const section of dependencySections) {
    for (const packageName of Object.keys(packageManifest?.[section] ?? {})) {
      if (isForbiddenHostedWebPackageName(packageName)) {
        findings.push({
          category: 'dependencies',
          filePath: 'package.json',
          line: null,
          label: `forbidden package in ${section}: ${packageName}`,
        })
      }
    }
  }

  for (const packagePath of Object.keys(packageLock?.packages ?? {})) {
    if (!packagePath.startsWith('node_modules/')) continue
    const packageName = packageNameFromLockPath(packagePath)
    if (packageName && isForbiddenHostedWebPackageName(packageName)) {
      findings.push({
        category: 'dependencies',
        filePath: 'package-lock.json',
        line: null,
        label: `forbidden locked package: ${packageName}`,
      })
    }
  }

  return findings
}

export function findForbiddenHostedWebPackageScripts(packageManifest) {
  const findings = []
  for (const [scriptName, scriptCommand] of Object.entries(packageManifest?.scripts ?? {})) {
    findings.push(...findForbiddenHostedWebPolicyInText(
      `package.json#scripts.${scriptName}`,
      String(scriptCommand),
      'scripts',
    ))
  }
  return findings
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
    'npm run test -- --config vite.config.ts',
    'name: unit-${{ matrix.shard }}-of-2',
    '--shard=${{ matrix.shard }}/2',
    "UNIT_SHARDS_RESULT: ${{ needs['unit-shard'].result }}",
    'name: e2e-${{ matrix.shard }}-of-3',
    'shard: [1, 2, 3]',
    'npm run test:e2e -- --fully-parallel --workers=2 --shard=${{ matrix.shard }}/3 --reporter=line',
    "E2E_SHARDS_RESULT: ${{ needs['e2e-shard'].result }}",
    'google-chrome --version',
  ]

  for (const snippet of requiredEfficiencySnippets) {
    if (!rawWorkflow.includes(snippet)) {
      failures.push(`CI workflow is missing required fast-feedback behavior: ${snippet}`)
    }
  }

  if (requiredEfficiencySnippets.every((snippet) => rawWorkflow.includes(snippet))) {
    passes.push('CI workflow cancels stale PR runs and keeps the hosted web checks balanced.')
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
  const productionSiteOrigin = 'https://xaoilin.github.io'
  const expectedPatch = `--data '{"site_url":"${productionSiteOrigin}","oauth_server_enabled":true,"oauth_server_allow_dynamic_registration":true,"oauth_server_authorization_path":"/helm/oauth/consent"}'`
  const expectedVerification = `.site_url == "${productionSiteOrigin}"`

  if (!rawWorkflow.includes(expectedPatch)) {
    failures.push(
      `Supabase deploy workflow must configure the pathless production OAuth Site URL in the same fail-closed PATCH as the /helm consent path: ${productionSiteOrigin}.`,
    )
  } else {
    passes.push('Supabase deploy workflow configures the production Sabah One OAuth origin atomically.')
  }

  if (!rawWorkflow.includes(expectedVerification)) {
    failures.push(
      `Supabase deploy workflow must verify the returned pathless production OAuth Site URL: ${productionSiteOrigin}.`,
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

export function evaluatePagesSpaFallback(packageManifest, fallbackScriptExists = true) {
  const failures = []
  const passes = []
  const expectedCommand = 'node ./scripts/copy-spa-fallback.mjs'
  const buildWeb = packageManifest?.scripts?.['build:web']

  if (typeof buildWeb !== 'string' || !buildWeb.includes(expectedCommand)) {
    failures.push(`build:web must emit the GitHub Pages SPA fallback with ${expectedCommand}.`)
  } else {
    passes.push('build:web emits the GitHub Pages SPA fallback after Vite completes.')
  }

  if (!fallbackScriptExists) {
    failures.push('GitHub Pages SPA fallback script is missing.')
  } else {
    passes.push('GitHub Pages SPA fallback script exists.')
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}

export function evaluateHostedWebCompatibilityJob(rawWorkflow) {
  const failures = []
  const passes = []
  const jobStart = rawWorkflow.search(/^  native:\s*$/mu)

  if (jobStart < 0) {
    failures.push('Hosted-web compatibility context is missing the native job.')
    return { failures, passes, ok: false }
  }

  const bodyStart = rawWorkflow.indexOf('\n', jobStart) + 1
  const nextJob = rawWorkflow.slice(bodyStart).search(/^  [A-Za-z0-9_-]+:\s*$/mu)
  const jobBody = nextJob < 0
    ? rawWorkflow.slice(bodyStart)
    : rawWorkflow.slice(bodyStart, bodyStart + nextJob)
  const forbiddenJobPatterns = [
    ['job dependencies', /^\s{4}needs:/mu],
    ['matrix or platform fan-out', /^\s{4}(?:strategy|matrix):/mu],
    ['native platform runner', /^\s{4}runs-on:\s*(?:macos|windows|\$\{\{\s*matrix\.os)/imu],
    ['checkout action', /actions\/checkout@/iu],
    ['cache action', /actions\/cache@/iu],
    ['cache configuration', /^\s{4}cache:/mu],
    ['native toolchain command', /\b(?:cargo|rustup)\b/iu],
    ['build or test command', /\bnpm\s+run\s+(?:build|test)(?::[A-Za-z0-9_-]+)?\b|\b(?:cargo|rustup)\b/iu],
  ]

  for (const [label, pattern] of forbiddenJobPatterns) {
    if (pattern.test(jobBody)) {
      failures.push(`Hosted-web compatibility native job must not contain ${label}.`)
    }
  }

  if (failures.length === 0) {
    passes.push('Hosted-web compatibility native job is a no-op with no build, test, cache, or native platform machinery.')
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}

export function evaluateHostedWebPolicy(rootDir) {
  const failures = []
  const passes = []
  const findings = []
  const trackedFiles = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  if (existsSync(resolve(rootDir, 'src-tauri')) || trackedFiles.some((filePath) => (
    filePath === 'src-tauri' || filePath.startsWith('src-tauri/')
  ))) {
    failures.push('Hosted-web policy forbids the src-tauri application subtree.')
  } else {
    passes.push('Hosted-web policy confirms that the src-tauri application subtree is absent.')
  }

  if (trackedFiles.some((filePath) => /^(?:Cargo\.toml|Cargo\.lock)$/u.test(filePath))) {
    failures.push('Hosted-web policy forbids tracked root Cargo manifests.')
  }

  for (const filePath of listHostedWebPolicyFiles(rootDir)) {
    const absolutePath = resolve(rootDir, filePath)
    if (!existsSync(absolutePath)) continue
    const category = hostedWebPolicyCategory(filePath)
    findings.push(...findForbiddenHostedWebPolicyInText(
      filePath,
      readFileSync(absolutePath, 'utf8'),
      category,
    ))
  }

  const ciWorkflow = readFileSync(resolve(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8')
  const compatibilityResult = evaluateHostedWebCompatibilityJob(ciWorkflow)
  failures.push(...compatibilityResult.failures)
  passes.push(...compatibilityResult.passes)

  let packageManifest
  let packageLock
  try {
    packageManifest = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'))
    packageLock = JSON.parse(readFileSync(resolve(rootDir, 'package-lock.json'), 'utf8'))
  } catch (error) {
    failures.push(`Hosted-web policy could not parse package manifests: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (packageManifest && packageLock) {
    findings.push(...findForbiddenHostedWebDependencies(packageManifest, packageLock))
    findings.push(...findForbiddenHostedWebPackageScripts(packageManifest))
  }

  for (const finding of findings) {
    const location = finding.line === null ? finding.filePath : `${finding.filePath}:${finding.line}`
    failures.push(`Hosted-web policy found ${finding.label} at ${location}.`)
  }

  if (findings.length === 0) {
    passes.push('Hosted-web policy scan covers source, dependencies, scripts, CI/config, and live docs.')
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

  const pagesSpaFallbackResult = evaluatePagesSpaFallback(
    JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')),
    existsSync(resolve(rootDir, 'scripts', 'copy-spa-fallback.mjs')),
  )
  failures.push(...pagesSpaFallbackResult.failures)
  passes.push(...pagesSpaFallbackResult.passes)

  const hostedWebResult = evaluateHostedWebPolicy(rootDir)
  failures.push(...hostedWebResult.failures)
  passes.push(...hostedWebResult.passes)

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}
