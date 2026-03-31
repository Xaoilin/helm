# HELM - Project Guidelines

## Overview
HELM is a Windows-first, local-first personal assistant desktop app for a solo software engineer and entrepreneur. Built with Tauri (Rust backend) + React 19 + TypeScript 5.9 + Vite 8. Google Calendar integration is live with real OAuth; other integrations are mocked.

## Architecture

```
src/
  types/domain.ts          Domain interfaces (source of truth for all data shapes)
  store/
    AppContext.tsx          Central state (React context + useCallback). All CRUD lives here.
    persistence.ts         Tauri file store with localStorage fallback
  services/
    googleAuth.ts          Google Identity Services OAuth (GIS token model)
    googleCalendarApi.ts   Google Calendar REST v3 client (native fetch, no SDK)
  hooks/
    useGoogleSync.ts       Multi-account sync orchestrator + duplicate cleanup
  surfaces/
    ChatSurface.tsx        Text-first assistant (mocked AI responses)
    CalendarSurface.tsx    Month/Week/Agenda views, multi-account, source reassignment
    CredentialsSurface.tsx 1Password-first credential management with local vault fallback
    WorkspacesSurface.tsx  Local project directory management
    IntegrationsSurface.tsx Google Calendar OAuth + mocked service connections
    SettingsSurface.tsx    Preferences, credential source, Google client ID
  test/                    Vitest test suite (see Testing section)
src-tauri/
  src/commands.rs          Key-value file store (read_store, write_store)
  src/lib.rs               Tauri app setup with command registration
```

### Data flow
- State: `AppContext` holds all domain data, exposes CRUD via React context
- Persistence: Each collection auto-saves to Tauri file store (or localStorage fallback) via `useEffect` watchers
- Google Calendar: Account -> Sources (calendars) -> Events. Synced via `useGoogleSync` hook.
- Palette colors: Assigned per-account (not per-source). Index in `calendarAccounts` array determines color.
- Source reassignment: Users can move a calendar source to a different account to control its color.
- Deduplication: Shared calendars across accounts are deduplicated by `googleCalendarId` during sync.

### Key patterns
- `toLocalDateStr(date)` for date comparisons. Never use `toISOString().split('T')[0]` (shifts timezone).
- `getEventPalette(sourceId)` traces source -> account -> palette index for event coloring.
- Cascade deletes: removing an account cascades to its sources and events. Primary promotion is automatic.
- `cleanupDuplicateSources()` runs before each sync to remove stale duplicate sources from localStorage.

---

## Development Process (SDLC)

### Before every response that changes code:
1. `./node_modules/.bin/tsc -b` -- must compile with zero errors
2. `./node_modules/.bin/vitest run` -- all tests must pass
3. If UI changed, verify via Chrome MCP screenshot -- actually look at the result
4. If claiming a fix, show proof (screenshot, data dump, or test output)
5. `git add -A && git commit` -- commit all changes with a descriptive message
6. `git push` -- push to GitHub (auto-deploys to https://xaoilin.github.io/helm/ via GitHub Actions)
7. **Every code change must be committed, pushed, and deployed.** Never leave uncommitted work.

### When fixing bugs:
1. **Reproduce first** -- read localStorage or DOM to understand the actual data state
2. **Identify root cause** -- trace the data flow, don't patch symptoms
3. **Write a regression test** -- every bug fix gets a test that would have caught it
4. **Verify the fix is live** -- if data is stale in localStorage, handle migration/cleanup in the fix itself
5. **Never claim "fixed" without proof** -- show the user a screenshot or test result

### When building features:
1. Write the feature code
2. Write tests (unit tests at minimum, component tests for UI changes)
3. Compile clean (`tsc -b`)
4. All tests pass (`vitest run`)
5. Verify visually if UI changed
6. Only then report to user

### When removing features:
1. Remove the surface/component file
2. Remove from App.tsx navigation and router
3. Remove domain types from `types/domain.ts`
4. Remove state, CRUD, and persistence from `AppContext.tsx`
5. Remove all references in other surfaces (grep for the feature name)
6. Remove related tests
7. Compile + test + verify

---

## Testing Standards

### Run tests
```bash
./node_modules/.bin/vitest run       # single run (115+ tests, 11 files)
./node_modules/.bin/vitest           # watch mode
```

### Test files
| File | Coverage |
|------|----------|
| `setup.ts` | Mocks for Tauri API and localStorage |
| `appState.test.ts` | All CRUD operations, cascade deletes, primary promotion, bulk ops |
| `googleAuth.test.ts` | Token storage, validation, account isolation |
| `googleCalendarApi.test.ts` | Event conversion (timed, all-day, missing data), error classification |
| `googleApi.test.ts` | API calls with fetch mocking: calendar list, events, pagination, CRUD, errors |
| `syncDeduplication.test.ts` | Dedup logic, color mapping, source reassignment, event-to-account tracing |
| `calendarDateMapping.test.ts` | Timezone regression: toLocalDateStr, month/week date agreement |
| `duplicateCleanup.test.ts` | Pre-sync duplicate cleanup, event re-attribution, idempotency |
| `accountLegend.test.ts` | Palette assignment, stability, cycling, multi-account |
| `calendarCrud.test.ts` | View consistency, source reassignment palette changes, cascade deletes |
| `persistence.test.ts` | localStorage round-trip, null handling, invalid JSON |
| `surfaces.test.tsx` | Component render tests: all 6 surfaces, empty states, nav, key elements |

### Testing requirements
- **Every bug fix** must include a regression test
- **Every new feature** must include unit tests for its logic
- **Every surface** must render without crashing and show correct empty states
- **State management** tests must cover: create, read, update, delete, cascade delete, primary promotion
- **API tests** must mock `fetch` and verify headers, URLs, pagination, and error handling
- **Calendar tests** must verify month/week/agenda views agree on event dates

### Test coverage targets
- State management (AppContext): 100% of CRUD operations
- Services (googleAuth, googleCalendarApi): All public functions
- Sync logic: Dedup, cleanup, event reconciliation
- Surfaces: Render tests, empty states, key interactive elements
- Persistence: Round-trip, fallback, edge cases

---

## UI/UX Standards

### Design system
- **Dark theme**: Background `#0f1117`, text `#e1e4ea`, accent `#4f5bff`
- **Color palette**: 8 account colors (blue, purple, green, amber, pink, teal, orange, red)
- **Badge/card rarity backgrounds**: Must be lighter than the page background so they're visible on dark theme. Use mid-tone saturated colors, NOT dark/near-black shades:
  - Common: `#2a2d42` (light gray-blue)
  - Rare: `#1e2a4a` (visible blue)
  - Epic: `#1a3a28` (visible green)
  - Legendary: `#3a2a14` (visible amber/gold) + gold glow shadow
- **Rule**: On a dark theme, element backgrounds must contrast with the page background. Dark-on-dark is invisible. When in doubt, bump the lightness up.
- **Components**: `.btn`, `.card`, `.form-input`, `.form-select`, `.modal`, `.tag`, `.toggle`
- **Typography**: System font stack, 13-14px body, 18px headers

### Accessibility (WCAG 2.1)
- All icon-only buttons have `aria-label`
- Nav items have `aria-current="page"` when active
- Form labels linked to inputs with `htmlFor`/`id`
- Modals have `role="dialog"`, `aria-modal="true"`, `aria-label`
- Confirmation bars have `role="alert"`
- Empty states and status indicators have `role="status"`
- Toggle switches have `aria-label`
- Icons have `aria-hidden="true"`
- Semantic HTML: `<nav>`, `<main>`, `role="navigation"`, `role="banner"`, `role="contentinfo"`

### Empty states
Every surface must show a clear empty state with:
- An icon
- A heading explaining what goes here
- A description of what action to take
- A call-to-action button

### Destructive actions
- Delete/remove always requires a confirmation step (confirm-bar with explicit Delete + Cancel)
- Cascade effects are explained to the user ("Delete account and all its events?")
- Primary promotion is automatic when the primary item is removed

### Mocked features
If something is mocked, it must say so clearly in the UI:
- "Mocked AI responses" indicator in Chat
- "Local data -- not synced" when no Google accounts connected
- Integration status shows "mocked" tag for simulated connections

---

## Code Standards

### TypeScript
- Strict mode enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- All domain shapes defined in `types/domain.ts`
- State management in `AppContext.tsx` with typed context API
- No `any` types unless absolutely necessary

### React patterns
- Functional components only
- `useCallback` for all state mutation functions (prevents unnecessary re-renders)
- `useMemo` for derived state (visible events, calendar grids, palette maps)
- State lifted to AppContext, surfaces are consumers only

### Naming conventions
- Surfaces: `*Surface.tsx` (e.g., `CalendarSurface.tsx`)
- Services: `camelCase.ts` (e.g., `googleAuth.ts`)
- Tests: `*.test.ts` or `*.test.tsx`
- Types: PascalCase interfaces (e.g., `CalendarEvent`, `Workspace`)

---

## Known Limitations (v0.1.0)

### Mocked
- AI/LLM chat responses (returns canned replies based on keyword matching)
- Integration OAuth flows for GitHub, Slack, Linear (simulated connections)
- 1Password CLI integration (local vault fallback active)

### Working (live)
- Google Calendar OAuth with multi-account support
- Real calendar sync (pull events, push create/update/delete)
- Calendar source reassignment between accounts
- Duplicate calendar deduplication across accounts
- All CRUD operations (credentials, workspaces, calendar accounts/sources/events)
- Persistent storage (localStorage, Tauri file store when available)

### Not implemented
- Voice, mobile sync, browser autofill, multi-user
- Light theme (placeholder in settings)
- Tauri desktop build (requires MSVC linker on Windows -- Rust backend compiles on systems with proper MSVC setup)

---

## Mistakes to avoid
- **Don't use `toISOString().split('T')[0]`** for local date display -- it converts to UTC and shifts days
- **Don't claim a bug is fixed without verifying** -- code change != user-visible fix
- **Don't forget localStorage persists stale data** -- migrations/cleanup must handle existing data
- **Don't assume sync ran** -- dedup cleanup only happens during sync
- **Test the actual user scenario**, not just the happy path
- **Don't add features without tests** -- the test suite is the proof that things work
