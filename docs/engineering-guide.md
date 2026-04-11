# Engineering Guide

## Workflow

- Use a dedicated branch for each task. `codex/<short-description>` is the default.
- When meaningful work is complete and relevant checks are green, use the normal branch -> commit -> PR/merge -> deploy-verification flow instead of leaving finished work only in a local checkout.
- Do not call a user-facing change live, shipped, or deployed until it is merged to `master`, the deployment has succeeded, and the deployed result has been verified directly. `npm run handoff:check` is the required proof point for that state. If the change only exists locally or on a branch, say that explicitly in the handoff.
- After a task branch is merged, delete it locally and on `origin`. If any branch remains unmerged, call out its status explicitly instead of leaving stale topic branches around.
- If the user explicitly asks to keep work local or unmerged, follow that request.
- Reproduce a bug before fixing it. Trace the root cause instead of patching symptoms.
- For every bug, regression, or feature failure, do a five-whys pass before solution planning or implementation. Ask "why did this happen?" repeatedly until you identify the root cause at the correct layer, not just the first visible symptom.
- Add a regression test for every bug fix that changes logic.
- Keep changes scoped. If a task spans multiple domains, prefer small coherent commits over one broad sweep.

## Root Cause Analysis

- Use five whys as the default root-cause method for issues and broken features.
- Start with the user-visible failure, then ask why at least five times or until the chain stops yielding a deeper causal layer.
- Do not jump from symptom to patch. Finish the root-cause pass first, then plan the fix against the deepest validated cause.
- If the chain reveals multiple contributing causes, fix the primary root cause first and call out the secondary causes in the handoff.
- Include the root-cause summary in your final handoff whenever it materially explains the fix or prevents future regressions.

## Definition Of Done

A change is not done until all of the following are true:

- code behavior is complete
- relevant checks are green
- manual QA has been completed for the delivered feature before reporting back, with screenshot evidence for user-facing changes when practical, and the result is included in the handoff
- docs are updated in the same change
- user-facing copy matches the actual behavior
- `docs/feature-status.md` is updated if feature status changed

## Verification Commands

Use the repo scripts or local binaries directly:

- `npm run version:check`
- `npm run lint`
- `npm run typecheck`
- `.\node_modules\.bin\tsc.cmd -b`
- `npm run test`
- `npm run test:e2e`
- `npm run build`
- `npm run check`

For small changes, run the most relevant checks first. Before landing broader code changes, run the full set above unless a dependency or environment blocker prevents it.

Before claiming a user-facing change is live or shipped, also run `npm run handoff:check` after merge and deploy. That command fails if uncommitted non-generated changes remain, if the work is still branch-only, if the `master` CI or deploy workflows have not succeeded for the deployed head, if the live GitHub Pages bundle is not serving the current version, or if merged `codex/` branches still exist.

## Release Versioning

- HELM release versions use semver and must stay aligned across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- The UI release badge is sourced from the build version and is intentionally pinned in the shell sidebar so the current build is always visible.
- Every feature branch must include a version bump before handoff. Do not leave feature work on a branch at the previous release number.
- Use `npm version <patch|minor|major> --no-git-tag-version` for a release bump, then run `npm run version:sync` if you edited files manually. `npm run version:check` is the guardrail that catches drift before handoff and now also fails `codex/*` branches that have not bumped above `origin/master`.
- Every handoff must call out the current release version explicitly, including branch-only or local-only work.
- Final handoffs for shipped work should call out the release version explicitly and mention the `npm run handoff:check` result so the user can verify both the UI badge and the deployment state.

## CI And Branch Protection

- The CI workflow job names are part of the contract with GitHub branch protection. Keep them as `lint`, `typecheck`, `unit`, `e2e`, and `build`.
- `master` should stay protected with pull requests required and those five checks required before merge.
- The normal landing path is therefore a small branch and PR into `master`, not direct commits to `master` or long-lived finished changes sitting only locally.
- Deploy should continue to trigger only from a successful CI run on `master`, not from arbitrary pushes or partial workflows.

## Testing Expectations

### Unit tests

- Add or update Vitest coverage for new business logic.
- Store and state changes should be exercised at the CRUD level where practical.
- Service tests should mock network calls and assert error handling, not only happy paths.

### E2E tests

- User-facing features should have Playwright coverage when they change visible flows.
- Navigation, CRUD flows, settings persistence, and assistant interactions are strong E2E candidates.
- If an existing spec covers the journey, extend it instead of creating duplicate coverage.

### Manual testing

Manual QA is required before reporting back on any delivered feature. Automated coverage is not a substitute for checking the real rendered behavior of the change.

Changes that touch the following areas always require a direct manual verification pass:

- microphone input and speech output
- wake-word detection
- OAuth popup flows
- Monzo live sync
- time-dependent prayer and notification behavior
- any UI or visible user flow change

For user-facing changes, capture screenshot evidence when practical as part of the manual QA pass.

For every delivered feature, say clearly what you verified manually, include the relevant screenshot evidence when practical, and call out what still needs a follow-up pass, if anything.

## Error Handling And Resilience

- Do not swallow errors silently. Use the shared logger helpers and keep the message source obvious.
- User-visible failures should surface in the UI through an error state, inline message, or retry path.
- New remote integrations should use the existing resilience utilities where they fit:
  - `src/services/circuitBreaker.ts`
  - `src/services/retry.ts`
  - `src/services/serviceBreakers.ts`
- Network calls should use established timeout constants rather than ad hoc values.

## Code Quality Rules

- Keep domain types in `src/types/domain.ts`.
- Prefer extending the domain contexts under `src/store/contexts/` over growing the compatibility shell in `src/store/AppContext.tsx`.
- Keep assistant logic shared across voice and chat instead of duplicating parsers, prompt rules, or mutation paths.
- When extending the hosted planner contract, update both `ActionPlanArgs` in `src/assistant/plannerSchema.ts` and the strict hosted JSON schema there. Every planner arg must remain a required nullable property in the schema so OpenAI structured outputs stay valid.
- Keep the hosted OpenAI Responses payload role-correct: `system` prompts belong in `instructions`, `user` history must serialize as `input_text`, and stored `assistant` history must serialize as `output_text`. Update the shared payload helper and its tests together if this contract changes.
- Extract timing, size, and threshold literals into `src/config/constants.ts`.
- Favor explicit, typed interfaces over loose objects and stringly typed state.
- When a component becomes hard to read, extract subcomponents or hooks instead of stacking more branches into one file.
- Keep lint green. If a lint rule is noisy, scope or tune it narrowly instead of weakening broader correctness rules.

## Data And Domain Invariants

- Use local-date-safe helpers for day-based logic. Avoid UTC string slicing for local calendar or task behavior.
- Preserve the account -> source -> event relationship in calendar code.
- Do not break the signed-in Supabase precedence rules in persistence.
- Keep multi-account Google Calendar behavior intact.
- Passive Google Calendar sync must stay non-interactive. Reconnect or consent flows should only happen from an explicit user action.
- Treat Google Calendar auth state as account data, not as an implicit side effect of whether a cached browser token still exists.
- Treat workspaces and credentials as first-class stored records even though their current product depth is lighter than other domains.

## Security Notes

- API keys are currently client-side configuration for a single-user MVP. Do not describe this as production-grade secret handling.
- Credentials are stored locally and are not encrypted vault storage.
- Hosted-assistant browser calls currently use the build's configured Supabase project access key. Keep the UI copy truthful about that architecture, and if tighter access control is needed later, move the OpenAI call behind a server-side auth boundary instead of implying the browser path is private.
- Avoid `dangerouslySetInnerHTML` and preserve React's default escaping protections.
- If the product ever moves beyond single-user local-first usage, secrets and privileged API calls need a server-side redesign.

## UI And UX Rules

- Preserve the established dark theme and current component language unless a deliberate redesign is in scope.
- Empty states should explain what the feature is for and give the user a clear next step.
- Destructive actions must require clear confirmation.
- Accessibility matters: keep labels, roles, keyboard interactions, and focus behavior in mind when editing UI.
- Inspect rendered UI changes directly before reporting back instead of trusting code review alone.
- Surface degraded states explicitly. Prefer "Ollama offline", "local-only", or "simulated connection" over vague fallback language.

## Documentation Rules

- `AGENTS.md` should stay short and operational.
- Long-form architecture and process material belongs under `docs/`.
- When behavior changes materially, update the relevant doc in the same change instead of letting instructions drift.
- `README.md`, `AGENTS.md`, `docs/project-architecture.md`, `docs/engineering-guide.md`, and `docs/feature-status.md` are the active source-of-truth docs.
- Status language is limited to `real`, `local-only/degraded`, and `placeholder/simulated`.
