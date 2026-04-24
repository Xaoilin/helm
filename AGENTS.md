# HELM

HELM is a local-first desktop assistant app called Lina. The stack is Tauri 2, React 19, TypeScript 5, and Vite. Treat the codebase as the source of truth over legacy docs.

## Critical Facts

- `src/types/domain.ts` is the source of truth for app data shapes.
- `src/App.tsx` renders the shell, global navigation, and the floating voice assistant.
- `src/store/AppContext.tsx` is a compatibility facade that composes domain providers from `src/store/contexts/`.
- Persistence lives in `src/store/persistence.ts`: signed-in users read from Supabase first, signed-out users read from Tauri file storage first, and `localStorage` is the fast cache.
- Supabase auth and sync live in `src/store/supabase.ts`. Google Calendar connection is separate and uses GIS tokens through `src/services/googleAuth.ts` plus `src/surfaces/IntegrationsSurface.tsx`.
- Lina command handling is expected to stay shared between voice and chat through the assistant runtime. Do not reintroduce separate parsing or mutation paths per surface.

## Must-Follow Invariants

- Do not derive local dates by slicing UTC ISO strings. Use the local-date helpers already established in the codebase.
- Preserve the local-first persistence model and the signed-in Supabase precedence rules.
- Calendar data is hierarchical: account -> source -> event. Removing an account must continue to cascade cleanly.
- Multi-account Google Calendar support is intentional. Do not collapse it back to a single-account model.
- Credentials are currently stored locally and are not an encrypted vault. Do not document or present them as secure secret storage.
- UI copy must match the real implementation status. Do not describe degraded, local-only, or simulated features as fully live.

## Verification

Run the relevant checks before closing out meaningful code changes:

- `npm run lint`
- `npm run typecheck`
- `.\node_modules\.bin\tsc.cmd -b`
- `npm run test`
- `npm run test:e2e`
- `npm run build`
- `npm run agent:policy`
- `npm run agent:local-gate`
- `npm run check`

Also do manual QA before reporting back on any delivered feature. Changes that touch UI, voice, OAuth, wake-word, or external integrations always require a direct manual validation pass, and user-facing changes should include screenshot evidence when practical.
For user-facing changes, add a post-implementation UI design review pass before handoff. Check rendered spacing, text wrapping, visual hierarchy, responsive fit, and obvious focus or hover state regressions, then capture the screenshot evidence from the reviewed UI.

Run `npm run handoff:check` at the end of every completed feature handoff. If it fails, the job is not done yet. Keep going until it passes unless the user explicitly asked to keep the work local/unmerged or an external access blocker makes completion impossible.

Before reporting meaningful feature work back as completed, `npm run handoff:check` must pass after merge and deploy. That command is the release gate for "no uncommitted non-generated changes, merged to master, deployed, live version verified, and merged topic branches cleaned up."

## Definition Of Done

- Code changes are complete.
- Relevant checks are green.
- Manual QA has been completed for the delivered feature before reporting back, with screenshot evidence for user-facing changes when practical, and the result is called out in the handoff.
- Documentation is updated in the same change.
- User-facing copy reflects the real runtime state.
- The task branch includes a release version bump.
- `docs/feature-status.md` is updated when a feature moves between `real`, `local-only/degraded`, or `placeholder/simulated`.
- `npm run handoff:check` passes unless the user explicitly chose a local-only or unmerged outcome.

## Working Rules

- Use a dedicated branch per task. `codex/<short-description>` is the default branch style.
- Every feature branch must bump the app version, keep the release files in sync, and report that version back in the handoff even if the work is still branch-only.
- Every completed feature handoff must include the `npm run handoff:check` result, and that result must be passing unless the user explicitly wants a local-only or unmerged outcome.
- When meaningful work is complete and validation is green, continue through the normal branch -> commit -> merge -> deploy-verification flow automatically unless the user explicitly wants it kept local or unmerged. Do not wait for a separate "release it" prompt to finish the job.
- Same-repo, non-draft `codex/*` PRs into `master` are expected to auto-promote after the required automated gates pass. Do not add a manual review requirement unless the user explicitly asks for a human-gated release.
- OpenAI quota, credentials, or provider availability for `codex-review` are not release blockers. Treat unavailable automated review as an advisory warning, while still blocking on P0/P1 findings if a review completes successfully.
- Do not describe a user-facing change as live, shipped, or on the website until it has been merged to `master`, the deployment has completed successfully, and `npm run handoff:check` has passed. If work is only local or branch-only, say that explicitly.
- After a task branch is merged, delete that branch locally and on `origin` so stale merged branches do not accumulate. If a branch is still unmerged, call that out explicitly instead of leaving its status ambiguous.
- Reproduce bugs before fixing them, then add a regression test.
- For every bug, regression, or feature that did not behave as expected, perform a five-whys root-cause analysis before planning or implementing the fix. Keep asking "why" until the real failing layer is identified instead of stopping at the first visible symptom.
- For integrations, auth, sync, backend-dependent features, or other opaque user-facing fixes, assume the first confident implementation may still fail in reality. Prepare explicitly for the scenario where you deliver a fix confidently and the real world proves it wrong. Ship observability in the same change by default, ideally by adding or extending a Debug surface for the affected feature. If a dedicated debug page is not appropriate, document the alternate diagnostics path explicitly in the handoff and the code comments or docs.
- Do not swallow errors silently. Log failures consistently and surface user-facing failures in the UI where appropriate.
- Prefer domain-context changes over growing the compatibility shell in `AppContext.tsx`.
- Keep constants in `src/config/constants.ts` instead of adding unexplained literals.
- Prefer truthful degraded-state messaging such as "Ollama offline" or "local-only" over vague fallback wording.

## Deeper Docs

- `docs/project-architecture.md`
- `docs/engineering-guide.md`
- `docs/feature-status.md`
- `docs/assistant-command-architecture.md`
- `docs/agentic-coding-workflow.md`
