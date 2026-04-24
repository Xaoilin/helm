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
2. The branch must bump the app version above `origin/master`.
3. The branch opens a PR into `master`.
4. CI runs `agent-policy`, `lint`, `typecheck`, `unit`, `e2e`, `build`, and `codex-review`.
5. `codex-review` fails the PR for P0 or P1 findings when a review completes, allows P2/P3 findings to remain advisory, and treats missing keys, quota exhaustion, or provider failures as advisory unavailable instead of blocking release.
6. `auto-promote` squash-merges non-draft same-repo `codex/*` PRs into `master` when every gate passes.
7. The merge explicitly dispatches `CI` on `master` so the existing deploy workflows continue through GitHub Pages and Supabase.
8. `npm run handoff:check` remains the proof that the release is truly live.

This is intentionally no-human-review for now. It is appropriate because HELM is a personal app, the checks are broad, and the release gate verifies the deployed version before work is called shipped.

## Mandatory Gates

- `npm run hooks:install` points Git at `.githooks`.
- `.githooks/pre-commit` runs `npm run agent:policy` and `npm run lint`.
- `.githooks/pre-push` runs `npm run check`.
- `npm run agent:policy` runs version checks and HELM-specific policy checks.
- `npm run agent:local-gate` runs policy, lint, typecheck, and unit tests for a faster local confidence pass.
- `npm run check` remains the full local validation gate.
- `npm run handoff:check` remains the shipped-release gate.

The policy scanner currently enforces:

- release/version files stay in sync through `npm run version:check`,
- `codex/*` branches have a version above `origin/master`,
- tracked source/docs avoid UTC string slicing for local dates,
- CI keeps the required check names, auto-promote guards, and advisory Codex review fallback that branch protection depends on.

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
- [pre-commit.ci](https://pre-commit.ci/)
- [Lefthook](https://lefthook.dev/)
- [release-please](https://github.com/googleapis/release-please)
- [semantic-release](https://github.com/semantic-release/semantic-release)
