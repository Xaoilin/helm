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

  return `run-name: \${{ format('CI receipt source {0} tree {1}', inputs.source_run_id, inputs.tested_tree) }}
on:
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
  group: ci-\${{ github.workflow }}-\${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}
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
  unit-shard:
    name: unit-\${{ matrix.shard }}-of-2
    steps:
      - run: npm run test -- --config vite.config.ts --shard=\${{ matrix.shard }}/2
  unit-aggregate:
    env:
      UNIT_SHARDS_RESULT: \${{ needs['unit-shard'].result }}
  e2e-browser:
    steps:
      - run: google-chrome --version
  record-tree:
    steps:
      - run: node ./scripts/verify-ci-receipt.mjs record
      - uses: actions/upload-artifact@v5
  receipt:
    concurrency:
      group: helm-auto-promote-master
      cancel-in-progress: false
      queue: max
    steps:
      - run: node ./scripts/verify-ci-receipt.mjs wait
      - uses: actions/download-artifact@v5
        with:
          run-id: \${{ inputs.source_run_id }}
      - run: node ./scripts/verify-ci-receipt.mjs verify
      - name: Trigger deploy workflows after verified receipt
        env:
          DEPLOY_SHA: \${{ steps.verify.outputs.verified_sha }}
        run: node ./scripts/verify-ci-receipt.mjs dispatch-deploys
  auto-promote:
    name: auto-promote
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.base.ref == 'master' && startsWith(github.event.pull_request.head.ref, 'codex/')
    concurrency:
      group: helm-auto-promote-master
      cancel-in-progress: false
      queue: max
    steps:
      - uses: actions/upload-artifact@v5
        with:
          overwrite: true
      - run: node ./scripts/verify-ci-receipt.mjs merge-state
      - run: node ./scripts/verify-ci-receipt.mjs pre-merge
      - run: |
          gh pr merge "$PR_NUMBER" --squash --delete-branch --match-head-commit "$SOURCE_HEAD_SHA" --subject "$pr_title (#$PR_NUMBER)"
      - run: node ./scripts/verify-ci-receipt.mjs merged-tree
      - run: node ./scripts/verify-ci-receipt.mjs dispatch-receipt
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

    const sharedMasterQueue = validCiWorkflow().replace(
      "github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id",
      'github.event.pull_request.number || github.ref',
    )
    expect(evaluateCiWorkflow(sharedMasterQueue)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "CI workflow is missing required fast-feedback behavior: github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id",
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
    const workflow = `run-name: ${"${{ format('Deploy Pages receipt {0} {1}', inputs.source_run_id, inputs.deploy_sha) }}"}
on:
  workflow_dispatch:
    inputs:
      deploy_sha:
      source_run_id:
  workflow_run:
    workflows: ["CI"]
concurrency:
  group: pages
  cancel-in-progress: false
  queue: max
jobs:
  deploy:
    if: ${"${{ github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && !startsWith(github.event.workflow_run.display_title, 'CI receipt source ')) }}"}
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${"${{ inputs.deploy_sha || github.event.workflow_run.head_sha || 'master' }}"}
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
