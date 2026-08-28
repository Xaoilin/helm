# Project Architecture

## Overview

Sabah One is an account-backed desktop assistant for a solo operator. The in-app assistant is Lina. Shared state is online-only and database-authoritative; machine-bound execution state remains device-local.

The current stack is:

- Tauri 2 for desktop packaging and local file access
- React 19 with TypeScript 5 and Vite 8 for the UI
- Supabase for required account identity, shared records, mutations, and private change notifications
- Supabase Edge Functions plus OpenAI or local Ollama for assistant orchestration
- Deepgram, ElevenLabs, and OpenWakeWord for voice features

## Runtime Map

### App shell

`src/App.tsx` renders:

- the left-hand navigation
- the persistent release badge in the sidebar footer
- the active surface
- the global `VoiceAssistant` panel
- auth controls for Supabase-backed sign-in

The shell release badge reads from the build version exposed through `src/config/release.ts`, so the visible UI version stays aligned with the packaged application version when the release files are kept in sync.
For web builds, `src/hooks/useReleaseRefresh.ts` also polls the synced `public/release.json` manifest and forces a one-time browser reload when a newer deployed semver is detected, so open tabs move onto the new release automatically after deployment. The shell now restores the last active surface from `sessionStorage` after a browser reload so a refresh does not dump the user back onto Dashboard by default.

The navigable surfaces are:

- Dashboard
- Chat
- Calendar
- Clock
- Trips
- Tasks
- Projects
- Inventory
- Secrets
- Finance
- Health
- Knowledge
- Profile
- Integrations
- Activity
- Settings
- Debug

### State composition

`src/store/AppContext.tsx` is no longer the old monolithic store. It is now a compatibility facade that composes domain providers and exposes a single app-shaped API to the rest of the UI.

Provider stack:

1. `SettingsProvider`
2. `GamificationProvider`
3. `CalendarProvider`
4. `TripProvider`
5. `ProjectProvider`
6. `TaskProvider`
7. `KnowledgeProvider`
8. `InventoryProvider`
9. `HealthProvider`
10. `FinanceProvider`
11. `PrayerProvider`
12. `DashboardFocusProvider`
13. `ClockProvider`
14. `AssistantProvider`
15. `AssistantActivityProvider`
16. `ChatProvider` through `ChatBridge`
17. `ShellProvider`

State is split across:

- `src/store/contexts/CalendarContext.tsx`
- `src/store/contexts/TripContext.tsx`
- `src/store/contexts/ProjectContext.tsx`
- `src/store/contexts/TaskContext.tsx`
- `src/store/contexts/ChatContext.tsx`
- `src/store/contexts/KnowledgeContext.tsx`
- `src/store/contexts/InventoryContext.tsx`
- `src/store/contexts/HealthContext.tsx`
- `src/store/contexts/FinanceContext.tsx`
- `src/store/contexts/PrayerContext.tsx`
- `src/store/contexts/DashboardFocusContext.tsx`
- `src/store/contexts/ClockContext.tsx`
- `src/store/contexts/GamificationContext.tsx`
- `src/store/contexts/SettingsContext.tsx`
- `src/store/contexts/AssistantContext.tsx`
- `src/store/contexts/AssistantActivityContext.tsx`

The shell layer keeps only cross-cutting UI state:

- the active surface
- one-shot assistant navigation requests

The active shell surface is also mirrored into `sessionStorage` so legitimate browser reloads can restore the current section instead of resetting to the default Dashboard view.

That navigation payload lets chat and voice hand the UI enough context to open a specific Tasks tab, reset filters, reveal or highlight a resolved task, or reveal a resolved Project after a grounded assistant action.

### Domain model

`src/types/domain.ts` defines the app's source-of-truth types, including:

- surfaces and navigation targets
- chat conversations and messages
- calendar accounts, sources, and events
- tasks, goals, daily habits, first-class prayer tasks, and project-linked workflow metadata
- projects and project wiki pages
- owned Inventory items and acquisition needs, linked to Projects by stable catalogue key
- encrypted secret metadata and one-at-a-time revealed secret details
- multi-timer and multi-stopwatch Clock state, including per-timer alarm sound selection
- knowledge topics, entries, and lifestyle items
- fast-food health log entries
- finance accounts, transactions, budgets, and savings goals
- integrations and settings

## Persistence And Sync

### Database-authoritative shared state

`src/store/persistence.ts`, `src/store/recordCodec.ts`, and `src/store/supabase.ts` enforce these boundaries:

- Shared screens mount only after an authenticated database snapshot, schema/client gate, private Broadcast subscription, and post-subscription version probe succeed.
- Signed-out, expired, or offline sessions cannot view or change shared state. Sabah One keeps no durable offline mutation queue.
- Arrays are stored as stable account-owned records with explicit positions. Clock, gamification, and prayer aggregates are decomposed into independently mutable records.
- All writes are semantic `create`, `patch`, `increment`, `delete`, `restore`, or `reorder` operations sent through one idempotent transactional RPC. Direct table writes are denied.
- Tombstones prevent stale resurrection; database commit order resolves unavoidable same-field concurrency. Reordering never deletes records.
- Private per-account Broadcast messages contain identifiers and versions only. Clients refetch through RLS, and version gaps or reconnects force an authoritative refresh.
- Account changes synchronously clear shared in-memory state before the next account can render.

Legacy `helm:<shared-key>` browser and Tauri snapshots are one-time migration inputs only. Matching database records win, safe missing fields and valid local-only records are added, counters are never summed, malformed data is quarantined outside the runtime, and the device copy is removed only after the database commit is confirmed. No conflict chooser is shown.

Absolute project roots, native approvals, fingerprints, process state, logs, microphones, and local model endpoints use explicit device-only stores. They never enter shared records. Passwords and API credentials use the separate account-owned Vault path described below; existing device integration keys are preserved only as non-destructive migration/runtime inputs.

### Desktop boundary

The Tauri side is intentionally narrow. Rust commands handle app-data directory discovery, allowlisted JSON store reads and writes, cancellable process-side prayer reminder timers, project directory picking/opening, and the trusted local project runner. The runner keeps approvals in an isolated native directory, normalises and fingerprints structured executable profiles and the device runtime path, obtains native OS confirmation, revalidates canonical paths at every start, owns process-group lifecycle and bounded logs, and stops children when Sabah One exits. It never accepts a raw renderer shell command. Prayer deadline and eligibility rules stay in TypeScript; Rust only keeps scheduled timers alive while the Sabah One process is running and delivers native notifications when they fire.

### Supabase

`src/store/supabase.ts` provides:

- Google sign-in through Supabase Auth
- session bootstrap and auth-state subscription
- account-isolated reads from `helm_account_state` and `helm_records`
- idempotent transactional calls to `apply_helm_mutations`
- private account Broadcast subscriptions plus version probes
- account-owned secret list, one-at-a-time reveal, save, archive, and restore RPCs backed by Supabase Vault

`src/AppRoot.tsx` blocks the provider tree until that database session is ready. Auth-account changes clear the previous cache before bootstrap, while same-user token refreshes keep the current account identity.

### Secrets vault

`src/surfaces/SecretsSurface.tsx` is a deliberately small personal credential manager. `helm_secret_entries` stores searchable account-owned metadata and only a UUID reference to an encrypted `vault.secrets` row. Plaintext is accepted and returned only through security-definer RPCs that derive ownership from `auth.uid()`; callers cannot supply a user ID and cannot directly access either metadata tables or the Vault schema.

The list RPC never decrypts values. Reveal fetches one active secret only, and the client clears decrypted state on Hide, surface unmount, window backgrounding, page hide, sign-out, or account switch. Private Broadcast messages contain only the request ID, secret ID, revision, archive marker, and account version. Stable `source_ref` values make legacy imports additive and idempotent without prompting the user; matching database entries win and originals are not deleted during this release.

## Integrations And External Services

### Google auth and Calendar account linking

Google identity now has two cooperating layers:

- Supabase Google sign-in for Sabah One account auth and cloud sync
- server-backed Google Calendar account auth managed through `src/services/googleCalendarAuthManager.ts`, `src/services/googleCalendarServerAuth.ts`, and `supabase/functions/google-calendar-oauth/`

The auth manager links the matching signed-in Google profile to the same-email Calendar account when possible, while still preserving multi-account Google Calendar support for additional accounts.

Important behavior:

- Google Calendar accounts persist explicit auth metadata in the domain model.
- Browser Google Calendar transport is now server-backed and refreshable. The browser only obtains Google authorization codes; refresh tokens stay on the hosted Supabase side in `google_calendar_credentials`.
- The hosted `google-calendar-oauth` function validates the Supabase session inside the function and is deployed with JWT verification disabled. This avoids Supabase Edge gateway rejects when the project issues asymmetric `ES256` access tokens.
- Production rollout for hosted Google Calendar auth requires the matching Supabase migration to be applied before or with the function deploy. The release workflow uses the repository-pinned Supabase CLI and fails closed without the database password, verified cutover-backup digest, exact historical-schema equivalence, and passing post-migration database contract.
- Calendar surfaces require Sabah One sign-in. Signed-out or offline sessions cannot open either provider-backed or manual shared calendar records.
- Passive sync is non-interactive. Opening Calendar or pressing `Sync` should never launch a consent or reconnect popup.
- Reconnect-required is a confirmed failure state, not a shortcut for "cached GIS token expired". Calendar-OAuth accounts only move into reconnect-required after passive auth actually fails, a 401 comes back, or the user no longer has transport credentials to retry with.
- Linked `profile-google` accounts stay tied to the Sabah One sign-in relationship, but the live Calendar transport is no longer the Supabase `provider_token`. Both linked and extra accounts use the same hosted refresh-token credential model.
- Row-level reconnect for linked `profile-google` accounts uses the same explicit Google Calendar authorization-code path as extra Calendar accounts, so a revoked Supabase profile refresh token cannot trap the account in a failed profile-bootstrap loop.
- Existing browser-token-only accounts are treated as legacy migration state. They keep their cached calendar data, but Sabah One asks for a one-time reconnect to upgrade them onto the durable hosted credential path.
- Accounts that lose Calendar access move into account-level states such as reconnect-required or revoked instead of surfacing as a generic global outage.
- Google Identity Services still starts the browser flow for separately connected Calendar accounts, but it now uses the authorization-code model and hands off token exchange to the hosted function.
- Explicit Google auth UI is limited to user-initiated `Reconnect` or `+ Account` flows. Background sync and manual sync are both passive, account-bound checks.

### Calendar data model

Calendar state is hierarchical:

- account
- source
- event

Sources belong to accounts, and events belong to sources. Account removal must cascade cleanly. Primary-account promotion is handled automatically when needed.

Google-backed calendar accounts also carry per-account auth metadata such as provider mode, auth status, the current hosted access-token expiry, and the last auth error so the UI can distinguish reconnect problems from service outages without confusing short-lived transport expiry for full account disconnection.
The long-lived Google sync controller now sits above the surface layer inside `src/store/AppContext.tsx` through `GoogleSyncProvider`, so tab remounts do not restart sync work.
Passive Google sync is a live mirror for successfully fetched provider data: it upserts fresher calendars and events, relinks provider events that were cached under stale local source ids, validates account ownership before mutation, removes Google calendars no longer returned by Calendar List, and removes Google events inside the fetched window when Google no longer returns them. It preserves events outside the fetch window, local/manual calendar data, and all cached data when auth, ownership, rate limit, or event fetch failures make deletion unsafe.
The Calendar surface's `Sync` button is a passive Google refresh: it mints or refreshes account-bound hosted access tokens, fetches each account's Google Calendar List, fetches events for the configured rolling window, updates Sabah One's provider cache, and never opens an OAuth prompt. The Calendar header counts visible cached events rather than all Google events returned by the API, so hidden calendars and out-of-window data are not implied to be on-screen.
Google Calendar writes from the Calendar surface go to Google first. Failed Google create, update, or delete operations leave the cached event unchanged and surface account-level error state instead of creating offline `pendingSync` mutations. Lina's assistant executor also refuses to mutate Google-backed calendar sources locally, so voice and chat cannot create hidden provider-cache drift.
The Debug surface's `Network / APIs` tab now exposes Google Calendar diagnostics as well: Supabase auth context, hosted backend readiness, credential source, hosted credential presence and health, current hosted access-token expiry, last refresh failure metadata, legacy browser-token migration state, passive-sync eligibility, trigger source, blocked reasons, wrong-account detection, skipped destructive removals, fetched event count, added/updated count, relinked cached event count, cached Google event count, visible Google event count, and a manual passive auth probe that checks access without mutating calendar sources or events.
Google Calendar diagnostics also keep a local-only persisted runtime timeline so live failures can be explained after the fact: hosted status refreshes, code-flow starts and failures, access-token mint results, calendar-list fetches, event fetches, cache reconciliation summaries, ownership mismatches, reconnects, disconnects, and manual debug probes all emit redacted structured events with request IDs and normalized failure codes when available.

### Assistant and voice services

Current assistant-related services live in:

- `src/assistant/`
- `src/services/assistantRuntime.ts`
- `src/services/hostedAssistantApi.ts`
- `src/services/ollamaApi.ts`
- `src/services/deepgramSTT.ts`
- `src/components/VoiceAssistant.tsx`
- `src/store/contexts/ChatContext.tsx`
- `supabase/functions/assistant-openai/`

Both chat and voice now route through the shared grounded assistant runtime under `src/assistant/`. Fresh assistant intents are handled by a live model first, and local code is limited to transcript normalization, correction memory, capability/entity retrieval, validator guardrails, confirmation handling, deterministic execution, and debug tracing.

Planning providers:

- hosted GPT-5.4 through the `assistant-openai` Supabase Edge Function for web builds
- local Ollama for desktop setups when a live Ollama model is available

The runtime stays provider-agnostic at the execution layer so voice and chat do not drift apart behaviorally. That shared runtime owns task-title normalization, recent-task reveal handling such as "show me that task", grounded ID validation for mutations, and the typed navigation handoff used by the Tasks and Projects surfaces to jump to the right view and reveal the resolved entity.
The assistant action registry in `src/assistant/capabilities.ts` is the source of truth for which actions Lina may claim and execute. The model now decides whether a turn is `reply`, `clarify`, `confirm`, or `tool_calls`, Sabah One validates and executes locally, and the final visible assistant reply is narrated from verified results rather than coming from executor templates.
The Debug surface renders the registry directly and also shows the latest planning bundle, raw planner response, model turn, validator verdict, validated plan, pending confirmation state, execution payloads, raw narration response, final assistant message, and the latest dashboard-focus trace so model-backed task recommendations can be inspected when GPT picks or falls back.
The assistant benchmark corpus and scorer now live under `src/assistant/evals/` plus `scripts/run-assistant-benchmark.ts`, and the hosted benchmark thresholds are enforced on `master` before deployment.

### Other external services

The app also integrates with:

- AlAdhan for validated Jafari prayer times, final-deadline inputs, and timezone metadata. `PrayerProvider` is the sole schedule owner, refreshes on date/location/resume/retry, and refuses stale or timezone-mismatched reminder scheduling.
- Monzo for finance import
- ElevenLabs for voice output
- Deepgram for speech-to-text
- OpenWakeWord for local wake-word detection

Resilience utilities already exist in `src/services/circuitBreaker.ts`, `src/services/retry.ts`, `src/services/serviceBreakers.ts`, and `src/services/logger.ts`.

## Surface Notes

- Dashboard is the Night Compass daily operating view: Prayer is the structural first tier, Learn and Move are mandatory daily pillars, and one compact due-task route is second-order. It consumes canonical PrayerContext outcomes and the committed daily-momentum API; it does not rank Prayer as a task or restore the former generic `Up Next`, agenda, habit, goal, achievement, milestone, system-health, or duplicate task panels. The dashboard-focus domain remains available to Debug for diagnostics and model trace inspection, but it no longer owns the primary Dashboard hierarchy. Separate Jafari final deadlines continue to drive canonical On-time/Late outcomes and warnings, while Profile preserves longer prayer history.
- Chat is persistent and conversation-based.
- Calendar is the most integration-heavy surface and depends on account/source/event integrity.
- Tasks and gamification are tightly linked through XP, streaks, and badge logic. The Tasks surface now intentionally splits into a motivating `Today` view and a calmer `All Tasks` workspace that groups overdue, due-today, upcoming, Islamic prayer tasks, routine habits, and completed work for easier scanning, with collapsible section headers for long lists. Legacy prayer habits are normalized into first-class prayer tasks on load. Canonical prayer outcome records are keyed by local prayer date and prayer name rather than task ID, so task deletion or recreation does not erase history. Old checked prayer entries migrate idempotently as `unclassified`; Sabah One never invents legacy on-time status or missed days.
- Prayer tracking and reminders are specified in `docs/prayer-tracking-and-reminders.md`. `PrayerProvider` owns schedule freshness, canonical outcomes, the shared completion selector, stats, reminders, and Prayer Debug diagnostics. UI, chat, and voice all use the same completion mutation; Lina asks `On time or late?` when status is omitted, and undo restores task, XP, and prayer tracking together.
- Projects is a reference-first account catalogue. Searchable cards and an accessible drawer/sheet expose live links, repositories, documentation, setup references, and portable run recipes; Board, Milestones, and Wiki remain available through Manage project. Shared records are keyed by stable `catalogKey`. Device roots, approvals, process state, and logs use separate device-only persistence and never enter Supabase or assistant context. Web Sabah One is copy/reference-only; the desktop runner accepts only native-approved structured profiles.
- Inventory is a global account-backed catalogue with Owned and Needed views. Item and need payloads are bounded in TypeScript and PostgreSQL; acquisition is a single database mutation that increments or creates owned stock while closing the need. Projects expose a catalogue-key-filtered Inventory tab without creating project-local copies.
- The former Inbox and quick-capture path has no surface, provider, assistant capability, shortcut, or writable collection. Its historical rows are tombstoned in place for recovery and cannot be restored through active app interfaces.
- Secrets is an account-owned encrypted credential catalogue. It supports search and project/type/environment filters, immediate Reveal/Hide/Copy, metadata editing, and reversible Archive/Restore without a second master-password prompt. It intentionally has no bulk export, sharing, autofill, permanent delete, offline view, or assistant access.
- Clock persists multiple active timer and stopwatch records plus per-timer alarm preferences in the signed-in account database.
- Health persists reflection entries in the signed-in account database while keeping the quick-entry and recent-history workflow in one view.
- Knowledge contains both a topic-entry knowledge base and the lifestyle tracker.
- Integrations is the operational hub for Google Calendar and placeholder external providers.

### Cross-project Inventory access

`supabase/functions/sabah-one-inventory-mcp/` exposes exactly seven Inventory tools through a remote MCP endpoint. Supabase OAuth 2.1 with PKCE supplies user tokens; the function validates the token, forwards it through the normal authenticated client, and never uses a service-role credential. RLS and dedicated RPCs permit approved OAuth clients to access only `inventoryItems`, `inventoryNeeds`, and minimal project name/catalogue-key resolution. Generic snapshots, Secrets, finance, calendars, chats, settings, and broad mutation RPCs reject OAuth-client sessions.

The personal plugin at `/Users/xaoilin/plugins/sabah-one-inventory` supplies the complementary planning workflow: relevant project chats check live stock before shopping recommendations, reads happen automatically, and writes require an explicit request. Bulk writes require review, while archive and ambiguous changes require confirmation.

## Testing And Operational Reality

The repo includes:

- unit tests with Vitest
- browser E2E coverage with Playwright
- desktop and web behavior that still requires manual checks for OAuth, microphone access, wake word, native notification permission, minimized prayer reminders, and some live integrations


## Current Architecture Risks

- Entity retrieval and benchmark example retrieval are still heuristic, so improvements should be measured before changing prompts or capability metadata.
- Some integrations are real and some are still mock or placeholder paths, so docs must distinguish between them carefully.
- Large surface components still exist, even though state has already been split into domain providers.
- Shared records and secret metadata are account-isolated by RLS and constrained RPCs. Secret plaintext is encrypted through Supabase Vault and is intentionally excluded from general shared-record, logging, export, Broadcast, and assistant paths.
