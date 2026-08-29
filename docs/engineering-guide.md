# Engineering Guide

## Hosted Web Delivery

Sabah One is delivered as a GitHub Pages website backed by Supabase. The browser page is the product boundary; GitHub Actions is the authoritative validation and deployment boundary.

The normal change flow is:

1. Work on a dedicated `codex/<short-description>` branch.
2. Keep the change within its stated ownership and preserve unrelated work.
3. Add or update the smallest relevant regression coverage and documentation.
4. Let the protected pull-request checks validate the exact branch contents.
5. Have Sol integrate the accepted commit, publish the website and required Supabase functions, and verify the deployed result.

A branch-only change is not deployed or live. The deployed Pages bundle, its `public/release.json` manifest, and the associated Supabase functions must describe the same product version and candidate.

## Root Cause Analysis

Reproduce a defect from the user-visible failure, then trace its causes to the deepest validated layer before choosing a fix. Record contributing causes when they matter to future maintenance. Add a regression check for every logic defect.

## Definition Of Done

A feature or documentation change is ready for integration when:

- the scoped behavior or documentation is complete;
- the relevant GitHub Actions checks are green;
- visible browser behavior has been reviewed at the affected responsive widths;
- hosted integration changes have actionable diagnostics and truthful degraded states;
- account, security, and user-facing copy remain aligned;
- `docs/feature-status.md` is updated when product status changes.

Only Sol can claim the overall change live after protected promotion, GitHub Pages deployment, Supabase deployment where required, and direct live verification.

## Validation Contract

The required hosted-web checks are policy, database contract, lint, typecheck, unit, browser E2E, and web build. The risk-to-check map, focused-versus-complete gate claims, determinism rules, and known gaps are maintained in [`testing-strategy.md`](testing-strategy.md). Browser E2E covers assembled behavior; the visual path supplies screenshot evidence for surfaces where rendered review matters. The exact commands and workflow details belong to the repository automation and CI logs, not to a second product runtime.

Assistant-planning changes also keep the benchmark corpus, dialog seeds, grounded-ID expectations, and hosted threshold enforcement current. A benchmark result is evidence for its corpus and provider path, not proof of every conversation.

## Deployment Versioning

- Sabah One versions use semver across `package.json`, `package-lock.json`, and `public/release.json`.
- The web shell exposes the build version and checks the deployed manifest after load and when a hidden page becomes visible.
- A newer deployed semver causes one browser reload, so an open page can move onto the current website without a second product runtime.
- Deployment evidence identifies the source revision, web artifact, Supabase function state, Pages URL, and observed version.

## CI And Branch Protection

- `master` is protected by pull requests and the required policy, database, lint, typecheck, unit, browser E2E, web-build, and review checks.
- Pull-request runs are tied to the exact branch tree. Draft and concurrency controls prevent stale evidence from being treated as current.
- Same-repository `codex/*` pull requests can be promoted only after their required checks pass and the promoted tree is verified against the tested tree.
- GitHub Pages deployment runs only for the protected `master` path. Supabase Edge Function deployment follows the same candidate identity where a function changed.
- Automated review is advisory when the provider is unavailable; completed high-severity findings remain blocking.
- Post-promotion verification fails closed for a source, tree, artifact, deployment, or live-version mismatch.

## Testing Expectations

### Unit and contract checks

Business rules, account persistence, semantic mutations, assistant validation, and provider error mapping should have focused deterministic coverage. Service checks should exercise success and failure responses without hiding diagnostics.

### Browser E2E

User-facing flows should have Playwright coverage when they change visible behavior. Existing specs should be extended instead of duplicated. Responsive shell or surface work covers the repository's supported mobile, tablet, and wider browser widths, with no horizontal overflow and no clipped content at increased text zoom.

### Browser review

Direct browser review is required for visible user flows and especially for OAuth, microphone input, speech output, wake word, browser notification permission, page-open prayer reminders, and live integrations. Review loading, empty, success, disabled, and error states relevant to the change. Screenshot evidence is useful for layout claims but is not a substitute for behavior or hosted verification.

## Error Handling And Resilience

- Do not swallow errors. Surface a user-actionable message and preserve structured diagnostics.
- Remote integrations should use the established retry, circuit-breaker, timeout, and logging utilities where appropriate.
- Degraded states must say what is unavailable and what the user can do in the page; the in-app reminder banner is the fallback for unavailable browser notifications.
- Diagnostics redact tokens and secrets while retaining request IDs and normalized failure codes where available.

## Data And Security Invariants

- Keep domain types in `src/types/domain.ts` and the account -> source -> event Calendar hierarchy.
- Shared records are signed-in, account-owned, online-only, and database-authoritative through Supabase RLS and semantic mutation RPCs.
- Passive Google Calendar sync stays non-interactive; explicit reconnect or consent is user initiated.
- Hosted Calendar refresh credentials and Vault secret values never enter browser storage, shared payloads, logs, exports, Broadcast, or assistant context.
- The assistant keeps one shared path for chat and voice, validates grounded entities, confirms risky actions, and claims success only after verified execution.
- Project catalogue records may include names, links, documentation, and display-only guidance. They must not include private credentials or machine-specific execution state.
- Use the established local-date-safe helpers for day-based behavior; never derive local dates by slicing UTC ISO strings.

## UI And UX Rules

- Preserve the established dark theme and component language unless a redesign is in scope.
- Empty, loading, and unavailable states explain the next useful action.
- Destructive actions require clear confirmation.
- Preserve labels, roles, keyboard access, focus behavior, responsive layout, and `prefers-reduced-motion` behavior.
- Pair state colours with visible text. Browser-native behavior is an enhancement, not the sole route to an important outcome.

## Documentation Rules

- Keep `AGENTS.md` short and operational; put long-form architecture and process material under `docs/`.
- Update the relevant document in the same change when behavior or delivery boundaries change.
- `README.md`, `AGENTS.md`, `docs/project-architecture.md`, `docs/engineering-guide.md`, and `docs/feature-status.md` are active source-of-truth docs.
- `docs/agentic-coding-workflow.md` records the current hosted web automation policy.
- Status language distinguishes real behavior, degraded browser capability, and placeholder or simulated integrations.
