import {
  evaluateCiWorkflow,
  evaluateDeployWorkflow,
  findForbiddenLocalDateSlicingInText,
  REQUIRED_CI_CHECKS,
} from '../../scripts/lib/agentPolicy.mjs'

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

    const workflow = `${checkJobs}
  auto-promote:
    name: auto-promote
    if: github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.base.ref == 'master' && startsWith(github.event.pull_request.head.ref, 'codex/')
    steps:
      - run: gh pr merge "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --squash --delete-branch
      - run: |
          for workflow in "CI" "Deploy to GitHub Pages" "Deploy Supabase Assistant Function"; do
            gh workflow run "$workflow" --repo "$GITHUB_REPOSITORY" --ref master
          done
`

    expect(evaluateCiWorkflow(workflow).ok).toBe(true)
  })

  it('requires deploy workflows to support direct auto-promote dispatch', () => {
    const workflow = `on:
  workflow_dispatch:
  workflow_run:
    workflows: ["CI"]
`

    expect(evaluateDeployWorkflow(workflow, 'Deploy to GitHub Pages').ok).toBe(true)
  })

  it('flags missing automation gates', () => {
    const result = evaluateCiWorkflow(`  lint:
    name: lint
`)

    expect(result.ok).toBe(false)
    expect(result.failures).toContain('CI workflow is missing the codex-review job.')
  })
})
