# Project Architecture

## Overview

HELM is a local-first desktop assistant for a solo operator. The in-app assistant is Lina. The product combines calendar, tasks and habits, a multi-clock timer and stopwatch workspace, project management, finance tracking, personal health journaling, Islamic knowledge and lifestyle tracking, prayer times, integrations, and chat and voice AI in one desktop app.

The current stack is:

- Tauri 2 for desktop packaging and local file access
- React 19 with TypeScript 5 and Vite 8 for the UI
- Supabase for optional sign-in and cloud sync
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
- Tasks
- Projects
- Finance
- Health
- Knowledge
- Profile
- Integrations
- Settings
- Debug

### State composition

`src/store/AppContext.tsx` is no longer the old monolithic store. It is now a compatibility facade that composes domain providers and exposes a single app-shaped API to the rest of the UI.

Provider stack:

1. `SettingsProvider`
2. `GamificationProvider`
3. `CalendarProvider`
4. `ProjectProvider`
5. `TaskProvider`
6. `KnowledgeProvider`
7. `HealthProvider`
8. `FinanceProvider`
9. `ClockProvider`
10. `AssistantProvider`
11. `ChatProvider` through `ChatBridge`
12. `ShellProvider`

State is split across:

- `src/store/contexts/CalendarContext.tsx`
- `src/store/contexts/ProjectContext.tsx`
- `src/store/contexts/TaskContext.tsx`
- `src/store/contexts/ChatContext.tsx`
- `src/store/contexts/KnowledgeContext.tsx`
- `src/store/contexts/HealthContext.tsx`
- `src/store/contexts/FinanceContext.tsx`
- `src/store/contexts/ClockContext.tsx`
- `src/store/contexts/GamificationContext.tsx`
- `src/store/contexts/SettingsContext.tsx`
- `src/store/contexts/AssistantContext.tsx`

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
- multi-timer and multi-stopwatch Clock state, including per-timer alarm sound selection
- knowledge topics, entries, and lifestyle items
- fast-food health log entries
- finance accounts, transactions, budgets, and savings goals
- integrations and settings

## Persistence And Sync

### Local-first storage

`src/store/persistence.ts` implements the storage priority rules:

- Signed in: Supabase is the only source of truth for shared app data. Local Tauri files and `localStorage` are ignored unless the user explicitly imports an old local copy.
- Signed out: Tauri file storage is preferred, with `localStorage` as the web fallback.

Signed-in writes queue debounced Supabase `kv_store` updates and do not write local persistent storage. Signed-out writes still use the local-first Tauri/`localStorage` path. Settings scans old local copies by grouped app domain, normalizes away system/cache metadata drift such as integration setup timestamps, sync/auth timestamps, transient errors, pending sync flags, dashboard cache, and assistant audit noise, then silently clears identical copies. Local-only user data imports when the matching database group is empty, and the review modal opens only for meaningful user data or user-preference conflicts, plus unreadable local JSON. Calendar provider data is an exception: Google-backed account, source, and event JSON is treated as external cache, so stale device copies are cleared and a Google refresh is requested instead of asking the user to choose database versus device. The modal defaults to keeping Supabase, shows field-level database/device summaries with expandable redacted git-style JSON diffs, and can commit the device copy to Supabase when the user explicitly chooses that side. Settings values, including API-key-like values, are synced as plain Supabase JSON under RLS and are not encrypted vault storage.
Authenticated provider startup uses an initial-save guard so domain defaults do not create empty Supabase rows after a database miss. For existing database rows, that guard records the loaded JSON and only suppresses that exact value; a real first mutation, such as a Google Calendar refresh adding events to the cache, still queues a Supabase write.

### Desktop boundary

The Tauri side is intentionally thin. Rust commands handle app-data directory discovery, JSON store reads and writes, and a small number of desktop-only affordances such as project directory picking and opening a local project path. App behavior and business rules stay in the TypeScript layer.

### Supabase

`src/store/supabase.ts` provides:

- Google sign-in through Supabase Auth
- session bootstrap and auth-state subscription
- user-scoped key-value persistence through `kv_store`
- a debounced remote write queue
- best-effort realtime invalidation for open signed-in devices

Supabase sync is optional. The app still works in local-first mode without it.
`src/AppRoot.tsx` waits for Supabase session bootstrap before mounting domain providers, so returning signed-in users load database data instead of device-local data. Real identity transitions remount the provider tree. Background Supabase auth events like token refreshes update session state without restarting the UI.
Exit and background transitions trigger best-effort queue flushes so cloud sync is less likely to lag behind the most recent in-memory write.

## Integrations And External Services

### Google auth and Calendar account linking

Google identity now has two cooperating layers:

- Supabase Google sign-in for HELM account auth and cloud sync
- server-backed Google Calendar account auth managed through `src/services/googleCalendarAuthManager.ts`, `src/services/googleCalendarServerAuth.ts`, and `supabase/functions/google-calendar-oauth/`

The auth manager links the matching signed-in Google profile to the same-email Calendar account when possible, while still preserving multi-account Google Calendar support for additional accounts.

Important behavior:

- Google Calendar accounts persist explicit auth metadata in the domain model.
- Browser Google Calendar transport is now server-backed and refreshable. The browser only obtains Google authorization codes; refresh tokens stay on the hosted Supabase side in `google_calendar_credentials`.
- The hosted `google-calendar-oauth` function validates the Supabase session inside the function and is deployed with JWT verification disabled. This avoids Supabase Edge gateway rejects when the project issues asymmetric `ES256` access tokens.
- Production rollout for hosted Google Calendar auth requires the matching Supabase migration to be applied before or with the function deploy. The release workflow now prefers full `supabase db push` when `SUPABASE_DB_PASSWORD` is configured, and otherwise falls back to an idempotent Supabase Management API apply of the `google_calendar_credentials` schema before the function deploys.
- Durable browser Google Calendar support now requires HELM sign-in. Signed-out browser mode is a truthful degraded state for connect or reconnect, while local calendars continue to work normally.
- Passive sync is non-interactive. Opening Calendar or pressing `Sync` should never launch a consent or reconnect popup.
- Reconnect-required is a confirmed failure state, not a shortcut for "cached GIS token expired". Calendar-OAuth accounts only move into reconnect-required after passive auth actually fails, a 401 comes back, or the user no longer has transport credentials to retry with.
- Linked `profile-google` accounts stay tied to the HELM sign-in relationship, but the live Calendar transport is no longer the Supabase `provider_token`. Both linked and extra accounts use the same hosted refresh-token credential model.
- Existing browser-token-only accounts are treated as legacy migration state. They keep their cached calendar data, but HELM asks for a one-time reconnect to upgrade them onto the durable hosted credential path.
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
The Calendar surface's `Sync` button is a passive Google refresh: it mints or refreshes account-bound hosted access tokens, fetches each account's Google Calendar List, fetches events for the configured rolling window, updates HELM's provider cache, and never opens an OAuth prompt. The Calendar header counts visible cached events rather than all Google events returned by the API, so hidden calendars and out-of-window data are not implied to be on-screen.
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
- local Ollama for desktop or local-first setups when a live Ollama model is available

The runtime stays provider-agnostic at the execution layer so voice and chat do not drift apart behaviorally. That shared runtime owns task-title normalization, recent-task reveal handling such as "show me that task", grounded ID validation for mutations, and the typed navigation handoff used by the Tasks and Projects surfaces to jump to the right view and reveal the resolved entity.
The assistant action registry in `src/assistant/capabilities.ts` is the source of truth for which actions Lina may claim and execute. The model now decides whether a turn is `reply`, `clarify`, `confirm`, or `tool_calls`, HELM validates and executes locally, and the final visible assistant reply is narrated from verified results rather than coming from executor templates.
The Debug surface renders the registry directly and also shows the latest planning bundle, raw planner response, model turn, validator verdict, validated plan, pending confirmation state, execution payloads, raw narration response, final assistant message, and the latest dashboard-focus trace so model-backed task recommendations can be inspected when GPT picks or falls back.
The assistant benchmark corpus and scorer now live under `src/assistant/evals/` plus `scripts/run-assistant-benchmark.ts`, and the hosted benchmark thresholds are enforced on `master` before deployment.

### Other external services

The app also integrates with:

- AlAdhan for prayer times
- Monzo for finance import
- ElevenLabs for voice output
- Deepgram for speech-to-text
- OpenWakeWord for local wake-word detection

Resilience utilities already exist in `src/services/circuitBreaker.ts`, `src/services/retry.ts`, `src/services/serviceBreakers.ts`, and `src/services/logger.ts`.

## Surface Notes

- Dashboard is the daily operating view and combines agenda, prayer, habits, goals, achievements, and a compact task snapshot. The `Up Next` hero now comes from a dedicated dashboard-focus domain that ranks grounded task, habit, prayer, and near-meeting candidates locally, lets the hosted GPT model review that candidate pool once per local day when available, and falls back immediately to the local ranker when hosted AI is unavailable or invalid. Prayer tasks are driven by the live prayer schedule, so the snapshot only recommends the active prayer window and never mixes expired or later prayers into the queue. The dashboard UI now distinguishes `GPT-reviewed`, `GPT unavailable`, and `Ollama mode`, only shows duration chips when they come from grounded task or calendar data rather than heuristics, and keeps the prayer-rate card scoped to the current month while Profile preserves the longer month-by-month history.
- Chat is persistent and conversation-based.
- Calendar is the most integration-heavy surface and depends on account/source/event integrity.
- Tasks and gamification are tightly linked through XP, streaks, and badge logic. The Tasks surface now intentionally splits into a motivating `Today` view and a calmer `All Tasks` workspace that groups overdue, due-today, upcoming, Islamic prayer tasks, routine habits, and completed work for easier scanning, with collapsible section headers for long lists. Legacy prayer habits are normalized into first-class prayer tasks on load so prayer logs and streak data continue to work without manual migration.
- Projects is a local-first project-management hub built on the shared Tasks domain. Project boards read and write task workflow fields directly, milestones reuse project-linked goals, and wiki pages are lightweight notes stored alongside the rest of local app data.
- Clock is a local-first utility surface for timer and stopwatch workflows, and it persists multiple active cards plus per-timer alarm sound preferences through the shared store.
- Health is a local-first reflection surface for logging fast-food experiences, keeping a quick-entry form and recent reminder history in the same view so the pattern stays visible.
- Knowledge contains both a topic-entry knowledge base and the lifestyle tracker.
- Integrations is the operational hub for Google Calendar and placeholder external providers.

## Testing And Operational Reality

The repo includes:

- unit tests with Vitest
- browser E2E coverage with Playwright
- desktop and web behavior that still requires manual checks for OAuth, microphone access, wake word, and some live integrations

The Vite README is still the default template, so the docs in this folder and `AGENTS.md` should be treated as the actual project guide until the README is refreshed.

## Current Architecture Risks

- Entity retrieval and benchmark example retrieval are still heuristic, so improvements should be measured before changing prompts or capability metadata.
- Some integrations are real and some are still mock or placeholder paths, so docs must distinguish between them carefully.
- Large surface components still exist, even though state has already been split into domain providers.
- Security is MVP-grade for a single-user local-first app; this is not a general-purpose secret vault, and local project-path metadata should not be described as protected storage.
