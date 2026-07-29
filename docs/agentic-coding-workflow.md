# Agentic Coding Workflow

This note records the current best-practice setup for HELM's AI-assisted development flow. The core lesson from the research is simple: prompts are useful for intent, but anything mandatory must become an executable gate.

## Research Findings

- Keep `AGENTS.md` short and operational. OpenAI's Codex guidance says Codex loads layered `AGENTS.md` files before work, while OpenAI's harness engineering write-up recommends treating the root instruction file as a map into deeper docs rather than a giant manual.
- Give agents deterministic feedback loops. Anthropic's Claude Code best practices emphasize tests, screenshots, expected outputs, and inspectable success criteria. Their hooks documentation and OpenAI's Codex hooks documentation both describe lifecycle hooks for blocking commands, formatting, policy checks, and stop-time validation.
- Use local hooks for fast feedback, not final authority. pre-commit and Lefthook both support fast local checks, but local hooks can be skipped, so CI and branch protection remain the source of truth.
- Review agent-authored PRs automatically when the model service is available. OpenAI documents Codex PR review and `openai/codex-action`; GitHub documents Copilot cloud agent workflows where agents create branches and PRs, then iterate through the same checks as humans. For HELM, deterministic gates are the release authority, while Codex review is an extra safety layer that must degrade cleanly when API quota or provider availability is unavailable.
- Enforce release readiness with GitHub controls. GitHub branch protection supports required status checks, pull request requirements, merge queues, deployment requirements, and admin bypass controls. For HELM's personal-app workflow, zero human approvals plus strong automated gates gives better throughput without removing traceability.
- Keep release automation boring. release-please and semantic-release are useful when changelog and version bumps become painful, but HELM already has synchronized release files and a visible release badge, so the current per-feature patch bump remains the least disruptive option.

## HELM Policy

HELM uses a branch-to-production flow for personal use:

1. Work starts on a `codex/*` branch.
2. The branch bumps the app version above `origin/master` once, before iterative policy checks.
3. `npm run agent:fast` selects the smallest safe feedback loop from every change against `origin/master`, including staged, unstaged, and untracked files.
4. The pre-push hook runs the single full local gate, `npm run check`, once.
5. CI runs stable `agent-policy`, `lint`, `typecheck`, `unit`, `e2e`, `build`, `native`, and `codex-review` checks. Draft PRs do not consume runners, and a newer PR run cancels its predecessor.
6. `codex-review` fails the PR for P0 or P1 findings when a review completes, allows P2/P3 findings to remain advisory, and treats missing keys, quota exhaustion, or provider failures as advisory unavailable.
7. Frontend-only PRs satisfy `native` without starting macOS/Windows. Native-impact PRs require both cached platform jobs.
8. `auto-promote` records the tested PR merge-tree, squash-merges, and proves that the resulting `master` tree is byte-for-byte identical.
9. Verification-only CI revalidates the successful source run, PR identity, required jobs, and live `master` tree under the same promotion lock. Direct pushes and ordinary manual dispatches still run the full suite.
10. Pages and Supabase deployments remain required, and `npm run handoff:check` proves the release is live.

This is intentionally no-human-review for now. It is appropriate because HELM is a personal app, the checks are broad, and the release gate verifies the deployed version before work is called shipped.

## Local Feedback Contract

- `npm run hooks:install` points Git at `.githooks`.
- `.githooks/pre-commit` runs only `git diff --cached --check`.
- `.githooks/pre-push` runs `npm run check`.
- `npm run agent:fast` is the default iteration command and prints selected/skipped checks plus timings.
- `npm run check` is the only full local validation gate. After the fast policy guard, lint, incremental typecheck, Vitest, blocking E2E, the web build, and relevant native tests run concurrently.
- `npm run test:e2e:smoke` is rapid behavior feedback on a fresh isolated port.
- `npm run test:e2e` is blocking behavior and responsive overflow.
- `npm run test:e2e:visual -- --surface <name> --viewports <csv>` is opt-in screenshot evidence.
- `npm run handoff:check` remains the shipped-release gate.

Do not run the primitive commands and then their aggregate gate. Focused primitives are reserved for diagnosis.

The policy scanner currently enforces:

- release/version files stay in sync through `npm run version:check`,
- `codex/*` branches have a version above `origin/master`,
- tracked source/docs avoid UTC string slicing for local dates,
- CI keeps stable required names, draft/concurrency guards, conditional native proof, exact-tree receipts, and the advisory Codex review fallback that branch protection depends on.

## Why There Is No HELM MCP

The valuable agent interactions already have deterministic interfaces: typed Tauri IPC and Rust tests for privileged native behavior, typed Playwright scenarios and route mocks for user flows, and the Debug surface for runtime diagnostics. A custom MCP layer would duplicate those contracts without removing a measured bottleneck. Reconsider it only if future traces show interaction/setup still consumes more than 20% of agent task time.

## Performance Budgets

Measure warm local runs and hosted job durations; do not infer speed from command count.

- representative `agent:fast`: at most 12 seconds
- full local `check` median: at most 32 seconds
- Vitest: at most 10 seconds locally and 30 seconds in CI
- blocking E2E: at most 22 seconds locally and 60 seconds in CI
- cached native test: at most 15 seconds per OS, with cold compile recorded separately
- PR CI p50: at most 75 seconds
- merge-to-release p50: at most 140 seconds
- PR runner occupancy: at most 6.5 minutes

The local runners write machine-readable timing reports under ignored `test-results/`.

## Sources

- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI Codex hooks](https://developers.openai.com/codex/hooks)
- [OpenAI Codex GitHub Action](https://github.com/openai/codex-action)
- [OpenAI harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI Codex PR review cookbook](https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk)
- [Anthropic Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [GitHub Copilot cloud agent best practices](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub GITHUB_TOKEN workflow-trigger behavior](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)
- [pre-commit.ci](https://pre-commit.ci/)
- [Lefthook](https://lefthook.dev/)
- [release-please](https://github.com/googleapis/release-please)
- [semantic-release](https://github.com/semantic-release/semantic-release)
