# Feature Status

Use this matrix when updating documentation or UI copy. `real` means the hosted website has an implemented path; `placeholder/simulated` means the integration is intentionally not presented as live; `required-gap` means policy requires the capability but the implemented path is not yet available.

| Area | Status | Notes |
| --- | --- | --- |
| Hosted GitHub Pages website | `real` | The browser website is the only supported Sabah One product runtime. |
| Supabase account persistence | `real` | Authenticated RLS reads, semantic mutations, idempotent receipts, tombstones, explicit ordering, private account Broadcast, and version-gap recovery make Supabase authoritative. Signed-out, expired, or offline sessions fail closed; there is no durable offline mutation queue or conflict chooser. |
| Encrypted Secrets vault | `real` | The signed-in Secrets surface stores searchable account metadata and encrypted values through Supabase Vault RPCs. Values are masked, revealed one at a time, cleared from browser UI state when hidden or the session changes, and excluded from records, Broadcast, logs, exports, and assistant context. Archive and Restore are reversible; bulk export, sharing, autofill, permanent deletion, and assistant access are absent. |
| Google Calendar OAuth | `real` | Multi-account Calendar uses hosted authorization-code exchange and server-held refresh credentials. Reconnect is explicit and account-scoped. |
| Google Calendar sync | `real` | Passive account-bound sync uses Google as provider source of truth, preserves cache on unsafe partial failures, and never opens consent during ordinary navigation or refresh. |
| Google Calendar diagnostics | `real` | Debug shows hosted readiness, credential health, expiry and failure metadata, migration state, ownership checks, sync counts, blocked reasons, and redacted request diagnostics. |
| Manual calendar accounts | `real` | Manual calendar records belong to the signed-in Sabah One account database and are unavailable while the session is offline. |
| Account app time zone | `real` | Settings supports an optional validated IANA zone with `Automatic` browser fallback. Generic app, assistant, and Calendar time use one resolver; prayer calculations remain bound to the timetable zone and mismatches are labelled. |
| Chat assistant with hosted OpenAI | `real` | The `assistant-openai` Edge Function provides hosted GPT-5.4-family planning and narration. The browser receives structured turns; Lina validates and executes grounded capabilities, or gives an in-app fallback without guessing when the hosted planner is unavailable. |
| Chat assistant with Ollama | `real` | Settings can select a configured Ollama HTTP endpoint, and Auto may use it when hosted planning is unavailable. The same grounding, confirmation, deterministic execution, and verified-narration rules apply. |
| Chat conversation export | `real` | Chat can copy the active conversation or export it as Markdown. |
| Lina activity log and undo | `real` | Chat and voice mutations create account-backed audit entries with grounded undo metadata. One workflow-named coordinator owns the supported task, prayer, calendar, finance, and knowledge inverse operations. |
| Global Inventory | `real` | Account-backed Owned and Needed records support search, filters, dimensions, specifications, stock changes, acquisition, archive, and reviewed multiline import. Projects link to the same catalogue by stable key. |
| Inventory planning boundary | `real` | The authenticated `sabah-one-inventory-mcp` Edge Function exposes seven narrow Inventory tools through Supabase OAuth, RLS, and dedicated RPCs. It does not expose Secrets, finance, calendars, chats, settings, or broad mutations. |
| Employment application tracker | `real` | The account-backed Employment tab tracks company, role, URL, work type, fully-remote eligibility and evidence, compensation, pipeline status, application date, next action/date, notes, and contact/evidence history. It includes summaries, filters, current opportunities, daily activity, empty states, and the three confirmed seed records; authenticated first-party persistence accepts Employment mutations and recovers from transient session or first-write failures. |
| Employment external agent access | `required-gap` | Lina can navigate to Employment, but no external Employment mutation tool is published. Direct database and UI fallbacks are prohibited; a dedicated OAuth approval and least-privilege MCP/RPC boundary is required. |
| Cross-feature external agent access | `required-gap` | `docs/agent-access.md` makes domain-scoped MCP the required external AI interface. Inventory is currently the only published external domain; other features must add a narrow MCP contract when materially changed. Secrets remain intentionally excluded. |
| AI diagnostics in Debug | `real` | Debug shows hosted assistant readiness, the latest planning and validation trace, pending confirmation, execution facts, narration response, and hosted usage estimates without exposing tokens. |
| User-facing Database / AI Health Center | `real` | Dashboard and Settings show Supabase session, Broadcast, Google Calendar, hosted assistant, and voice readiness with actionable reconnect or unavailable states. |
| Night Compass prayer-first dashboard | `real` | Dashboard renders the canonical five-prayer sequence first, followed by a source-reviewed Quran motivation card, Learn and Move progression, and one compact Tasks route. Meaning is labelled as paraphrase and linked to the exact Quran.com source. |
| Life Hero concept approval artifact | `prototype/concept` | A standalone responsive proof at `concepts/life-hero/index.html` renders the highest-quality accepted native same-body glTF 2.0 rig: a complete 105,568-vertex neutral body, four deterministic clean PBR body regions that retain the paid texture only for face/hair, a separately toggleable 31,604-vertex fitted graphite jacket with exact copied native skin weights, and four embedded native clips. Anatomy inspection controls, SVG equipment, and reduced-motion/static fallbacks remain. This is not a production rig, authored wardrobe system, engine decision, or dashboard behavior, and explicit visual approval is still required before KAN-258. |
| Daily Learn and Move progression | `real` | Signed-in accounts have versioned templates, five cumulative levels, local-date progress logs, editable prayer-relative anchors, account-owned preferences, one snooze, and visible in-app states for unavailable schedules. |
| Dashboard focus ranking diagnostics | `real` | Grounded candidates and hosted review traces remain available for Debug; generic ranking does not control the Night Compass hierarchy. |
| Voice assistant | `real` | Voice shares the hosted GPT assistant runtime with Chat. Browser microphone, transcript, wake-word, speech output, and in-app controls are capability-dependent; Chat remains available when a voice capability is unavailable. |
| Wake word | `real` | OpenWakeWord runs in the browser through WASM where supported. |
| Deepgram speech-to-text | `real` | Requires account configuration and browser microphone access. |
| Browser speech fallback | `real` | Browser speech recognition is available where supported, with lower fidelity than Deepgram. |
| ElevenLabs speech output | `real` | Requires hosted configuration and browser audio playback. |
| Browser speech output | `real` | Browser speech synthesis is used where supported when hosted audio is unavailable. |
| Prayer times, outcomes, deadlines, and reminders | `real` | `PrayerProvider` owns validated Jafari times, account-backed outcomes, page-open reminder planning, and diagnostics. Web Notifications are attempted only after explicit permission; the in-app banner is the fallback. Reminders are observed only while the page remains open. |
| Clock surface | `real` | Timers and stopwatches persist as independently mutable account records with custom cards, laps, alarms, and acknowledgement-required alerts. |
| Finance accounts, budgets, and savings goals | `real` | Account-backed records are isolated per signed-in user. |
| Health reflection log | `real` | Account-backed quick-entry and recent-history views are implemented. |
| Monzo import | `real` | The API path exists when configured. |
| Knowledge base and lifestyle tracker | `real` | Account-backed CRUD converges across signed-in sessions, and Knowledge entries can move between topics without recreation. |
| Projects reference hub | `real` | Searchable Pinned, Projects, and Archived sections expose links, repositories, documentation, display-only prerequisites, and portable guidance. Shared catalogue metadata is keyed by stable `catalogKey`. |
| Trips planner | `real` | Account-backed multi-country trips, ordered legs, itinerary items, bookings, budgets, and explicit calendar import are implemented. |
| GitHub integration | `placeholder/simulated` | Simulated connection flow only. |
| Slack integration | `placeholder/simulated` | Simulated connection flow only. |
| Linear integration | `placeholder/simulated` | Simulated connection flow only. |
