# Project Architecture

## Overview

HELM is a local-first desktop assistant for a solo operator. The in-app assistant is Lina. The product combines calendar, tasks and habits, finance tracking, Islamic knowledge and lifestyle tracking, prayer times, integrations, and chat and voice AI in one desktop app.

The current stack is:

- Tauri 2 for desktop packaging and local file access
- React 19 with TypeScript 5 and Vite 8 for the UI
- Supabase for optional sign-in and cloud sync
- Supabase Edge Functions plus OpenAI or local Ollama for assistant planning
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

The navigable surfaces are:

- Dashboard
- Chat
- Calendar
- Tasks
- Finance
- Knowledge
- Profile
- Credentials
- Workspaces
- Integrations
- Settings
- Debug

### State composition

`src/store/AppContext.tsx` is no longer the old monolithic store. It is now a compatibility facade that composes domain providers and exposes a single app-shaped API to the rest of the UI.

Provider stack:

1. `SettingsProvider`
2. `GamificationProvider`
3. `CalendarProvider`
4. `TaskProvider`
5. `KnowledgeProvider`
6. `FinanceProvider`
7. `ChatProvider` through `ChatBridge`
8. `ShellProvider`

State is split across:

- `src/store/contexts/CalendarContext.tsx`
- `src/store/contexts/TaskContext.tsx`
- `src/store/contexts/ChatContext.tsx`
- `src/store/contexts/KnowledgeContext.tsx`
- `src/store/contexts/FinanceContext.tsx`
- `src/store/contexts/GamificationContext.tsx`
- `src/store/contexts/SettingsContext.tsx`

The shell layer keeps only cross-cutting UI state plus credentials and workspaces.
It also carries one-shot assistant navigation requests so chat and voice can hand the UI enough context to reveal a specific task after a grounded assistant action.

### Domain model

`src/types/domain.ts` defines the app's source-of-truth types, including:

- surfaces and navigation targets
- chat conversations and messages
- calendar accounts, sources, and events
- tasks, goals, and habits
- knowledge topics, entries, and lifestyle items
- finance accounts, transactions, budgets, and savings goals
- integrations, settings, credentials, and workspaces

## Persistence And Sync

### Local-first storage

`src/store/persistence.ts` implements the storage priority rules:

- Signed in: Supabase is the source of truth, `localStorage` is the cache, and failed remote reads can fall back to cached local data.
- Signed out: Tauri file storage is preferred, with `localStorage` as the web fallback.

Writes always update `localStorage`, try the Tauri store when available, and queue debounced Supabase writes when the user is authenticated.
Authenticated writes now also mark a local dirty-cache timestamp so a just-created item is not overwritten by stale remote data during an immediate reload before the remote queue flushes.

### Desktop boundary

The Tauri side is intentionally thin. Rust commands handle app-data directory discovery and JSON store reads and writes. App behavior and business rules stay in the TypeScript layer.

### Supabase

`src/store/supabase.ts` provides:

- Google sign-in through Supabase Auth
- session bootstrap and auth-state subscription
- user-scoped key-value persistence through `kv_store`
- a debounced remote write queue

Supabase sync is optional. The app still works in local-first mode without it.
When the authenticated write queue succeeds, the dirty-cache marker is cleared. Exit and background transitions also trigger best-effort queue flushes so cloud sync is less likely to lag behind the most recent local write.

## Integrations And External Services

### Google auth and Calendar account linking

Google identity now has two cooperating layers:

- Supabase Google sign-in for HELM account auth and cloud sync
- Google Calendar account auth managed through `src/services/googleCalendarAuthManager.ts`

The auth manager links the matching signed-in Google profile to the same-email Calendar account when possible, while still preserving multi-account Google Calendar support for additional accounts.

Important behavior:

- Google Calendar accounts persist explicit auth metadata in the domain model.
- Passive sync is non-interactive. Opening Calendar should never launch a consent or reconnect popup.
- Accounts that lose Calendar access move into account-level states such as reconnect-required or revoked instead of surfacing as a generic global outage.
- GIS OAuth is still used for separately connected Calendar accounts, but those tokens are treated as cached transport credentials rather than the source of truth for account connection state.

### Calendar data model

Calendar state is hierarchical:

- account
- source
- event

Sources belong to accounts, and events belong to sources. Account removal must cascade cleanly. Primary-account promotion is handled automatically when needed.

Google-backed calendar accounts also carry per-account auth metadata such as provider mode, auth status, expiry, and last auth error so the UI can distinguish reconnect problems from service outages.

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

Both chat and voice now route through the shared grounded assistant runtime under `src/assistant/`. Deterministic local capabilities handle explicit app actions first, then open-ended planning can use either:

- hosted GPT-5.4-mini through the `assistant-openai` Supabase Edge Function for signed-in web builds
- local Ollama for desktop or local-first setups

The runtime stays provider-agnostic at the execution layer so voice and chat do not drift apart behaviorally. That shared runtime now owns task-title normalization, recent-task reveal handling such as "show me that task", and the typed navigation handoff used by the Tasks surface to jump to `All Tasks` and highlight the resolved item.

### Other external services

The app also integrates with:

- AlAdhan for prayer times
- Monzo for finance import
- ElevenLabs for voice output
- Deepgram for speech-to-text
- OpenWakeWord for local wake-word detection

Resilience utilities already exist in `src/services/circuitBreaker.ts`, `src/services/retry.ts`, `src/services/serviceBreakers.ts`, and `src/services/logger.ts`.

## Surface Notes

- Dashboard is the daily operating view and combines agenda, prayer, habits, goals, and achievements.
- Chat is persistent and conversation-based.
- Calendar is the most integration-heavy surface and depends on account/source/event integrity.
- Tasks and gamification are tightly linked through XP, streaks, and badge logic.
- Knowledge contains both a topic-entry knowledge base and the lifestyle tracker.
- Integrations is the operational hub for Google Calendar and placeholder external providers.
- Credentials and Workspaces exist, but both are still lightweight compared with calendar, tasks, finance, and knowledge.

## Testing And Operational Reality

The repo includes:

- unit tests with Vitest
- browser E2E coverage with Playwright
- desktop and web behavior that still requires manual checks for OAuth, microphone access, wake word, and some live integrations

The Vite README is still the default template, so the docs in this folder and `AGENTS.md` should be treated as the actual project guide until the README is refreshed.

## Current Architecture Risks

- Assistant command understanding is duplicated across voice and chat.
- Some integrations are real and some are still mock or placeholder paths, so docs must distinguish between them carefully.
- Large surface components still exist, even though state has already been split into domain providers.
- Security is MVP-grade for a single-user local-first app; credentials and API keys are not managed like a hardened multi-user product.
