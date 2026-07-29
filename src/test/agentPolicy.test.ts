// @vitest-environment node
import {
  evaluateCiWorkflow,
  evaluateDeployWorkflow,
  findForbiddenLocalDateSlicingInText,
  REQUIRED_CI_CHECKS,
} from '../../scripts/lib/agentPolicy.mjs'

function validCiWorkflow() {
  const checkJobs = REQUIRED_CI_CHECKS.map((checkName) => {
    if (checkName === 'codex-review') {
      return `  codex-review:
    name: codex-review
    steps:
      - id: codex_review_secret
      - if: steps.codex_review_secret.outputs.available == 'true'
        continue-on-error: true
      - run: |
          echo "Codex review did not produce output"
          echo "treating review as advisory unavailable"`
    }

    return `  ${checkName}:
    name: ${checkName}`
  }).join('\n')

  return `on:
  workflow_dispatch:
    inputs:
      tested_tree:
      source_run_id:
      source_pr:
  pull_request:
    types: [opened, synchronize, ready_for_review, converted_to_draft]
  push:
    branches: [master]
concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
jobs:
${checkJobs}
  native-changes:
    steps:
      - run: node ./scripts/detect-ci-native-impact.mjs
  native-platform:
    if: needs['native-changes'].outputs.native == 'true'
    steps:
      - uses: actions/cache@v5
  unit-config:
    steps:
      - run: npm run test -- --config vite.config.ts
  e2e-install:
    steps:
      - run: npx playwright install --with-deps --only-shell chromium
  record-tree:
    steps:
      - run: node ./scripts/verify-ci-receipt.mjs record
      - uses: actions/upload-artifact@v5
  receipt:
    concurrency:
      group: helm-auto-promote-master
      cancel-in-progress: false
    steps:
      - run: node ./scripts/verify-ci-receipt.mjs wait
      - uses: actions/download-artifact@v5
        with:
          run-id: \${{ inputs.source_run_id }}
      - run: node ./scripts/verify-ci-receipt.mjs verify
      - name: Trigger deploy workflows after verified receipt
        run: |
          for workflow in "Deploy to GitHub Pages" "Deploy Supabase Assistant Function"; do
            gh workflow run "$workflow" --repo "$GITHUB_REPOSITORY" --ref master
          done
  auto-promote:
    name: auto-promote
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.base.ref == 'master' && startsWith(github.event.pull_request.head.ref, 'codex/')
    concurrency:
      group: helm-auto-promote-master
      cancel-in-progress: false
    steps:
      - uses: actions/upload-artifact@v5
        with:
          overwrite: true
      - run: node ./scripts/verify-ci-receipt.mjs merge-state
      - run: node ./scripts/verify-ci-receipt.mjs pre-merge
      - run: |
          gh pr merge "$PR_NUMBER" --squash --delete-branch --match-head-commit "$SOURCE_HEAD_SHA" --subject "$pr_title (#$PR_NUMBER)"
      - run: node ./scripts/verify-ci-receipt.mjs merged-tree
      - run: |
          gh workflow run "CI" --repo "$GITHUB_REPOSITORY" --ref master \\
            --field "tested_tree=$TESTED_TREE" \\
            --field "source_run_id=$SOURCE_RUN_ID" \\
            --field "source_pr=$SOURCE_PR"
`
}

describe('agent policy helpers', () => {
  it('detects forbidden UTC local-date slicing', () => {
    const forbiddenLine = "const day = value.toISOString()." + "split('T')[0]"

    expect(findForbiddenLocalDateSlicingInText('sample.ts', `const ok = true\n${forbiddenLine}`)).toEqual([
      {
        filePath: 'sample.ts',
        line: 2,
      },
    ])
  })

  it('requires stable CI check names for branch protection', () => {
    expect(evaluateCiWorkflow(validCiWorkflow()).ok).toBe(true)
  })

  it('requires exact-tree receipts and fast PR cancellation', () => {
    const withoutReceipt = validCiWorkflow().replace(
      'node ./scripts/verify-ci-receipt.mjs verify',
      'echo receipt omitted',
    )
    expect(evaluateCiWorkflow(withoutReceipt)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'CI workflow is missing exact-tree receipt behavior: node ./scripts/verify-ci-receipt.mjs verify',
      ]),
    })

    const withoutCancellation = validCiWorkflow().replace(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      'cancel-in-progress: false',
    )
    expect(evaluateCiWorkflow(withoutCancellation)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "CI workflow is missing required fast-feedback behavior: cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      ]),
    })

    const autoDispatchesDeploy = `${validCiWorkflow()}
  trailing-auto-step:
    run: gh workflow run "Deploy to GitHub Pages"
`
    expect(evaluateCiWorkflow(autoDispatchesDeploy)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        'CI workflow must let successful verification trigger deploys instead of dispatching "Deploy to GitHub Pages".',
      ]),
    })
  })

  it('requires deploy workflows to support direct auto-promote dispatch', () => {
    const workflow = `on:
  workflow_dispatch:
  workflow_run:
    workflows: ["CI"]
jobs:
  deploy:
    if: ${"${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}"}
`

    expect(evaluateDeployWorkflow(workflow, 'Deploy to GitHub Pages').ok).toBe(true)
  })

  it('flags missing automation gates', () => {
    const result = evaluateCiWorkflow(`  lint:
    name: lint
`)

    expect(result.ok).toBe(false)
    expect(result.failures).toContain('CI workflow is missing the codex-review job.')
    expect(result.failures).toContain('CI workflow is missing the native job.')
  })
})
