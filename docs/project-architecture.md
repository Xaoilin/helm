# Project Architecture

## Overview

HELM is a local-first desktop assistant for a solo operator. The in-app assistant is Lina. The product combines calendar, tasks and habits, finance tracking, Islamic knowledge and lifestyle tracking, prayer times, integrations, and chat and voice AI in one desktop app.

The current stack is:

- Tauri 2 for desktop packaging and local file access
- React 19 with TypeScript 5 and Vite 8 for the UI
- Supabase for optional sign-in and cloud sync
- Ollama, Deepgram, ElevenLabs, and OpenWakeWord for assistant features

## Runtime Map

### App shell

`src/App.tsx` renders:

- the left-hand navigation
- the active surface
- the global `VoiceAssistant` panel
- auth controls for Supabase-backed sign-in

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

### Desktop boundary

The Tauri side is intentionally thin. Rust commands handle app-data directory discovery and JSON store reads and writes. App behavior and business rules stay in the TypeScript layer.

### Supabase

`src/store/supabase.ts` provides:

- Google sign-in through Supabase Auth
- session bootstrap and auth-state subscription
- user-scoped key-value persistence through `kv_store`
- a debounced remote write queue

Supabase sync is optional. The app still works in local-first mode without it.

## Integrations And External Services

### Google auth split

There are two separate Google flows:

- Supabase Google sign-in for account auth and cloud sync
- GIS OAuth in `src/services/googleAuth.ts` for Google Calendar access

This split is intentional. Calendar connection lives in `src/surfaces/IntegrationsSurface.tsx` and supports multiple Google Calendar accounts at once.

### Calendar data model

Calendar state is hierarchical:

- account
- source
- event

Sources belong to accounts, and events belong to sources. Account removal must cascade cleanly. Primary-account promotion is handled automatically when needed.

### Assistant and voice services

Current assistant-related services live in:

- `src/services/voiceAssistant.ts`
- `src/services/ollamaApi.ts`
- `src/services/deepgramSTT.ts`
- `src/components/VoiceAssistant.tsx`
- `src/store/contexts/ChatContext.tsx`

Today the voice path uses a keyword-first parser with local read-only shortcuts and an Ollama fallback that emits action tags. Chat has a separate Ollama path that also parses action tags. This duplication is a known architecture seam and is the main reason the command-system redesign lives in `docs/assistant-command-architecture.md`.

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
