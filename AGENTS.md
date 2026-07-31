# HELM

HELM is Lina, a local-first Tauri 2 + React 19 + TypeScript 5 app. Treat code and the linked engineering docs as authoritative over older notes.

## Start Here

1. Work from this repository root on a dedicated `codex/<topic>` branch.
2. Bump the release version once at the start of every feature branch so policy checks remain useful throughout the task.
3. Run `npm run agent:fast` while iterating. It selects checks from the complete diff against `origin/master`, including staged, unstaged, and untracked files.
4. Run focused manual QA for behavior you changed. UI work needs a rendered design review and screenshot evidence when practical.
5. Push once. The pre-push hook runs the one full local gate, `npm run check`; do not run the same primitive checks again first.
6. Continue through PR, automated promotion, deployments, branch cleanup, and a passing `npm run handoff:check`.

Install hooks once per checkout with `npm run hooks:install`. If hooks are unavailable, run `npm run check` exactly once before pushing.

## Validation Interfaces

- `npm run agent:fast` — normal agent feedback loop.
- `npm run check` — one full local gate; lint, typecheck, unit, E2E, web build, and native tests when Rust changed.
- `npm run test:related -- <files...>` — related Vitest tests.
- `npm run test:e2e:smoke` — rapid UI smoke flow on an isolated server.
- `npm run test:e2e` — blocking behavior and responsive overflow coverage.
- `npm run test:e2e:visual -- --surface <name> --viewports <csv>` — opt-in screenshot evidence.
- `npm run test:native` — pinned Rust suite.
- `npm run build:web` — Vite production build; typechecking is a separate gate.
- `npm run handoff:check` — proof that the exact release is merged, deployed, live, and clean.

Do not stack primitive commands around `agent:fast` or `check`. Run a focused failing test only when diagnosing it.

## Non-Negotiable Invariants

- `src/types/domain.ts` owns app data shapes.
- Shared app data is signed-in, database-authoritative, and online-only. Tauri persistence is limited to explicitly machine-bound state.
- Never derive local dates by slicing UTC ISO strings; use the established helpers.
- Calendar data remains account -> source -> event, with intentional multi-account support.
- Voice and chat share the assistant runtime; do not add separate mutation paths.
- Secret values belong in the account-owned Supabase Vault path. Never place plaintext in shared records, browser storage, Broadcast payloads, logs, exports, assistant context, or durable memory.
- Project catalogue metadata may sync; absolute paths, approvals, fingerprints, processes, and logs remain device-only.
- Native project execution uses Rust-normalised approved profile IDs, canonical containment, explicit fingerprinted environment, bounded logs, process-group cleanup, and native confirmation. Never execute renderer-supplied shell text.
- Do not swallow errors. Surface user-actionable failures and preserve diagnostics for opaque integrations.

## Delivery Rules

- Reproduce bugs, trace the root cause, and add a regression test.
- Update relevant docs and `docs/feature-status.md` when product status changes.
- Required PR checks keep stable names: `lint`, `agent-policy`, `typecheck`, `unit`, `e2e`, `build`, `native`, and `codex-review`.
- Same-repo, non-draft `codex/*` PRs into `master` auto-promote only after required gates.
- OpenAI review availability is advisory; completed P0/P1 findings block.
- Frontend-only PRs skip the macOS/Windows native matrix through the stable `native` aggregator. Native-impact changes require both platforms.
- Post-merge verification must prove that `master` has the exact tree tested on the PR; mismatches fail closed. Direct pushes and ordinary manual CI dispatches run the full suite.
- Never call work shipped until deployments and `npm run handoff:check` pass.

## Deeper References

- `docs/engineering-guide.md`
- `docs/project-architecture.md`
- `docs/feature-status.md`
- `docs/assistant-command-architecture.md`
- `docs/agentic-coding-workflow.md`
