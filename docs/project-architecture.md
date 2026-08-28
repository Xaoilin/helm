# Project Architecture

## Overview

Sabah One is a hosted web product for a solo operator, with Lina as its in-app assistant. GitHub Pages serves the web bundle and the browser is the only supported product runtime. Shared state is online-only and database-authoritative through Supabase.

The current stack is:

- React 19 with TypeScript 5 and Vite 8 for the web UI
- GitHub Pages for the deployed website
- Supabase Auth, account records, private Realtime Broadcast, and Edge Functions
- Hosted OpenAI through the `assistant-openai` Edge Function
- Google Calendar, AlAdhan, Monzo, Deepgram, and ElevenLabs integrations
- Browser speech APIs, Web Notifications, and browser WASM where supported

## Runtime Map

### Hosted web shell

The React shell renders navigation, the active surface, the global Lina panel, and Supabase sign-in controls. The supported surfaces are Dashboard, Chat, Calendar, Clock, Trips, Tasks, Projects, Inventory, Secrets, Finance, Health, Knowledge, Profile, Integrations, Activity, Settings, and Debug.

The visible version comes from the web build and the deployed `public/release.json` manifest. Open pages check the manifest and perform one browser reload when a newer deployed semver is available. The active surface is kept in browser session state so a legitimate reload can return the user to the same section.

### State composition

`src/store/AppContext.tsx` composes domain providers behind one app-shaped API. The provider stack includes Settings, Gamification, Calendar, Trips, Projects, Tasks, Knowledge, Inventory, Health, Finance, Prayer, Dashboard Focus, Clock, Assistant, Assistant Activity, Chat, and Shell.

The shell owns only cross-cutting UI state such as the active surface and one-shot assistant navigation requests. Chat and voice can hand the UI a typed request to open a Tasks view or reveal a grounded Project without creating a second navigation or mutation path.

Browser session state is limited to transient UI state, permission state, and bounded diagnostics. It is not a source of truth for shared records.

### Domain model

`src/types/domain.ts` owns the app's source-of-truth types, including:

- surfaces and typed navigation targets
- chat conversations, messages, assistant activity, and undo metadata
- calendar accounts, sources, and events
- tasks, goals, daily habits, prayer tasks, and project workflow metadata
- projects, project wiki pages, Inventory items, and acquisition needs
- encrypted secret metadata and one-at-a-time revealed secret details
- Clock timers and stopwatches, knowledge entries, health logs, finance records, trips, integrations, and settings

## Persistence And Sync

### Database-authoritative shared state

Authenticated Supabase reads bootstrap the shared provider tree. Signed-out, expired, or offline sessions cannot view or change shared records, and Sabah One keeps no durable offline mutation queue.

Shared arrays are account-owned records with explicit positions. Semantic create, patch, increment, delete, restore, and reorder operations go through the transactional mutation RPC. Tombstones prevent stale resurrection, commit order resolves unavoidable same-field concurrency, and private per-account Broadcast messages carry identifiers and versions rather than secret values. Version gaps and reconnects trigger an authoritative refresh.

Account changes clear the previous in-memory state before the next account can render. Calendar data keeps the account -> source -> event hierarchy, including intentional multi-account support.

### Supabase

`src/store/supabase.ts` provides Supabase Auth, session bootstrap, account-isolated reads, semantic mutation calls, private Broadcast subscriptions, version probes, and account-owned secret operations. `src/AppRoot.tsx` blocks the provider tree until the authenticated database session is ready.

### Secrets vault

The Secrets surface stores searchable account-owned metadata and only a UUID reference to an encrypted `vault.secrets` row. Security-definer RPCs derive ownership from `auth.uid()`; callers cannot supply a user ID or access Vault directly.

The list operation never decrypts values. Reveal fetches one active secret at a time, and the browser clears decrypted state on Hide, surface unmount, page backgrounding, sign-out, account switch, and refresh. Broadcast messages contain only request IDs, secret IDs, revisions, archive markers, and account versions. Bulk export, sharing, autofill, permanent deletion, and assistant access are intentionally absent.

## Integrations And External Services

### Google auth and Calendar

Sabah One sign-in uses Supabase Auth. Separately connected Google Calendar accounts use hosted authorization-code exchange and refreshable credentials held by Supabase. The browser receives short-lived access for the requested operation; refresh credentials never enter browser storage or shared client records.

Calendar sync is passive and account-bound. Opening Calendar or pressing `Sync` never opens an OAuth prompt. Reconnect is an explicit user action, and account-level states distinguish reconnect-required or revoked access from a generic service outage. Calendar writes go to Google first; a failed provider operation leaves the cached event unchanged rather than creating an offline pending mutation.

### Assistant and voice

Chat and voice use the shared grounded assistant runtime in `src/assistant/` and `src/services/assistantRuntime.ts`. Hosted GPT-5.4-family models provide planning and narration through `assistant-openai`; browser code supplies transcript normalization, capability and entity retrieval, validation, confirmation, deterministic execution, and debug tracing.

The model returns `reply`, `clarify`, `confirm`, or `tool_calls`. Sabah One validates grounded IDs and temporal references, confirms risky actions, executes one semantic mutation path, verifies the result, and asks the hosted model to narrate verified facts. If the hosted planner is unavailable, Lina explains the unavailable capability in-app and does not guess or mutate state.

Voice capabilities use Deepgram speech-to-text, ElevenLabs speech output, and browser speech fallbacks. Wake-word and speech features remain capability-dependent; Chat and the other surfaces remain available when a voice capability is unavailable.

### Other external services

The app also integrates with:

- AlAdhan for validated Jafari prayer times, deadlines, and timezone metadata
- Monzo for finance import when configured
- the authenticated `sabah-one-inventory-mcp` Supabase Edge Function for the narrow Inventory planning boundary

Network failures use visible error states and the established retry, circuit-breaker, and logging utilities. Diagnostics redact tokens and preserve request IDs and normalized failure codes where available.

## Surface Notes

- Dashboard is the Night Compass daily operating view. Prayer is the structural first tier, a deterministic Quran motivation card follows it, Learn and Move are the mandatory daily pillars, and one compact due-task route is second-order. Source-reviewed Arabic, references, paraphrase labels, and Quran.com links are preserved; runtime model output does not write religious content.
- Prayer tracking and reminders are specified in `docs/prayer-tracking-and-reminders.md`. `PrayerProvider` owns schedule freshness, canonical outcomes, the shared completion selector, stats, page-open reminder planning, and diagnostics. UI, chat, and voice use the same completion mutation.
- Chat is persistent and conversation-based. Activity records provide the account-backed audit trail for assistant mutations and supported undo operations.
- Calendar depends on account/source/event integrity and keeps provider cache changes account-bound.
- Tasks and gamification share canonical task, prayer outcome, XP, and streak boundaries. Prayer outcomes are keyed by local prayer date and prayer name rather than task ID.
- Projects is a reference-first account catalogue. Searchable cards expose links, repositories, documentation, display-only prerequisites, and portable guidance; Board, Milestones, and Wiki remain available through Manage project. No private credentials or machine-specific paths are part of the shared catalogue.
- Inventory is a global account-backed Owned and Needed catalogue. Project views filter the same records by stable catalogue key rather than making project copies.
- Secrets is an account-owned encrypted credential catalogue with search, filters, immediate Reveal/Hide/Copy, metadata editing, and reversible Archive/Restore.
- Clock persists multiple account-backed timer and stopwatch records. Health, Knowledge, Finance, and Trips likewise use the signed-in account database.
- Integrations is the operational hub for connected Google Calendar and other supported or placeholder providers.

### Cross-project Inventory access

The `sabah-one-inventory-mcp` Edge Function exposes exactly seven narrow Inventory tools through a remote MCP endpoint. Supabase OAuth 2.1 with PKCE supplies user tokens; the function validates the token and uses the normal authenticated client. RLS and dedicated RPCs limit access to `inventoryItems`, `inventoryNeeds`, and minimal project name/catalogue-key resolution. Generic snapshots, Secrets, finance, calendars, chats, settings, and broad mutation RPCs reject OAuth-client sessions.

The private planning integration checks live Inventory records before recommendations, requires explicit approval for writes, and keeps bulk or ambiguous changes behind review.

## Testing And Operational Reality

GitHub Actions is the validation authority for the hosted product. The repository uses static policy checks, TypeScript and unit checks, browser E2E coverage with Playwright, the web build, and hosted deployment verification.

Browser review remains necessary for OAuth, microphone access, wake word, browser notification permission, page-open prayer reminders, responsive layout, and live integrations. A green automated check proves only the paths it exercises; it does not prove a user-visible notification after the page is closed or every external provider state.

## Current Architecture Risks

- Entity retrieval and benchmark example retrieval remain heuristic; prompt or capability changes should be measured against the assistant corpus.
- Some integrations are real and some remain placeholder or simulated; [feature status](feature-status.md) is the source of truth.
- Browser notification delivery depends on permission and an open page, so the in-app reminder banner remains an explicit fallback.
- Shared records and secret metadata are account-isolated by RLS and constrained RPCs. Secret plaintext stays within the Vault reveal path and is excluded from records, logs, exports, Broadcast, and assistant context.
