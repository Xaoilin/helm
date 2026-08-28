# Sabah One

Sabah One is a hosted web product for a solo operator, with Lina as its in-app assistant. The supported product is the GitHub Pages website; there is no separate application runtime. Shared data belongs to the signed-in account, uses Supabase as its source of truth, and is unavailable when the account session is offline or invalid.

## Runtime

- GitHub Pages for the hosted web application
- React 19 with TypeScript 5 and Vite 8
- Supabase Auth, database-authoritative records, Realtime Broadcast, and Edge Functions
- Hosted OpenAI for assistant planning and narration
- Deepgram, ElevenLabs, browser speech APIs, and browser WASM where voice features are enabled
- Web Notifications and an in-app reminder banner while the page remains open

The browser is the complete Sabah One runtime. Account data and account-owned secrets remain online and database-authoritative; browser-only session state is limited to transient UI, permission, and diagnostic state.

## Using Sabah One

Open the deployed GitHub Pages URL in a supported browser and sign in with Supabase Auth. If a browser notification permission is denied or unavailable, the same prayer reminder remains available as an in-app banner while the page is open. Closing the page ends reminder observation; the product does not promise operating-system background delivery.

## Project Map

- [AGENTS.md](AGENTS.md): short project instructions
- [docs/project-architecture.md](docs/project-architecture.md): hosted runtime, provider graph, persistence, and integration boundaries
- [docs/engineering-guide.md](docs/engineering-guide.md): delivery, browser validation, resilience, security, and documentation rules
- [docs/agentic-coding-workflow.md](docs/agentic-coding-workflow.md): branch, CI, review, and hosted deployment policy
- [docs/ci-performance.md](docs/ci-performance.md): GitHub Actions and Pages performance evidence
- [docs/feature-status.md](docs/feature-status.md): truthful feature matrix
- [docs/prayer-tracking-and-reminders.md](docs/prayer-tracking-and-reminders.md): prayer outcomes and page-open reminders
- [docs/assistant-command-architecture.md](docs/assistant-command-architecture.md): grounded assistant capabilities and execution
- [docs/assistant-conversational-architecture.md](docs/assistant-conversational-architecture.md): hosted assistant turn contract
- [docs/voice-session-v1.md](docs/voice-session-v1.md): browser voice-session behavior
- [docs/design/night-compass-contract.md](docs/design/night-compass-contract.md): Night Compass dashboard design contract

## Current Product Reality

- Google Calendar OAuth and sync use hosted authorization and account-owned refresh credentials.
- Supabase sign-in and database-authoritative persistence are required for shared data. Signed-out, expired, or offline sessions cannot view or change shared records, and there is no durable offline mutation queue.
- The Secrets surface stores account-owned credentials through constrained RPCs backed by Supabase Vault. Values are masked by default, fetched one at a time for Reveal/Copy, and cleared from the UI on hide, navigation, page backgrounding, sign-out, or account switch.
- Hosted GPT-5.4-family assistant replies are available when Supabase is configured and the `assistant-openai` Edge Function is deployed. If the hosted planner is unavailable, Lina gives an honest in-app fallback and does not guess or execute an action.
- Chat and voice share one grounded assistant runtime. Browser speech input/output and Deepgram or ElevenLabs are capability-dependent; unavailable voice capabilities leave Chat available.
- Clock, Inventory, Finance, Health, Knowledge, Projects, Calendar, Prayer, and the Night Compass dashboard use account-backed records where marked real in [feature status](docs/feature-status.md).
- The private Inventory planning integration remains a narrow, account-authorized Supabase boundary and does not expose general app state or secrets.
- The former Inbox and quick-capture workflow are retired. Historical capture rows are preserved only as recoverable database tombstones.
- Some integrations remain placeholder or simulated; the feature matrix is authoritative.

## Hosted Assistant

The GitHub Pages client calls the `assistant-openai` Supabase Edge Function for hosted GPT planning. The OpenAI key stays in the function environment; it is not sent to the browser. The function supports the hosted model presets exposed by Settings and returns structured turns for reply, clarification, confirmation, and tool calls.

The Inventory MCP endpoint is separately account-authorized through Supabase OAuth 2.1 with PKCE and the production consent path `/helm/oauth/consent`. Its RLS policies and dedicated RPCs limit access to Inventory records and minimal project resolution.

## Delivery Rules

- GitHub Actions is the validation authority for the hosted website. Required checks cover policy, database contracts, lint, typecheck, unit tests, browser E2E, and the web build.
- GitHub Pages and the required Supabase Edge Function deployments publish only from the protected `master` path after the required checks pass.
- The deployed website and `public/release.json` must identify the same version. Open tabs use the manifest to move onto a newer deployed bundle after a one-time browser reload.
- Keep shared state and secrets account-owned, online-only, and database-authoritative.
- Keep chat and voice on the same assistant runtime and update docs and user-facing copy when behavior changes.
- Do not describe placeholder behavior as real, and do not call a branch-only change deployed or live.
