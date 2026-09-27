# Prayer Tracking And Reminders

## Scope

Sabah One tracks the five canonical daily prayers independently from task IDs. Tasks remain the interaction surface and gamification bridge, while the prayer service is the durable source of truth for prayer outcomes, reporting and every reminder (deadline, opportunity and Learn/Move), including their snoozes. `PrayerTrackingState` is the app's in-memory view of the outcomes.

The feature begins classified reporting at `trackingStartedAt`. Existing checked prayer-task entries are imported once as `unclassified`; Sabah One does not guess whether legacy completions were on time or infer misses before activation. On the first trusted activation-day schedule, Sabah One persists the exact canonical prayers that were still eligible. Later timetable changes cannot rewrite that denominator. If no trusted activation-day snapshot exists after that date passes, unknown activation-day blanks remain excluded rather than guessed.

## Root Cause And Design Boundary

The old limitation came from generic binary task history: task IDs could record completion but could not represent an absent missed day or connect that absence to a live prayer schedule. Canonical outcome state and one schedule-owning provider keep prayer rules out of generic task components.

## Outcomes And Deadlines

Every prayer completion records one explicit outcome:

- `on_time`
- `late`

Historical correction also supports `missed`. The persisted `unclassified` value is migration-only.

Final on-time deadlines use the Jafari rules requested by the product:

| Prayer | Final on-time deadline |
| --- | --- |
| Fajr | Sunrise |
| Dhuhr | Asr |
| Asr | Maghrib |
| Maghrib | Isha |
| Isha | Jafari Midnight |

The deadline is exclusive: completion before it is on time; completion at or after it is late. The UI uses the clock only to highlight the likely selection. The user's explicit On time or Late choice is authoritative.

Sequential timetable windows drive the Dashboard's next-prayer orientation. A final deadline must not be reused as the active-prayer ranking window.
The raw validated schedule timezone is the authoritative prayer clock. Night Compass converts the current instant into that zone, then compares its wall-clock minutes and seconds with the displayed prayer `HH:mm` values, including the before-Fajr interval and overnight interpolation to tomorrow's Fajr. The optional account app time zone may differ and remains presentation-only for generic time; Settings and Night Compass label the boundary.

## State And Mutations

Canonical types live in `src/types/domain.ts`. Pure normalization, deadline, outcome, and percentage logic lives in `src/services/prayerTracking.ts`. Cohesive schedule and completion/undo transitions live in `prayerSchedulePolicy.ts` and `prayerCompletionPolicy.ts`; `prayerServiceReminders.ts` decides whether a reminder the service sent still shows and how it is worded. `PrayerProvider` composes one hook per side effect from `src/store/contexts/prayer/`: `usePrayerTracking` (state), `usePrayerSchedule` (timetable refresh), `usePrayerClock` (15-second tick, date rollover, focus and visibility resume), `usePrayerPersistence` (prayer-service load and sync), `usePrayerServiceReminders` (the prayer service's reminders: loaded on start, received over the live-update stream, shown as banners and Web Notifications, snoozed through the service), `usePrayerMomentumReminderSync` (sends the Learn/Move reminder preferences to the prayer service), `usePrayerCompletionWorkflow` (outcome and today's habit), `usePrayerRewards` (the planner's prayer XP once the prayer service confirmed an outcome), `usePrayerCompletionPrompt` (completion dialog), and `usePrayerAdhan`. Diagnostics are built by `src/services/prayerDiagnostics.ts`.

Records use `<local date>::<PrayerName>` keys so deletion or recreation of a prayer task cannot erase history.

The Spring Boot prayer service is the source of truth for outcomes, the tracking start and the activation-day snapshot. `usePrayerServiceSync` merges the service's outcomes into the state (newest status wins; unchanged records are kept as they are), and sends every later change as a create, correction, or delete in order, retrying after failures. The old `prayerTracking` account collection (reminder receipts) is retired: the prayer service imported it once, and the app no longer reads or writes it (it is decode-only in `storeKeys.ts`).

All UI entry points call the same prayer completion mutation. One completion writes the canonical outcome, synchronizes matching prayer-task state and the compatibility daily log, and awards one-time XP. Repeated completion and task-ID churn cannot award XP again. Historical correction changes the outcome without granting XP.

## Schedule Ownership And Freshness

`PrayerProvider` is the sole timetable owner. Dashboard, Focus, Tasks, Profile, Settings, and Debug consume its state instead of fetching separately.

The provider refreshes on:

- local-date rollover;
- prayer location changes;
- browser visibility resume;
- explicit retry.

Only a cache matching the current schedule-zone date and selected location may be shown. If a usable timetable is unavailable, the UI says so and does not manufacture deadline state.

AlAdhan schedule validation requires all five prayers plus Sunrise, Sunset, and Midnight, valid 24-hour clock ranges, a plausible daily ordering, and a valid explicit IANA timezone. The supplied timezone is preserved rather than rewritten through browser `resolvedOptions()`. Deadline instants, next/current prayer state, countdowns, temporal dots, Focus, and clock-suggested outcomes all use that schedule timezone. Missing or invalid timezones fail closed; a valid schedule/browser mismatch does not suppress prayer state. Shared prayer history is blocked offline, and missing outcomes are never inferred without a trusted schedule.

## Reminder Lifecycle

The prayer service decides and times every reminder; no browser timer decides one. Every 30 seconds it sends:

- a **deadline** reminder when a prayer not yet recorded has the user's reminder minutes (5, 10, 15 or 30; 15 by default) left of its on-time window, expiring at the deadline;
- a **prayer opportunity** notice at each unrecorded prayer's start, expiring 30 minutes later or at the deadline, whichever is first; it is exempt from quiet hours;
- a **Learn/Move** notice at each enabled pillar's anchor prayers (Learn defaults to Dhuhr, Maghrib and Isha; Move to Asr, Maghrib and Isha) until that day's Level 1 is complete, skipping anchors inside 22:00-08:00 schedule-zone quiet hours and expiring at the pillar's next anchor or quiet hours. Pillars due at the same instant share one notice.

Each reminder is recorded once and sent to open tabs over the live-update stream: deadline reminders as `prayer.reminder` events, and every kind as `prayer.notice` events carrying the reminder JSON (key, kind, date, prayer, pillars, firesAt, expiresAt, deadline, snooze state). On load the app asks for the reminders already sent that are still active (`GET /api/prayer/v1/reminders`), and reloads them after any prayer change or stream reconnect. A newly arriving reminder is shown as a Web Notification when permitted (tabs share one: its tag is the reminder key); otherwise the in-app banner, which shows every active reminder, is the fallback with a Settings repair action. The banners hide a reminder when it expires (the page clock re-checks every 15 seconds), is snoozed, or once its prayer is recorded or its Learn/Move Level 1 is complete. Each prayer has its own deadline reminder; prayer reminders are never grouped.

Snooze is `POST /api/prayer/v1/reminders/{key}/snooze`: one five-minute snooze per reminder, offered only when it ends before the reminder does. The service refuses a second snooze (`409 snooze_used`) or one too late (`409 snooze_too_late`), and the banner shows its message. When the snooze ends the service sends the reminder once more.

Learn/Move preferences stay editable in Settings and are saved with Daily Momentum; whenever they, or the latest date a pillar's Level 1 was complete, change, the app sends them (`PUT /api/prayer/v1/reminders/momentum`, debounced, skipped when the service already holds the same). Turning prayer reminders off hides deadline and opportunity reminders; Learn/Move reminders follow their own preferences. Reminders reach open tabs only; Sabah One does not promise delivery when no tab is open.

Prayer XP comes from the planner service: after the prayer service confirms an outcome change, the app asks the planner to bring prayer rewards in line; it rewards each recorded prayer exactly once (and takes back a reward whose outcome was undone), and the completion celebration shows what it earned.

Permission is requested only after an explicit user action. `prefers-reduced-motion` replaces the gentle pulse with a static high-contrast warning.

## Reporting

### Daily Quran reading

Night Compass follows the prayer section with the full Arabic text and English
translation of a curated Quran passage, side by side at every screen width.
All 206 passages include their complete Tanzil Arabic ayahs and Marmaduke
Pickthall translation, with a surah/ayah reference, translator credit and source
links. Arabic reads right to left in the right column; English reads left to
right in the left column. The collection covers 374
non-overlapping ayahs, including 133 prayer, remembrance and dua passages.

The prayer provider's local calendar date selects one passage per day from a
stable shuffled order shared across devices. Every passage appears once in any
206 consecutive days before the order repeats, including across cycle boundaries,
month/year ends, leap days and daylight-saving changes. Refreshing preserves the
day's passage. There is no AI generation or account mutation path. See
[the source review](quran-motivation-review.md) for the complete-text integrity
receipt and original selection rationale.

### Prayer outcomes

Dashboard and Profile render a stacked accessible bar:

- green: On time;
- amber: Late;
- red: Missed.

The denominator includes only classified canonical opportunities: explicit On time/Late/Missed records and inferred misses whose deadlines have passed. Open or future prayers remain pending and do not dilute the percentages. A late backfill replaces an inferred miss. Sum-preserving rounding guarantees that a non-empty displayed split totals exactly 100%. Legacy unclassified completions are shown separately.

## Diagnostics And Verification

`Debug -> Prayer` shows schedule state and freshness, location and method, the authoritative prayer clock basis, browser timezone and whether it differs, calculated deadlines, the reminders the prayer service sent that show now (key, kind, prayer or pillars, expiry, snoozes used), suppression reason, notification permission, latest notification key, and last error. Its labelled test shows a notification five seconds later; it never changes a prayer outcome, reminder, or XP.

Minimum focused coverage:

- all five deadline mappings, exact boundary, cross-midnight Isha, schedule-zone dates, London DST boundaries, and London/Berlin instant differences;
- schedule validation, retry, stale/offline handling, valid browser mismatch behavior, and invalid/missing timezone fail-closed behavior;
- activation migration, duplicate or recreated tasks, XP dedupe, correction, assistant clarification, and undo;
- stacked percentage totals, reminder contracts, showing and hiding service reminders (expiry, snooze, recorded prayer, completed pillar), one service snooze and its refusal, momentum preference sync, and reduced motion;
- a deterministic Playwright timetable containing Sunrise, Sunset, and Midnight, with completion from a non-Dashboard reminder and reload verification;
- browser notification permission, live-stream delivery, denied-permission fallback, and the explicit limitation that a closed page is not observed.
