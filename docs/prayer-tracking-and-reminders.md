# Prayer Tracking And Deadline Reminders

## Scope

Sabah One tracks the five canonical daily prayers independently from task IDs. Tasks remain the interaction surface and gamification bridge, while `PrayerTrackingState` is the durable source of truth for prayer outcomes, reminder receipts, and reporting.

The feature begins classified reporting at `trackingStartedAt`. Existing checked prayer-task entries are imported once as `unclassified`; Sabah One does not guess whether legacy completions were on time and does not infer misses before activation. On the first trusted activation-day schedule, Sabah One persists the exact canonical prayers that were still eligible. Later DST, season, or location timetable changes cannot rewrite that denominator. If no trusted activation-day snapshot exists after that date passes, unknown activation-day blanks remain excluded instead of being guessed.

## Root Cause And Design Boundary

The five-whys investigation traced the old limitation through five layers: prayer used generic habit UI, generic habits had only binary completion, binary history stored task IDs, ID-only history could not represent absent missed days, and the live prayer schedule was never joined to the completion domain. The fix therefore introduces canonical outcome state and one schedule-owning provider instead of adding more prayer-specific conditions to generic habit components.

## Outcomes And Deadlines

Every prayer completion records one explicit outcome:

- `on_time`
- `late`

Historical correction also supports `missed`. The persisted `unclassified` value is migration-only.

Final on-time deadlines use the Jafari rules requested by the product:

| Prayer | Final on-time deadline |
| --- | --- |
| Fajr | Sunrise |
| Dhuhr | Sunset |
| Asr | Sunset |
| Maghrib | Jafari Midnight |
| Isha | Jafari Midnight |

The deadline is exclusive: completion before it is on time; completion at or after it is late. The UI uses the clock only to highlight the likely selection. The user's explicit On time or Late choice is authoritative.

Sequential timetable windows remain separate and continue to drive Dashboard `Up Next`. A final deadline must not be reused as the active-prayer ranking window.

## State And Mutations

Canonical types live in `src/types/domain.ts`. Pure normalization, deadline, outcome, reminder-key, and percentage logic lives in `src/services/prayerTracking.ts`. `src/store/contexts/PrayerContext.tsx` owns the live schedule, tracking state, completion dialog, reminder lifecycle, and diagnostics.

Records use `<local date>::<PrayerName>` keys so deletion or recreation of a prayer task cannot erase history. The aggregate is decomposed into account-owned metadata, outcome, eligibility, and reminder-receipt records and changed through the transactional Sabah One mutation RPC.

All UI, chat, and voice entry points call the same prayer completion mutation. One completion:

1. writes the canonical outcome;
2. synchronizes matching prayer-task state and the compatibility daily log;
3. awards the same one-time XP for On time or Late;
4. records assistant activity when the assistant initiated it.

Repeated completion and task-ID churn must not award XP again. Historical correction changes the outcome without granting XP. Assistant undo reverses only the completion-owned task, gamification, and canonical-outcome fields. Ordinary tasks and habits keep their existing binary completion flow.

Because canonical tracking and gamification use separate persisted JSON stores, each completion also writes a duplicate transaction ledger entry inside the gamification profile. On hydration, either side can reconstruct the other after an interrupted write. The ledger's rewarded receipt and compatibility daily log make recovery idempotent, including taskless completions that use a stable canonical prayer identity. Assistant undo uses guarded, field-level inverse deltas rather than replacing whole snapshots, so later prayer completions, reminder receipts, XP, and unrelated task edits survive an earlier undo.

When chat or voice asks to complete a prayer without an explicit status, the shared assistant runtime persists a typed pending action and asks `On time or late?`. A strict local follow-up resolves that pending action without a second model call. Explicit status executes immediately.

## Schedule Ownership And Freshness

`PrayerProvider` is the sole timetable owner. Dashboard, Focus, Tasks, Profile, chat, voice, Settings, and Debug consume its state instead of fetching separately.

The provider refreshes on:

- local-date rollover;
- prayer location changes;
- window focus or visibility resume;
- explicit retry.

Only a cache matching the current local date and selected location may be shown. If a usable timetable is unavailable, the UI says so and does not manufacture deadline state.

AlAdhan schedule validation requires all five prayers plus Sunrise, Sunset, and Midnight, valid 24-hour clock ranges, and a plausible daily ordering. Reminder scheduling, deadline inference, next-prayer comparison, and clock-suggested outcomes pause when the returned IANA timezone does not match the desktop timezone; Debug and Settings expose the mismatch instead of guessing. Shared prayer history is blocked offline, and missing outcomes are never inferred without a trusted matching schedule.

## Reminder Lifecycle

Deadline reminders are enabled alongside prayer notifications by default. Settings supports 5, 10, 15, or 30 minutes, with 15 minutes as the default.

Eligible prayers produce one global warning across every Sabah One surface. Dhuhr/Asr and Maghrib/Isha are grouped when they share a deadline. The banner offers completion and a five-minute snooze; snooze is unavailable when five minutes or less remain. Completion removes the reminder immediately, while reaching the deadline closes it and materializes a Missed outcome when no completion exists.

Desktop builds schedule the timer in the Tauri process and use native notifications, so minimizing the window does not stop the timer. The timer stops when Sabah One is fully exited: there is currently no tray process, autostart, or operating-system background schedule. Browser builds use an in-page timer and Web Notifications while the page remains open.

Native/Web notification delivery is deduplicated by local prayer date, canonical prayer, and deadline. Permission is requested only after an explicit user action. `prefers-reduced-motion` replaces the gentle pulse with a static high-contrast warning.

## Reporting

Dashboard and Profile render a stacked accessible bar:

- green: On time;
- amber: Late;
- red: Missed.

The denominator includes only classified canonical opportunities: explicit On time/Late/Missed records and inferred misses whose deadlines have passed. Open or future prayers remain pending and do not dilute the percentages. A late backfill replaces an inferred miss. Sum-preserving rounding guarantees that a non-empty displayed split totals exactly 100%. Legacy unclassified completions are shown separately.

## Diagnostics And Verification

`Debug -> Prayer` shows schedule state and freshness, location and method, calculated deadlines, schedule/desktop timezones, next reminder, suppression reason, notification permission, latest notification key, and last error. Its labelled test uses the same process-side timer to fire five seconds later, so the window can be minimized for validation; it never changes a prayer outcome, reminder receipt, or XP.

Minimum focused coverage:

- all five deadline mappings, exact boundary, cross-midnight Isha, local dates, and DST;
- schedule validation, retry, stale/offline handling, and timezone mismatch;
- activation migration, duplicate or recreated tasks, XP dedupe, correction, assistant clarification, and undo;
- stacked percentage totals, reminder threshold, grouping, snooze, dedupe, cancellation, resume, rollover, and reduced motion;
- a deterministic Playwright timetable containing Sunrise, Sunset, and Midnight, with completion from a non-Dashboard reminder and reload verification.
