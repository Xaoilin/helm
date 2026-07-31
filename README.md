# HELM

HELM is an account-backed desktop assistant app called Lina. Shared data belongs to the signed-in account, uses Supabase as its only source of truth, and is unavailable offline. Machine paths, native approvals, runtime logs, and device credentials remain local to each device.

## Stack

- Tauri 2
- React 19
- TypeScript 5
- Vite 8
- Supabase for required account identity and shared persistence
- Ollama, Deepgram, ElevenLabs, and OpenWakeWord for assistant features

## Quick Start

```bash
npm install
npm run dev
```

Open the app in the browser for web development, or run the Tauri shell separately when working on desktop-specific behavior.

## Core Commands

```bash
npm run agent:fast
npm run test:database
npm run check
npm run test:e2e:smoke
npm run test:e2e
npm run test:e2e:visual -- --surface projects --viewports 390x844,1440x900
npm run test:native
npm run test:database
npm run build:web
npm run handoff:check
npm run llm-compare
```

`npm run agent:fast` is the normal iteration loop. It compares the complete working tree with `origin/master`, then selects policy, changed-file lint, incremental typecheck, related unit tests, UI smoke tests, and native tests as needed. It prints and records timings.

`npm run check` is the single full local gate. Independent lint, typecheck, unit, blocking E2E, web-build, and relevant native work runs concurrently without compiling TypeScript twice.

Behavioral E2E and screenshot evidence are separate. `test:e2e` blocks on behavior and responsive overflow; `test:e2e:visual` captures only requested surfaces and viewports. Each run starts a fresh server on its own free port.

`npm run handoff:check` is the shipped-release gate. It fails unless there are no uncommitted non-generated changes, the current work is merged into `origin/master`, the `CI`, `Deploy to GitHub Pages`, and `Deploy Supabase Assistant Function` workflows have all succeeded for the deployed `master` head, the live GitHub Pages bundle is serving the current package version, and merged `codex/` branches have been cleaned up.

`npm run llm-compare` compares `gpt-5.4` and `claude-sonnet-4-6` on HELM-style prompts using your local `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, then writes a Markdown report to `test-results/`.

## Project Map

- [AGENTS.md](AGENTS.md): short operational instructions for Codex
- [docs/project-architecture.md](docs/project-architecture.md): app structure, provider graph, persistence, and integration boundaries
- [docs/engineering-guide.md](docs/engineering-guide.md): workflow, Definition of Done, testing, resilience, and documentation rules
- [docs/agentic-coding-workflow.md](docs/agentic-coding-workflow.md): agent feedback, CI, automated review, and production automation policy
- [docs/ci-performance.md](docs/ci-performance.md): measured local and hosted validation receipts
- [docs/feature-status.md](docs/feature-status.md): truthful feature matrix
- [docs/assistant-command-architecture.md](docs/assistant-command-architecture.md): long-term assistant design direction

## Current Product Reality

- Google Calendar OAuth and sync are real.
- Supabase auth and database-authoritative persistence are required for shared app data. Devices converge automatically without conflict prompts or durable offline queues.
- Hosted GPT-5.4 assistant replies are real when Supabase is configured, the `assistant-openai` Edge Function is deployed, and the live planner is available.
- Ollama-powered assistant responses are real when Ollama is running locally.
- Voice input shows a live transcript preview while recording when Deepgram or the browser fallback is available, then confirms the final command after you stop.
- A dedicated Clock surface provides a neat multi-clock workspace with on-demand timers and stopwatches, custom names, selectable alarm sounds, eye-catching finish alerts, and account-backed persistence.
- Several integrations remain placeholder or simulated.
- API keys and device integration settings remain device-local and are not an encrypted vault in this MVP.

Use [docs/feature-status.md](docs/feature-status.md) for the authoritative feature-by-feature status instead of inferring from UI copy.

## Hosted Assistant Deployment

The GitHub Pages build now defaults to hosted GPT-5.4 for assistant planning. The client never receives the OpenAI key directly; it calls a Supabase Edge Function instead.

One-time setup:

```bash
supabase functions deploy assistant-openai
```

Set these secrets in the `assistant-openai` function environment before you rely on the hosted path:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (recommended: `gpt-5.4`)

For automated deploys on merge, add these GitHub repository secrets so `.github/workflows/deploy-supabase-assistant.yml` can sync the function:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `HELM_DATABASE_BACKUP_SHA256` for the verified pre-cutover logical backup
- `OPENAI_API_KEY`

The function is intended for signed-in HELM users. If hosted AI is not configured or the user is signed out, Lina uses local Ollama only when a live Ollama planner is available and otherwise refuses to guess.

## Working Rules

- Keep shared state database-authoritative and online-only; keep machine-bound execution material device-local.
- Do not describe placeholder features as real.
- Update code, docs, and user-facing copy together when behavior changes.
- Keep assistant behavior shared across chat and voice.

## Deployment And CI

- Install local Git hooks with `npm run hooks:install` if you want the pre-commit and pre-push gates in this checkout.
- Pull requests should satisfy `agent-policy`, `database`, `codex-review`, `lint`, `typecheck`, `unit`, `e2e`, `build`, and the stable `native` aggregator.
- `codex-review` is useful extra review coverage, but OpenAI quota or provider availability is not a release dependency; unavailable review output is reported as a warning.
- Non-draft same-repo `codex/*` pull requests into `master` auto-promote after those automated gates pass. Manual PR approval is intentionally not required for this personal-app workflow.
- Auto-promotion records the tested PR merge tree. After squash merge, verification-only CI proves that `master` has that exact tree and revalidates the successful source jobs before the release is accepted. Direct pushes and ordinary manual CI dispatches still run the full suite.
- GitHub Pages and Supabase deploys remain required for `master`, and the Pages build defaults the website to hosted GPT-5.4 mode.
- `master` is protected to require pull requests plus the automated checks before merge.
- Before calling a web-facing change live in a handoff, run `npm run handoff:check` after the merge and deploy complete.
