# Feature Status

Use this matrix when updating docs or UI copy. The allowed states are:

- `real`
- `local-only/degraded`
- `placeholder/simulated`

| Area | Status | Notes |
| --- | --- | --- |
| Supabase sign-in and sync | `real` | Optional cloud sync when Supabase is configured and the user signs in. |
| Local persistence | `real` | Tauri file storage is preferred when available, with `localStorage` as fallback/cache. |
| Google Calendar OAuth | `real` | Supports multi-account Calendar connections plus linking the matching HELM Google sign-in to the same-email Calendar account. |
| Google Calendar sync | `real` | Events and calendars sync through the Google Calendar API with account-level reconnect states; passive sync is non-interactive and no longer uses auth failures to trip the service breaker. |
| Local calendar accounts | `real` | Local accounts and sources work without cloud sync. |
| Chat assistant with hosted OpenAI | `real` | Real when Supabase is configured and the `assistant-openai` Edge Function is deployed. Browser builds currently call it with the configured Supabase project access key, while Supabase sign-in remains for sync and user-scoped data. |
| Chat assistant with Ollama | `real` | Real when Ollama is reachable locally. |
| Chat assistant without a live AI provider | `local-only/degraded` | Uses a grounded local capability runtime for navigation, task create/reveal/complete/delete, calendar actions, finance logging, and knowledge notes, but open-ended planning still depends on hosted OpenAI or local Ollama. |
| AI diagnostics in Debug tab | `real` | The Debug surface now includes a dedicated AI Assistant panel with runtime status, Supabase session details, hosted health/smoke tests, Ollama checks, and circuit-breaker reset controls. |
| Voice assistant | `local-only/degraded` | Shares the grounded capability runtime with chat, including confirmed task deletion and local-first transcript correction memory for phrases the user fixes with "No, I said ...". With wake word plus STT/TTS available, Lina now runs a hands-free turn-based voice session with spoken acknowledgement, a mic-ready tone after the microphone is truly live, live transcript preview, gentler pause handling before ending a turn, automatic follow-up listening, and wake-word sessions recorded into Chat history as separate conversation threads. Settings can now turn Lina off completely without removing Chat. STT/TTS coverage still degrades when Deepgram or voice output providers are unavailable. |
| Wake word | `real` | OpenWakeWord runs locally in-browser via WASM. |
| Deepgram speech-to-text | `real` | Requires a configured API key. |
| Browser speech fallback | `local-only/degraded` | Usable where supported, less reliable than Deepgram. |
| ElevenLabs speech output | `real` | Requires env configuration. |
| Browser speech output | `local-only/degraded` | Used when ElevenLabs is unavailable. |
| Prayer times and adhan notifications | `real` | Backed by AlAdhan plus browser notifications. |
| Clock surface (stopwatch and timer) | `real` | Local-first stopwatch and countdown timer persist through the shared store so in-progress sessions survive navigation and reloads. |
| Finance accounts, budgets, and savings goals | `real` | Local-first app data is implemented. |
| Monzo import | `real` | Live API path exists when configured. |
| Knowledge base and lifestyle tracker | `real` | Local-first CRUD is implemented. |
| Workspaces | `local-only/degraded` | Metadata exists, but product depth is still limited. |
| 1Password integration | `placeholder/simulated` | UI and preference model exist, but live CLI-backed integration is not implemented. |
| GitHub integration | `placeholder/simulated` | Simulated connection flow only. |
| Slack integration | `placeholder/simulated` | Simulated connection flow only. |
| Linear integration | `placeholder/simulated` | Simulated connection flow only. |
| Local credential vault | `local-only/degraded` | Works locally, but credentials are not encrypted at rest in this MVP. |
