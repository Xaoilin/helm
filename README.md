# HELM

HELM is a local-first desktop assistant app called Lina. It combines calendar, tasks and habits, a multi-clock workspace for timers and stopwatches, finance tracking, knowledge management, prayer times, voice input, and chat into one Tauri + React application for a single-user workflow.

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
npm run handoff:check
npm run llm-compare
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run check
```

`npm run check` is the full local validation gate and runs lint, typecheck, unit tests, E2E, and build in sequence.

`npm run handoff:check` is the shipped-release gate. It fails unless there are no uncommitted non-generated changes, the current work is merged into `origin/master`, the `CI`, `Deploy to GitHub Pages`, and `Deploy Supabase Assistant Function` workflows have all succeeded for the deployed `master` head, the live GitHub Pages bundle is serving the current package version, and merged `codex/` branches have been cleaned up.

`npm run llm-compare` compares `gpt-5.4-mini` and `claude-sonnet-4-6` on HELM-style prompts using your local `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, then writes a Markdown report to `test-results/`.

## Project Map

- [AGENTS.md](C:/Users/alisa/Documents/Claude/pa-test/helm/AGENTS.md): short operational instructions for Codex
- [docs/project-architecture.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/project-architecture.md): app structure, provider graph, persistence, and integration boundaries
- [docs/engineering-guide.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/engineering-guide.md): workflow, Definition of Done, testing, resilience, and documentation rules
- [docs/feature-status.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/feature-status.md): truthful feature matrix
- [docs/assistant-command-architecture.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/assistant-command-architecture.md): long-term assistant design direction

## Current Product Reality

- Google Calendar OAuth and sync are real.
- Supabase auth and sync are real when configured.
- Hosted GPT-5.4-mini assistant replies are real when Supabase is configured, the `assistant-openai` Edge Function is deployed, and the user is signed in.
- Ollama-powered assistant responses are real when Ollama is running locally.
- Voice input shows a live transcript preview while recording when Deepgram or the browser fallback is available, then confirms the final command after you stop.
- A dedicated Clock surface provides a neat multi-clock workspace with on-demand timers and stopwatches, selectable alarm sounds, and local-first persistence.
- Several integrations remain placeholder or simulated.
- Credentials stored in the local vault are not encrypted at rest in this MVP.

Use [docs/feature-status.md](C:/Users/alisa/Documents/Claude/pa-test/helm/docs/feature-status.md) for the authoritative feature-by-feature status instead of inferring from UI copy.

## Hosted Assistant Deployment

The GitHub Pages build now defaults to hosted GPT-5.4-mini for open-ended assistant turns. The client never receives the OpenAI key directly; it calls a Supabase Edge Function instead.

One-time setup:

```bash
supabase functions deploy assistant-openai
```

Set these secrets in the `assistant-openai` function environment before you rely on the hosted path:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (recommended: `gpt-5.4-mini`)

For automated deploys on merge, add these GitHub repository secrets so `.github/workflows/deploy-supabase-assistant.yml` can sync the function:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `OPENAI_API_KEY`

The function is intended for signed-in HELM users. If hosted AI is not configured or the user is signed out, Lina falls back to local Ollama when available and otherwise stays on grounded built-in commands.

## Working Rules

- Keep the app local-first.
- Do not describe placeholder features as real.
- Update code, docs, and user-facing copy together when behavior changes.
- Keep assistant behavior shared across chat and voice.

## Deployment And CI

- Pull requests should satisfy `lint`, `typecheck`, `unit`, `e2e`, and `build`.
- GitHub Pages deploys only after the CI workflow succeeds on `master`, and that build defaults the website to hosted GPT-5.4-mini mode.
- `master` is protected to require pull requests plus the `lint`, `typecheck`, `unit`, `e2e`, and `build` checks before merge.
- Before calling a web-facing change live in a handoff, run `npm run handoff:check` after the merge and deploy complete.
