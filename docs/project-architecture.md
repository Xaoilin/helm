# Project Architecture

## Overview

Sabah One is a hosted web product for a solo operator. GitHub Pages serves the web bundle and the browser is the only supported product runtime. Shared state is database-authoritative through Supabase; writes require an online server confirmation. Generic app time uses one optional account-shared IANA preference with `Automatic` browser fallback; prayer schedules keep their own authoritative zone.

The current stack is:

- React 19 with TypeScript 5 and Vite 8 for the web UI
- GitHub Pages for the deployed website
- Supabase Auth, account records, private Realtime Broadcast, and Edge Functions
- Google Calendar and AlAdhan integrations
- Web Notifications where supported

## Runtime Map

### Hosted web shell

The React shell renders navigation, the active surface, and Supabase sign-in controls. The Lina assistant, Chat, voice and Life Hero were removed on 2026-09-26; a stored `chat` surface from an earlier release opens the Dashboard. The supported surfaces are Dashboard, Calendar, Clock, Trips, Tasks, Employment, Projects, Inventory, Secrets, Finance, Health, Knowledge, Profile, Integrations, Activity, Settings, and Debug.

The visible version comes from the web build and the deployed `public/release.json` manifest. Open pages check the manifest with a five-second deadline and perform one browser reload when a newer deployed semver is available. Reload waits until the page is visible and mounted, with no queued writes, open modal, or visible editable text; a deferred check does not consume the reload marker. The active surface is kept in browser session state so a legitimate reload can return the user to the same section.

### State composition

`src/store/AppProviders.tsx` composes the existing domain providers without exposing an app-wide service bag. Components import the smallest owning domain hook they need: Calendar consumers use `useCalendar`, Task consumers use `useTaskContext`, Settings consumers use `useSettingsContext`, and so on. Updating one domain no longer republishes an object containing every other domain capability.

Provider order remains explicit because several providers consume earlier owners. Settings and Gamification wrap Daily Momentum; Calendar precedes Trips; Projects precedes Tasks; Prayer and Clock follow the data domains, with the named `DailyTaskRollover` workflow mounted once between them so habit resets and streak-break resets run whichever page is open; the milestone celebration coordinator wraps rendered consumers. `src/test/composition.boundaries.test.ts` checks the order and ownership markers.

`src/store/ShellContext.tsx` owns only the active surface, one-shot navigation requests (the Dashboard uses one to open the All Tasks view with filters reset), session restoration, and the readiness gate. Because rendered consumers mount after readiness, they do not need a cross-domain `loaded` capability.

Cross-domain behavior is retained only where one domain cannot own the invariant:

- `useProjectRemovalWorkflow` removes a Project and clears its Task references as one named workflow.
- `useDailyTaskRollover` reopens completed habits once per app day (prayer tasks once per prayer-timetable day) and zeroes a missed streak, using the rules in `src/services/taskModel.ts`.

The selected design reuses existing domain contexts. A dependency-injection container, Redux migration, generic service locator, and replacement all-app context were rejected because they would add another global contract without hiding new knowledge. `scripts/verify-capability-composition.mjs` rejects the retired façade identifiers, generic service-locator names, and non-workflow contracts spanning four or more recognized domains. Revisit this decision only when a concrete workflow cannot preserve its invariant within one owner or one explicitly named coordinator.

Browser session state is limited to transient UI state, permission state, and bounded diagnostics. It is not a source of truth for shared records.

Night Compass reads its owning domains directly. The retired Dashboard Focus provider, ranking, timers, and Debug trace have no runtime replacement. Browser startup removes only `helm:dashboardFocusCache:v1` and `helm:dashboardFocusHostedReview:v1`, even before sign-in; unavailable storage logs a content-free warning and does not block startup. Historical `dashboardFocusFeedback` types, collection compatibility, and migrations remain. See the [audit and retirement decision](audits/2026-09-07.md).

### Domain model

`src/types/domain.ts` owns the app's source-of-truth types, including:

- surfaces and typed navigation targets
- calendar accounts, sources, and events
- tasks, goals, daily habits, prayer tasks, and project workflow metadata
- projects, project wiki pages, Inventory items, acquisition needs, and Employment applications with contact/evidence history
- encrypted secret metadata and one-at-a-time revealed secret details
- Clock timers and stopwatches, knowledge entries, health logs, finance records, trips, integrations, and settings

Settings shared across devices and integration records are owned by the Spring profile service (`src/services/backend/profileServiceApi.ts`, synced by `useAppPreferencesSync`, `useProfileSettingsSync` and `SettingsContext`); prayer preferences by the prayer service. The old `settings` and `integrations` account collections are decode-only legacy keys, and device-only settings stay in the browser's device store. Operational telemetry is posted to the profile service's `/api/profile/v1/operational-events`.

## Persistence And Sync

### Database-authoritative shared state

Authenticated Supabase reads bootstrap the shared provider tree. Sign-out, invalid account authorization, account changes and incompatible schemas clear or block private data. Transient network failures retain the same account's last confirmed in-memory snapshot with a read-only freshness notice. There is no persistent account-data browser cache or offline mutation queue.

Shared arrays are account-owned records with explicit positions. Semantic create, patch, increment, delete, restore, and reorder operations go through the transactional mutation RPC. Tombstones prevent stale resurrection, commit order resolves unavoidable same-field concurrency, and private per-account Broadcast messages carry identifiers and versions rather than secret values. Version gaps and reconnects trigger an authoritative refresh. Realtime is an optional invalidation channel: its failure never blocks healthy HTTPS reads or confirmed writes. Channel retries back off independently from database recovery, capped at 30 seconds; visible online pages probe the account version every ten minutes and reconcile immediately on Broadcast and foreground/online recovery. Concurrent refresh triggers coalesce; an unchanged account version reuses confirmed in-memory data without fetching a full snapshot. The periodic safety check is suppressed while hidden, offline, signed out, or without a usable account snapshot.

Account changes clear the previous in-memory state before the next account can render. Calendar data keeps the account -> source -> event hierarchy, including intentional multi-account support.

The persistence runtime has one stable consumer API at `src/store/persistence.ts`. Its implementation is divided by state ownership instead of keeping cache, queue, realtime, device, and diagnostic globals in one module:

- `persistence/runtime.ts` orchestrates authenticated session bootstrap, hydration, account switching, legacy cutover, and consumer publication through one explicit `PersistenceRuntimeState` owner.
- `persistence/cache.ts` owns authoritative records and the provider-delivered diff baseline. The separate baseline prevents a concurrent remote addition from being interpreted as a local deletion.
- `persistence/writes.ts` owns coalesced writes, one-at-a-time committed operations, queue diagnostics, and account-epoch invalidation. Transient mutation retry remains limited to one repeat with the same request ID and operation list.
- `persistence/realtime.ts` owns the private Broadcast channel, lifecycle refresh triggers, readiness timeout, and bounded recovery. Broadcast remains an invalidation signal; records are refreshed from the database before they are published.
- `persistence/deviceStore.ts` owns the device-only settings key and one-way legacy shared-data quarantine. It cannot be used as a shared-data fallback.
- `persistence/health.ts` owns immutable health publication and clears account-scoped read/write diagnostics when the account runtime resets.

Each stateful boundary has an explicit reset path. Add a new boundary only when it owns distinct mutable state or policy; ordinary persistence behavior should extend the existing consumer-shaped boundary. Do not introduce a generic repository, event bus, dependency-injection container, or storage abstraction without a concrete consumer and measured benefit.

### Supabase

Supabase gateways live under `src/store/supabase/`, one module per responsibility: `client.ts` owns the single client and signed-in session state; `auth.ts` covers sign-in, sign-out, session bootstrap and auth events; `records.ts` account-isolated snapshots, changed collections, version probes and pages; `mutations.ts` semantic mutation calls; `secrets.ts` account-owned Vault secret operations; `productUsage.ts` product analytics; `realtime.ts` private Broadcast subscriptions; `oauthClients.ts` one typed gateway for the per-domain OAuth client allowlists (Inventory, Employment, Equity and Finance), driven by a small table of RPC names; and `oauthAuthorization.ts` the consent page's OAuth server calls. `src/store/supabase.ts` is a compatibility barrel for existing store, service and test imports; new code imports the specific module. An ESLint rule forbids `src/surfaces` and `src/components` from importing that barrel or `store/persistence/*` internals (deprecated feature files are listed as explicit exceptions). The consent approval transaction (domain allowlist, then authorization, with a compensating revoke that is reported if it fails) is the plain `src/services/oauthConsent.ts` function, and Settings lists and revokes every domain's clients through `useOAuthClientApprovals`. `src/AppRoot.tsx` requires a usable snapshot for the current authenticated account and keeps its providers mounted during transient failure. Finance, Equity and Employment retain successful reads and drafts while surfacing freshness or operation errors. Employment owns its server-dependent initial seed state; it does not gate unrelated shell navigation. Failed domain writes are surfaced and reconciled without revoking a healthy account session. Existing domain MCP interfaces remain unchanged.

### Secrets vault

The Secrets surface stores searchable account-owned metadata and only a UUID reference to an encrypted `vault.secrets` row. Security-definer RPCs derive ownership from `auth.uid()`; callers cannot supply a user ID or access Vault directly.

The list operation never decrypts values. Reveal fetches one active secret at a time, and the browser clears decrypted state on Hide, surface unmount, page backgrounding, sign-out, account switch, and refresh. Broadcast messages contain only request IDs, secret IDs, revisions, archive markers, and account versions. Bulk export, sharing, autofill, permanent deletion, and assistant access are intentionally absent.

## Integrations And External Services

### Google auth and Calendar

Sabah One sign-in uses Supabase Auth. The Supabase access token is the only credential the browser sends to Sabah One services (`src/services/backend/serviceClient.ts`); it is renewed before expiry and after a `401`, and no service or database response signs the user out on its own (see the session rules in `engineering-guide.md`).

Calendar is owned by the Spring Boot calendar service (`src/services/backend/calendarServiceApi.ts`, contracts in `contracts/calendar-service`). `CalendarContext` loads accounts, calendars and events for a window around today and publishes a change only after the service confirms it. Google accounts connect through Google's consent popup: the browser passes the one-time code to the service, which exchanges it through the hosted `google-calendar-oauth` function that keeps refresh credentials. The browser never holds a Google token, and connecting Google never replaces the Sabah One session.

The service mirrors Google (when Calendar loads stale, every 15 minutes while open, and on **Sync**) and writes event changes to Google first; a refused Google change leaves Calendar unchanged. A Google credential problem is `409 google_reconnect_required` or a `needs_reconnect` account state; reconnect is an explicit user action. Calendar groups, displays, and edits timed events in the effective app zone and sends that zone with Google writes.

New device settings writes use `helm:device:deviceSettings:v2` and exclude provider values; the original device and legacy settings sources are left unchanged. Settings of the removed assistant, voice and Life Hero features in stored records are ignored.

### Other external services

The app also integrates with:

- AlAdhan for validated Jafari prayer times, deadlines, and timezone metadata
- the authenticated `sabah-one-inventory-mcp` Supabase Edge Function for the narrow Inventory planning boundary

Network failures use visible error states and the established retry, circuit-breaker, and logging utilities. Diagnostics redact tokens and preserve request IDs and normalized failure codes where available.

## Surface Notes

- Dashboard is the Night Compass daily operating view. Prayer is the structural first tier, a deterministic Quran motivation card follows it, Learn and Move are the mandatory daily pillars, and one compact due-task route is second-order. Source-reviewed Arabic, references, paraphrase labels, and Quran.com links are preserved; runtime model output does not write religious content.
- Prayer tracking and reminders are specified in `docs/prayer-tracking-and-reminders.md`. `PrayerProvider` orchestrates schedule freshness and side effects while pure schedule, reminder, and completion policies own the domain transitions. All UI entry points use the same completion mutation.
- The Spring Prayer service migration starts with Dashboard probes to optional `GET /api/prayer/health` and `GET /api/prayer/health/database` endpoints. The database probe runs `SELECT 1` from Spring Boot using server-only Supabase PostgreSQL credentials; no user data or credentials are sent by the browser. It does not replace `PrayerProvider`, AlAdhan, or Supabase, and does not move prayer rules or data.
- The Dashboard checks the calendar service's `GET /api/calendar/health` and `GET /api/calendar/health/database`; these probes send no user data or credentials.
- Generic time-zone resolution and its strict separation from prayer schedule authority are specified in `docs/app-time-zone.md`.
- Activity shows private, content-free usage insight.
- Calendar depends on account/source/event integrity and keeps provider cache changes account-bound.
- Tasks and gamification share canonical task, prayer outcome, XP, and streak boundaries. Prayer outcomes are keyed by local prayer date and prayer name rather than task ID.
- Projects is a reference-first account catalogue. Searchable cards expose links, repositories, documentation, display-only prerequisites, and portable guidance; Board, Milestones, and Wiki remain available through Manage project. No private credentials or machine-specific paths are part of the shared catalogue.
- Inventory is a global account-backed Owned and Needed catalogue. Project views filter the same records by stable catalogue key rather than making project copies.
- Employment is an account-backed singleton tracker containing the pipeline, remote evidence, compensation, next actions, notes, and contact/evidence history. Prayer, Learn, and Move remain the structurally dominant Dashboard pillars; Employment is a separate navigation surface.
- Secrets is an account-owned encrypted credential catalogue with search, filters, immediate Reveal/Hide/Copy, metadata editing, and reversible Archive/Restore.
- Clock persists multiple account-backed timer and stopwatch records. Health, Knowledge, Finance, and Trips likewise use the signed-in account database.
- Integrations is the operational hub for connected Google Calendar and other supported or placeholder providers.

### Cross-project Inventory access

The `sabah-one-inventory-mcp` Edge Function exposes exactly seven narrow Inventory tools through a remote MCP endpoint. Supabase OAuth 2.1 with PKCE supplies user tokens; the function validates the token and uses the normal authenticated client. RLS and dedicated RPCs limit access to `inventoryItems`, `inventoryNeeds`, and minimal project name/catalogue-key resolution. Generic snapshots, Secrets, finance, calendars, chats, settings, and broad mutation RPCs reject OAuth-client sessions.

The separate `sabah-one-employment-mcp` Edge Function exposes six application and history tools. Its own account/client approval table gates all reads and mutations; the consent screen explicitly selects the domain and Settings revokes Employment independently. Dedicated RPCs mutate the existing Employment singleton under the account lock, with payload-bound idempotency receipts and server-generated revisions. The browser uses these semantic mutations too, preserving concurrent jobs and history. Scheduled Codex agents own source reading and reconciliation; Gmail ingestion and scheduling are outside the hosted product.

The private planning integration checks live Inventory records before recommendations, requires explicit approval for writes, and keeps bulk or ambiguous changes behind review.

### AI agent access

External AI agents use published domain MCP tools, never direct account storage or UI automation. Each domain endpoint owns explicit OAuth consent, least-privilege RPCs, semantic operations, confirmation policy, and receipt-backed claims. A missing MCP capability is an unavailable state rather than permission to reuse another domain's approval.

The Inventory MCP is currently the only published external agent boundary. Employment account mutations remain blocked for external agents until a dedicated approval and RPC boundary is delivered. The acceptance contract and current matrix are maintained in [`agent-access.md`](agent-access.md).

## Testing And Operational Reality

GitHub Actions is the validation authority for the hosted product. The repository uses static policy checks, TypeScript and unit checks, browser E2E coverage with Playwright, the web build, and hosted deployment verification.

Browser review remains necessary for OAuth, browser notification permission, page-open prayer reminders, responsive layout, and live integrations. A green automated check proves only the paths it exercises; it does not prove a user-visible notification after the page is closed or every external provider state.

## Current Architecture Risks

- Some integrations are real and some remain placeholder or simulated; [feature status](feature-status.md) is the source of truth.
- Browser notification delivery depends on permission and an open page, so the in-app reminder banner remains an explicit fallback.
- Shared records and secret metadata are account-isolated by RLS and constrained RPCs. Secret plaintext stays within the Vault reveal path and is excluded from records, logs, exports, and Broadcast.
