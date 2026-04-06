# HELM

HELM is a local-first desktop assistant app called Lina. It combines calendar, tasks and habits, finance tracking, knowledge management, prayer times, voice input, and chat into one Tauri + React application for a single-user workflow.

## Stack

- Tauri 2
- React 19
- TypeScript 5
- Vite 8
- Supabase for optional sign-in and sync
- Ollama, Deepgram, ElevenLabs, and OpenWakeWord for assistant features

## Quick Start

```bash
npm install
npm run dev
```

Open the app in the browser for web development, or run the Tauri shell separately when working on desktop-specific behavior.

## Core Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run check
```

`npm run check` is the full local validation gate and runs lint, typecheck, unit tests, E2E, and build in sequence.

## Project Map

- [AGENTS.md](C:/Users/alisa/Documents/Claude/pa-test/helm/AGENTS.md): short operational instructions for Codex
- [docs/project-architecture.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/project-architecture.md): app structure, provider graph, persistence, and integration boundaries
- [docs/engineering-guide.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/engineering-guide.md): workflow, Definition of Done, testing, resilience, and documentation rules
- [docs/feature-status.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/feature-status.md): truthful feature matrix
- [docs/assistant-command-architecture.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/assistant-command-architecture.md): long-term assistant design direction

## Current Product Reality

- Google Calendar OAuth and sync are real.
- Supabase auth and sync are real when configured.
- Ollama-powered assistant responses are real when Ollama is running locally.
- Voice input degrades when Deepgram is unavailable and can fall back to browser speech APIs where supported.
- Several integrations remain placeholder or simulated.
- Credentials stored in the local vault are not encrypted at rest in this MVP.

Use [docs/feature-status.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/feature-status.md) for the authoritative feature-by-feature status instead of inferring from UI copy.

## Working Rules

- Keep the app local-first.
- Do not describe placeholder features as real.
- Update code, docs, and user-facing copy together when behavior changes.
- Keep assistant behavior shared across chat and voice.

## Deployment And CI

- Pull requests should satisfy `lint`, `typecheck`, `unit`, `e2e`, and `build`.
- GitHub Pages deploys only after the CI workflow succeeds on `master`.
- `master` is protected to require pull requests plus the `lint`, `typecheck`, `unit`, `e2e`, and `build` checks before merge.
