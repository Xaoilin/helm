# HELM - Project Guidelines

## Overview
HELM is a Windows-first, local-first personal assistant desktop app for a solo software engineer and entrepreneur. The personal assistant is called **Lina**. Built with Tauri (Rust backend) + React 19 + TypeScript 5.9 + Vite 8. Features: Google Calendar (live OAuth), gamified task management (125 badges), Islamic knowledge base, Shia prayer times with Adhan, personal finance with Monzo, AI assistant "Lina" (Ollama LLM + ElevenLabs voice + Deepgram STT + OpenWakeWord wake word).

## Architecture

```
src/
  types/domain.ts          Domain interfaces (source of truth for all data shapes)
  types/openwakeword.d.ts  Type declarations for OpenWakeWord WASM module
  store/
    AppContext.tsx          Central state (React context + useCallback). All CRUD lives here.
    persistence.ts         Auto-sync: localStorage (cache) + Supabase (source of truth when signed in)
    supabase.ts            Supabase client, Google Auth, CRUD operations, debounced write queue
  services/
    gamification.ts        XP, levels, streaks, 125 badges, prayer stats, habit tallies
    googleAuth.ts          Google Identity Services OAuth (GIS token model)
    googleCalendarApi.ts   Google Calendar REST v3 client (native fetch, no SDK)
    prayerTimes.ts         AlAdhan API client (Shia Ithna-Ashari method)
    voiceAssistant.ts      Intent parsing (keyword + LLM), ElevenLabs TTS, browser TTS
    ollamaApi.ts           Ollama REST client, system prompt builder with live user data
    deepgramSTT.ts         MediaRecorder + Deepgram REST API for speech-to-text
    monzoApi.ts            Monzo bank API client, transaction mapper
    financeHelpers.ts      Currency formatting, category configs, calculations
    habitEmoji.ts          Auto-detect emoji from habit title keywords
  hooks/
    useGoogleSync.ts       Multi-account sync orchestrator + duplicate cleanup
  components/
    VoiceAssistant.tsx     Lina floating panel: text input, voice, wake word, LLM fallback
    HabitCards.tsx          Reusable habit card grid with confirmation, progress ring, XP
  surfaces/
    DashboardSurface.tsx   Landing page: agenda, habits, goals, prayer times/stats, achievements
    ChatSurface.tsx        Full chat with Ollama LLM (typing indicator, conversation history)
    CalendarSurface.tsx    Month/Week/Agenda/Accounts views, multi-account, source reassignment
    TasksSurface.tsx       Today/All Tasks/Goals tabs, habit management, gamification
    FinanceSurface.tsx     Overview/Transactions/Accounts/Budgets, Monzo sync
    KnowledgeSurface.tsx   Browse/Add/Search/Lifestyle (Haram/Halal tracker with drag-and-drop)
    ProfileSurface.tsx     Level/XP, streak heatmap, 125 badges, prayer rate breakdown
    SettingsSurface.tsx    Preferences, voice config, Ollama, prayer settings
  test/                    Vitest test suite (194+ tests, 14 files)
  config.ts                Environment variables with Settings fallback
```

### Data flow
- **State:** `AppContext` holds all domain data, exposes CRUD via React context
- **Persistence:** Auto-sync — every state change writes to localStorage (instant) + Supabase (debounced 1s). On login, loads from Supabase as source of truth. Invisible to user.
- **Google Calendar:** Account -> Sources (calendars) -> Events. Synced via `useGoogleSync` hook.
- **Voice pipeline:** OpenWakeWord (wake word) -> Deepgram (STT) -> Ollama (LLM intent) -> ElevenLabs (TTS)
- **LLM actions:** Ollama can emit action tags `[ADD_TASK:...]`, `[COMPLETE_TASK:...]`, `[NAV:...]` which are parsed and executed

### Key patterns
- `toLocalDateStr(date)` for date comparisons. **Never** use `toISOString().split('T')[0]` (shifts timezone).
- `getEventPalette(sourceId)` traces source -> account -> palette index for event coloring.
- Cascade deletes: removing an account cascades to its sources and events. Primary promotion is automatic.
- Keyword-first, LLM-second: Navigation commands resolve instantly, only unknown intents go to Ollama.

---

## Development Process (SDLC)

### Git branching strategy
- **Every feature or fix gets its own branch.** Never commit directly to `master`.
- Branch naming: `feature/<short-description>` or `fix/<short-description>`
- Workflow:
  1. `git checkout master && git pull`
  2. `git checkout -b feature/<name>`
  3. All work on the feature branch
  4. `git checkout master && git merge feature/<name> --no-ff`
  5. `git push origin master` (auto-deploys via GitHub Actions)
  6. `git push origin feature/<name>` (keep for rollback)
- **Do NOT delete feature branches** — they serve as rollback points.

### Before every response that changes code:
1. `./node_modules/.bin/tsc -b` — must compile with zero errors
2. `./node_modules/.bin/vitest run` — all unit tests must pass
3. `npx playwright test` — all E2E tests must pass
4. If UI changed, verify via screenshot — actually look at the result
5. If claiming a fix, show proof (screenshot, test output, data dump)
6. **Write E2E tests for any new feature** — add to existing spec file or create new one
7. Commit on feature branch, merge to master, push both
8. **Every code change must be committed, pushed, and deployed.** Never leave uncommitted work.

### When fixing bugs:
1. **Reproduce first** — read localStorage or DOM to understand actual data state
2. **Identify root cause** — trace the data flow, don't patch symptoms
3. **Write a regression test** — every bug fix gets a test that would have caught it
4. **Verify the fix is live** — if data is stale in localStorage, handle migration/cleanup
5. **Never claim "fixed" without proof** — show the user a screenshot or test result

---

## Engineering Standards

### SOLID Principles

**Single Responsibility (SRP):**
- Each service handles one concern: `googleAuth.ts` (tokens), `deepgramSTT.ts` (audio capture), `ollamaApi.ts` (LLM calls)
- Surfaces focus on one domain area each
- **Known violation:** `AppContext.tsx` is a God object (832 lines, 15+ responsibilities). Future refactor: split into `CalendarContext`, `TaskContext`, `ChatContext`, etc.
- **Known violation:** `VoiceAssistant.tsx` mixes audio input, wake word, voice output, and state machine. Future refactor: extract `useVoiceInput()`, `useWakeWord()`, `useVoiceOutput()` hooks.
- **Known violation:** Large surfaces (DashboardSurface 721 lines, CalendarSurface 778 lines). Future refactor: extract sub-components like `<PrayerWidget />`, `<CalendarWeekView />`.

**Open/Closed (OCP):**
- Voice backend uses strategy-like pattern (Deepgram/Chrome/none)
- New wake word models can be added by dropping `.onnx` files
- **Improvement needed:** Navigation keywords are hardcoded arrays. Should support plugin/config extension.

**Interface Segregation (ISP):**
- Domain types in `types/domain.ts` are focused and minimal
- No fat interfaces — each type has only its relevant fields

**Dependency Inversion (DIP):**
- Services take API keys and endpoints as parameters (not importing globals)
- Config loaded from env vars with Settings fallback
- **Improvement needed:** AppContext directly calls `saveStore()` in 16 useEffect blocks. Should use a persistence middleware.

### Error Handling Standards

**Current state:** 13 swallowed errors (`catch {}` or `catch { /* fall through */ }`). This is the biggest gap.

**Rules going forward:**
- **Never swallow errors silently.** At minimum, `console.warn('[service]', error)`.
- **Create error boundaries** around each surface to prevent one broken surface from crashing the app.
- **User-visible errors** must show a toast or inline message — never fail silently from the user's perspective.
- **API errors** must be typed and classified (auth error vs network error vs rate limit).
- **Log format:** `[ServiceName] action failed: message` — consistent across all services.

**Existing good patterns:**
- `GoogleApiError` with `.isAuthError`, `.isForbidden`, `.isRateLimit` classification
- Deepgram checks for 401/403 specifically
- Ollama marks itself as unavailable on failure, retries after 30s

### Resilience Patterns

**Circuit Breaker** (`src/services/circuitBreaker.ts`):
- ✅ Implemented. 3 states: closed → open (fast-fail) → half-open (test recovery).
- Pre-configured breakers in `src/services/serviceBreakers.ts` for all 6 external services.
- **Rule:** Every new external API integration must get its own circuit breaker.

**Bulkhead Pattern** (isolate failures):
- ✅ Implemented via React Error Boundaries (`src/components/ErrorBoundary.tsx`).
- Each surface wrapped independently — one crash shows error + retry, rest of app works.
- Voice fallback chain: Deepgram → Chrome → text-only. Chat: Ollama → mock replies.

**Retry with Backoff** (`src/services/retry.ts`):
- ✅ Implemented. Exponential backoff (1s → 2s → 4s), max 3 retries.
- Only retries transient errors (network, 503, 429). Skips 401/403/400/404.
- Applied to: Google Calendar, Prayer Times. Not applied to local services (Ollama).

**Timeouts** (`src/config/constants.ts` → `API_TIMEOUT`):
- ✅ Implemented on all 6 external API calls via `AbortSignal.timeout()`.
- Defaults: Google Calendar 10s, Monzo 10s, Deepgram 15s, Ollama 30s, ElevenLabs 10s, Prayer Times 10s.
- **Rule:** Every new API call must include a timeout from `API_TIMEOUT`.

### Testing Standards

**Current:** 209 unit tests (15 files) + 15 E2E tests (4 files) = 224 total tests.

**Three testing layers — ALL are mandatory for every feature:**

#### 1. Unit Tests (Vitest) — `./node_modules/.bin/vitest run`
- **Every bug fix** must include a regression test
- **Every new feature** must include unit tests for its logic
- **Every surface** must render without crashing and show correct empty states
- **State management** tests must cover: create, read, update, delete, cascade delete
- **API tests** must mock `fetch` and verify headers, URLs, error handling
- **Resilience tests** must cover circuit breaker states and retry behavior

#### 2. E2E Tests (Playwright) — `npx playwright test`
- **Every new feature MUST have E2E tests.** No exceptions.
- E2E tests verify the full user journey: click → state change → UI update → persistence
- Test files live in `e2e/` directory, one per feature area
- Tests run against the real dev server (auto-started by Playwright config)

**E2E test requirements per feature:**
- **Navigation features:** Test that clicking a nav item renders the correct surface
- **CRUD features:** Test the full create → read → update → delete lifecycle via UI
- **Form features:** Test filling inputs, submitting, and verifying the result appears
- **Modal/panel features:** Test open, interact, close (via button AND keyboard)
- **Gamification features:** Test that XP/badge toasts appear after completing actions
- **Settings features:** Test changing a setting, then verify it persists after reload
- **Lina features:** Test opening panel, sending command, verifying response

**E2E test file structure:**
```
e2e/
  navigation.spec.ts    — Sidebar nav, surface switching, back navigation
  tasks.spec.ts         — Task lifecycle, empty states, add task flow
  settings.spec.ts      — Settings sections visible, toggles work
  lina.spec.ts          — Panel open/close, keyboard shortcut, commands, chips
  calendar.spec.ts      — (add when building calendar features)
  finance.spec.ts       — (add when building finance features)
  prayer.spec.ts        — (add when building prayer features)
```

#### 3. Visual Verification (Screenshots)
- If UI changed, take a screenshot and actually look at the result
- If claiming a fix, show proof (screenshot, test output, or data dump)

**Before merging ANY feature branch, ALL three must pass:**
1. `./node_modules/.bin/tsc -b` — zero type errors
2. `./node_modules/.bin/vitest run` — all unit tests pass
3. `npx playwright test` — all E2E tests pass

**Features that CANNOT be tested via automation (manual testing required):**
- Voice input (SpeechRecognition, ElevenLabs, Deepgram — require real mic/network)
- Monzo bank sync (requires real token + Monzo app approval)
- Google OAuth popups (separate windows)
- Adhan notifications (time-dependent, use Settings test buttons)
- Wake word detection (OpenWakeWord WASM — use mock in unit tests, manual for real)

### Code Quality Rules

**Magic numbers:**
- ✅ All timing/threshold values extracted to `src/config/constants.ts` (`TIMING`, `API_TIMEOUT`, `LIMITS`)
- **Rule:** Never use literal numbers for timing, thresholds, or limits. Always import from `constants.ts`.
- **Rule:** When adding a new constant, add it to the appropriate group (`TIMING` for ms values, `LIMITS` for counts/sizes, `API_TIMEOUT` for fetch timeouts)

**TypeScript:**
- Strict mode enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- All domain shapes defined in `types/domain.ts`
- No `any` types unless absolutely necessary (mark with `eslint-disable` comment)
- Zero type errors at all times

**React patterns:**
- Functional components only
- `useCallback` for all state mutation functions
- `useMemo` for derived state
- State lifted to AppContext, surfaces are consumers only

**Naming conventions:**
- Surfaces: `*Surface.tsx`
- Services: `camelCase.ts`
- Tests: `*.test.ts` or `*.test.tsx`
- Types: PascalCase interfaces
- Constants: UPPER_SNAKE_CASE
- Feature branches: `feature/<kebab-case>` or `fix/<kebab-case>`

### Security Standards

**API keys:**
- Loaded from `VITE_*` env vars (baked into build) with Settings localStorage fallback
- **Risk:** Keys visible in JS bundle and network requests. Acceptable for personal-use app.
- **If ever multi-user:** Proxy API calls through a backend. Never expose keys in client-side code.

**Input handling:**
- React escapes all JSX content (XSS protection by default)
- No `dangerouslySetInnerHTML` used anywhere
- All form inputs use controlled components (`value=` binding)

### Performance Standards

**Memoization:**
- `useMemo` for expensive derived state (visible events, calendar grids, palette maps)
- `useCallback` for all AppContext CRUD functions
- **Improvement needed:** No code splitting for optional features (OpenWakeWord, Supabase). Use dynamic `import()` for features gated behind settings.

**Re-renders:**
- Dashboard tick interval (1s for prayer countdown) causes frequent re-renders — acceptable for countdown accuracy
- **Improvement needed:** Split AppContext into domain-specific contexts to prevent cross-domain re-renders

### Accessibility (WCAG 2.1)

**Implemented:**
- All icon-only buttons have `aria-label`
- Form labels linked to inputs with `htmlFor`/`id`
- Modals have `role="dialog"`, `aria-modal="true"`, `aria-label`
- Confirmation bars have `role="alert"`, empty states have `role="status"`
- Toggle switches have `aria-label`, icons have `aria-hidden="true"`
- Keyboard navigation: Escape to close, Enter to submit, Ctrl+Shift+L for Lina
- RTL support for Arabic (direction: rtl throughout Lina panel)

**Gaps:**
- No focus management when modals open
- No skip-to-content link
- Color-only indicators should add text labels

---

## UI/UX Standards

### Design system
- **Dark theme**: Background `#0f1117`, cards `#181b27`, text `#e1e4ea`, accent `#4f5bff`
- **Badge rarity backgrounds**: Must be lighter than page background (dark-on-dark is invisible)
- **Components**: `.btn`, `.card`, `.form-input`, `.form-select`, `.modal`, `.tag`, `.toggle`
- **Rule**: On dark theme, element backgrounds must contrast with the page background.

### Empty states
Every surface must show: icon, heading, description, call-to-action button.

### Destructive actions
- Delete always requires confirmation (confirm-bar with Delete + Cancel)
- Cascade effects explained to user

---

## Mistakes to Avoid
- **Don't use `toISOString().split('T')[0]`** — it converts to UTC and shifts days
- **Don't claim a bug is fixed without verifying** — code change != user-visible fix
- **Don't forget localStorage persists stale data** — migrations must handle existing data
- **Don't swallow errors** — at minimum log them, ideally surface to user
- **Don't add features without tests** — the test suite is the proof things work
- **Don't commit directly to master** — use feature branches
- **Don't add magic numbers** — extract to named constants
- **Don't couple services to global state** — pass dependencies as parameters
