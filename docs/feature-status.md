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
| Chat assistant with hosted OpenAI | `real` | Real when Supabase is configured and the `assistant-openai` Edge Function is deployed. Browser builds now use hosted GPT-5.4 as the conversational brain: the model chooses `reply`, `clarify`, `confirm`, or `tool_calls`, HELM validates and executes locally, and GPT narrates the final visible reply from verified results. The live hosted path is benchmark-gated on `master` before deployment. |
| Chat assistant with Ollama | `real` | Real when Ollama is reachable locally. Ollama follows the same GPT-led orchestration shape as hosted mode instead of falling back to local regex intent parsing. |
| Chat conversation export | `real` | The Chat surface can copy the active conversation to the clipboard or export it as a Markdown file so the transcript can be dropped into Codex or other tools without reformatting. |
| Chat assistant without a live AI provider | `local-only/degraded` | Lina now refuses to guess or execute assistant actions from chat unless a live hosted or Ollama planner is available. Users can still use the app surfaces directly. |
| AI diagnostics in Debug tab | `real` | The Debug surface includes runtime status, Supabase session details, hosted health and smoke tests, Ollama checks, circuit-breaker reset controls, and the latest planning bundle, raw planner response, model turn, validator verdict, pending confirmation state, execution payloads, raw narration response, and final assistant message. |
| Voice assistant | `local-only/degraded` | Shares the same GPT-led assistant runtime as chat, including model-first intent recognition, confirmation handling, grounded ID validation, narrated final replies, and transcript correction memory for phrases the user fixes with "No, I said ...". With wake word plus STT/TTS available, Lina runs a hands-free turn-based voice session with spoken acknowledgement, a mic-ready tone after the microphone is truly live, live transcript preview, gentler pause handling before ending a turn, automatic follow-up listening, and wake-word sessions recorded into Chat history as separate conversation threads. Settings can turn Lina off completely without removing Chat. If no live planner is available, voice refuses to guess instead of falling back to local parser commands. |
| Wake word | `real` | OpenWakeWord runs locally in-browser via WASM. |
| Deepgram speech-to-text | `real` | Requires a configured API key. |
| Browser speech fallback | `local-only/degraded` | Usable where supported, less reliable than Deepgram. |
| ElevenLabs speech output | `real` | Requires env configuration. |
| Browser speech output | `local-only/degraded` | Used when ElevenLabs is unavailable. |
| Prayer times and adhan notifications | `real` | Backed by AlAdhan plus browser notifications. |
| Clock surface (multi-timer and stopwatch workspace) | `real` | Local-first timers and stopwatches persist through the shared store so in-progress sessions survive navigation and reloads. The Clock surface supports multiple on-demand timer and stopwatch cards, custom per-card names, selectable built-in alarm sounds, and completion alerts that keep pulsing until acknowledged. |
| Finance accounts, budgets, and savings goals | `real` | Local-first app data is implemented. |
| Monzo import | `real` | Live API path exists when configured. |
| Knowledge base and lifestyle tracker | `real` | Local-first CRUD is implemented. |
| Workspaces | `local-only/degraded` | Metadata exists, but product depth is still limited. |
| 1Password integration | `placeholder/simulated` | UI and preference model exist, but live CLI-backed integration is not implemented. |
| GitHub integration | `placeholder/simulated` | Simulated connection flow only. |
| Slack integration | `placeholder/simulated` | Simulated connection flow only. |
| Linear integration | `placeholder/simulated` | Simulated connection flow only. |
| Local credential vault | `local-only/degraded` | Works locally, but credentials are not encrypted at rest in this MVP. |
