# Project Architecture

## Overview

Sabah One is a hosted web product for a solo operator. GitHub Pages serves the web bundle and the browser is the only supported product runtime. Account data belongs to the Spring services (`sabah-one-services`); writes require an online server confirmation. Generic app time uses one optional account-shared IANA preference with `Automatic` browser fallback; prayer schedules keep their own authoritative zone.

The current stack is:

- React 19 with TypeScript 5 and Vite 8 for the web UI
- GitHub Pages for the deployed website
- Spring Boot services for every account domain, with a live-update stream (server-sent events)
- Supabase Auth, Vault secrets, agent OAuth approvals, and the MCP Edge Functions
- Google Calendar and AlAdhan integrations
- Web Notifications where supported

## Runtime Map

### Hosted web shell

The React shell renders navigation, the active surface, and Supabase sign-in controls. The Lina assistant, Chat, voice and Life Hero were removed on 2026-09-26; a stored `chat` surface from an earlier release opens the Dashboard. The supported surfaces are Dashboard, Calendar, Clock, Trips, Tasks, Employment, Projects, Inventory, Secrets, Finance, Health, Knowledge, Profile, Integrations, Activity, Settings, and Debug.

The separate [Jev voice prototype](jev-voice-prototype.md), requested on 2026-10-09,
is an opt-in shell panel. Deepgram supplies streaming transcripts and an
authenticated Edge Function asks Jev for bounded choices using account-owned
Vault keys. `useJevVoiceWorkflow` coordinates page/item selection and previewed
task operations through the existing planner service, awaiting server confirmation.

The visible version comes from the web build and the deployed `public/release.json` manifest. Open pages check the manifest with a five-second deadline and perform one browser reload when a newer deployed semver is available. Reload waits until the page is visible and mounted, with no open modal or visible editable text; a deferred check does not consume the reload marker. The active surface is kept in browser session state so a legitimate reload can return the user to the same section.

### State composition

`src/store/AppProviders.tsx` composes the existing domain providers without exposing an app-wide service bag. Components import the smallest owning domain hook they need: Calendar consumers use `useCalendar`, Task consumers use `useTaskContext`, Settings consumers use `useSettingsContext`, and so on. Updating one domain no longer republishes an object containing every other domain capability.

Provider order remains explicit because several providers consume earlier owners. Settings and Gamification wrap Daily Momentum; Calendar precedes Trips; Projects precedes Tasks; Prayer and Clock follow the data domains, with the named `DailyTaskRollover` workflow mounted once between them so habit resets and streak-break resets run whichever page is open; the milestone celebration coordinator wraps rendered consumers. `src/test/composition.boundaries.test.ts` checks the order and ownership markers.

`src/store/ShellContext.tsx` owns only the active surface, one-shot navigation requests (the Dashboard uses one to open the All Tasks view with filters reset), session restoration, and the readiness gate. Because rendered consumers mount after readiness, they do not need a cross-domain `loaded` capability.

Cross-domain behavior is retained only where one domain cannot own the invariant:

- `useProjectRemovalWorkflow` removes a Project and clears its Task references as one named workflow.
- `useDailyTaskRollover` tells the planner service the user's app and prayer time zones on load and at each new day; the service reopens completed habits once per app day (prayer habits once per prayer-timetable day), zeroes a missed streak and rewards recorded prayers, and the app shows its answer.

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

Tasks, habits, goals, XP, streaks, badges, daily momentum and the clock are owned by the Spring planner service (`src/services/backend/plannerServiceApi.ts`); their `tasks`, `gamification`, `clock` and `dashboardFocusFeedback` account collections are decode-only legacy keys. Change events from every service reach open tabs through the live-update gateway (`src/services/backend/liveEvents.ts`, `useLiveRefresh`).

Settings shared across devices and integration records are owned by the Spring profile service (`src/services/backend/profileServiceApi.ts`, synced by `useAppPreferencesSync`, `useProfileSettingsSync` and `SettingsContext`); prayer preferences by the prayer service. The old `settings` and `integrations` account collections are decode-only legacy keys, and device-only settings stay in the browser's device store. Operational telemetry is posted to the profile service's `/api/profile/v1/operational-events`.

## Persistence And Sync

### Service-owned account data

Every account domain loads and saves through its Spring service (`src/services/backend/*`): the providers load on mount with `useServiceLoad` (or their own service sync), keep confirmed data in memory for the signed-in session, write one record per change with an Idempotency-Key, and reload a domain when the live-update stream (`liveEvents.ts`, `useLiveRefresh`) reports a change from another tab or device. There is no persistent account-data browser cache and no offline mutation queue; while the browser is offline, pages are read-only under an Offline banner (`useOnlineStatus`, `SyncAvailabilityContext`).

`src/AppRoot.tsx` gates the app on the Supabase session only: loading, missing configuration, an unreachable sign-in service (Retry without signing out) and sign-in. Signed in, it mounts `AppProviders` keyed by the session, so an account change clears the previous account's data before the next account's providers load. `PageReadinessGate` holds each page until the providers it needs have answered (see `page-loading.md`). Device-only settings stay in browser local storage (`src/store/deviceSettings.ts`).

The generic Supabase record store (`helm_records` snapshots, change metadata, the mutation RPCs and private Realtime Broadcast) was retired in v0.2.206. `public.helm_records` remains only as the source the services imported once; nothing in the app reads or writes it.

### Supabase

Supabase gateways live under `src/store/supabase/`, one module per responsibility: `client.ts` owns the single client and signed-in session state; `auth.ts` covers sign-in, sign-out, session bootstrap, token renewal and auth events; `secrets.ts` account-owned Vault secret operations; `oauthClients.ts` one typed gateway for the per-domain OAuth client allowlists (Inventory, Employment, Equity and Finance), driven by a small table of RPC names; and `oauthAuthorization.ts` the consent page's OAuth server calls. `src/store/supabase.ts` is a compatibility barrel for the session and auth functions existing store and service code imports; new code imports the specific module. An ESLint rule forbids `src/surfaces` and `src/components` from importing that barrel. The consent approval transaction (domain allowlist, then authorization, with a compensating revoke that is reported if it fails) is the plain `src/services/oauthConsent.ts` function, and Settings lists and revokes every domain's clients through `useOAuthClientApprovals`.

### Secrets vault

The Secrets surface stores searchable account-owned metadata and only a UUID reference to an encrypted `vault.secrets` row. Security-definer RPCs derive ownership from `auth.uid()`; callers cannot supply a user ID or access Vault directly.

The list operation never decrypts values. Reveal fetches one active secret at a time, and the browser clears decrypted state on Hide, surface unmount, page backgrounding, sign-out, account switch, and refresh. The page reloads the summaries after its own writes and whenever it is focused or shown again. Bulk export, sharing, autofill, permanent deletion, and assistant access are intentionally absent.

## Integrations And External Services

### Google auth and Calendar

Sabah One sign-in uses Supabase Auth. The Supabase access token is the only credential the browser sends to Sabah One services (`src/services/backend/serviceClient.ts`); it is renewed before expiry and after a `401`, and no service or database response signs the user out on its own (see the session rules in `engineering-guide.md`).

Inventory, trips, the job tracker and the fast-food journal are owned by the Spring Boot life admin service (`src/services/backend/lifeServiceApi.ts`, schemas in `lifeContracts.ts`, contracts in `contracts/life-service`). `InventoryContext`, `TripContext`, `HealthContext` and `EmploymentContext` load from it and write one record per change with an Idempotency-Key; there is no diff sync, so nothing can be deleted in bulk. Trip dates, route order and budget totals are worked out by the service, and every trip write returns the whole trip. The old collections (`trips`, `tripLegs`, `tripItineraryItems`, `tripBookings`, `tripBudgetEntries`, `inventoryItems`, `inventoryNeeds`, `employment`, `healthFastFoodEntries`) are decode-only legacy keys. The Inventory and Employment MCP functions forward the agent's OAuth token to the same service.

The knowledge base, lifestyle tracker, projects and wiki pages are owned by the Spring Boot knowledge service (`src/services/backend/knowledgeServiceApi.ts`, schemas in `knowledgeContracts.ts`, contracts in `contracts/knowledge-service`). `KnowledgeContext` and `ProjectContext` load from it and write one record per change with an Idempotency-Key; lifestyle moves and reorders and project pin, archive and reorder are worked out by the service from what it stores (a stale reorder is refused), and project writes return the whole catalogue. The old collections (`knowledgeTopics`, `knowledgeEntries`, `lifestyleItems`, `projects`, `projectPages`, `workspaces`) are decode-only legacy keys. The Inventory MCP's `inventory_resolve_project` forwards the agent's OAuth token to the knowledge service.

Calendar is owned by the Spring Boot calendar service (`src/services/backend/calendarServiceApi.ts`, contracts in `contracts/calendar-service`). `CalendarContext` loads accounts, calendars and events for a window around today and publishes a change only after the service confirms it. Google accounts connect through Google's consent popup: the browser passes the one-time code to the service, which exchanges it with Google and keeps the refresh token encrypted in its own database. The browser never holds a Google token, and connecting Google never replaces the Sabah One session.

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

The `sabah-one-inventory-mcp` Edge Function exposes exactly seven narrow Inventory tools through a remote MCP endpoint. Supabase OAuth 2.1 with PKCE supplies user tokens; the function validates the token, asks the life admin service whether the agent is approved (a one-result Inventory search; a refusal becomes the OAuth 403 challenge, an unavailable service 503), and forwards the agent's token to the life service for every tool, which rechecks the Inventory approval. Project resolution asks the knowledge service. Secrets and the approval RPCs reject OAuth-client sessions.

The separate `sabah-one-employment-mcp` Edge Function exposes six application and history tools. Its own account/client approval table gates all reads and mutations; the consent screen explicitly selects the domain and Settings revokes Employment independently. The function checks the approval with a one-application read of the life service's job list, then forwards the agent's token to the life service, which applies each semantic change with its Idempotency-Key. The browser writes through the same service. Scheduled Codex agents own source reading and reconciliation; Gmail ingestion and scheduling are outside the hosted product.

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
- Account data is account-isolated by the services, and secret metadata by RLS and constrained RPCs. Secret plaintext stays within the Vault reveal path and is excluded from records, logs, and exports.
