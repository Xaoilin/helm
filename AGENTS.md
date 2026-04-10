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

- Do not use `toISOString().split('T')[0]` for local date comparisons. Use the local-date helpers already established in the codebase.
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
- `npm run check`

Also do manual QA before reporting back on any delivered feature. Changes that touch UI, voice, OAuth, wake-word, or external integrations always require a direct manual validation pass, and user-facing changes should include screenshot evidence when practical.

## Definition Of Done

- Code changes are complete.
- Relevant checks are green.
- Manual QA has been completed for the delivered feature before reporting back, with screenshot evidence for user-facing changes when practical, and the result is called out in the handoff.
- Documentation is updated in the same change.
- User-facing copy reflects the real runtime state.
- `docs/feature-status.md` is updated when a feature moves between `real`, `local-only/degraded`, or `placeholder/simulated`.

## Working Rules

- Use a dedicated branch per task. `codex/<short-description>` is the default branch style.
- When meaningful work is complete and validation is green, land it through the normal branch -> commit -> merge -> deploy-verification flow unless the user explicitly wants it kept local or unmerged.
- After a task branch is merged, delete that branch locally and on `origin` so stale merged branches do not accumulate. If a branch is still unmerged, call that out explicitly instead of leaving its status ambiguous.
- Reproduce bugs before fixing them, then add a regression test.
- Do not swallow errors silently. Log failures consistently and surface user-facing failures in the UI where appropriate.
- Prefer domain-context changes over growing the compatibility shell in `AppContext.tsx`.
- Keep constants in `src/config/constants.ts` instead of adding unexplained literals.
- Prefer truthful degraded-state messaging such as "Ollama offline" or "local-only" over vague fallback wording.

## Deeper Docs

- `docs/project-architecture.md`
- `docs/engineering-guide.md`
- `docs/feature-status.md`
- `docs/assistant-command-architecture.md`
