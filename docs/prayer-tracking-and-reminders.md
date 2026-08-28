# Prayer Tracking And Page-Open Reminders

## Scope

Sabah One tracks the five canonical daily prayers independently from task IDs. Tasks remain the interaction surface and gamification bridge, while `PrayerTrackingState` is the durable source of truth for prayer outcomes, deadline receipts, bounded opportunity and momentum receipts, and reporting.

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
| Dhuhr | Sunset |
| Asr | Sunset |
| Maghrib | Jafari Midnight |
| Isha | Jafari Midnight |

The deadline is exclusive: completion before it is on time; completion at or after it is late. The UI uses the clock only to highlight the likely selection. The user's explicit On time or Late choice is authoritative.

Sequential timetable windows drive the Dashboard's next-prayer orientation. A final deadline must not be reused as the active-prayer ranking window.

## State And Mutations

Canonical types live in `src/types/domain.ts`. Pure normalization, deadline, outcome, reminder-key, and percentage logic lives in `src/services/prayerTracking.ts`. `PrayerProvider` owns the live schedule, tracking state, completion dialog, reminder lifecycle, and diagnostics.

Records use `<local date>::<PrayerName>` keys so deletion or recreation of a prayer task cannot erase history. The aggregate is decomposed into account-owned metadata, outcome, eligibility, and reminder-receipt records and changed through the transactional Sabah One mutation RPC.

All UI, chat, and voice entry points call the same prayer completion mutation. One completion writes the canonical outcome, synchronizes matching prayer-task state and the compatibility daily log, awards one-time XP, and records assistant activity when applicable. Repeated completion and task-ID churn cannot award XP again. Historical correction changes the outcome without granting XP. Assistant undo reverses only the completion-owned task, gamification, and canonical-outcome fields.

When chat or voice asks to complete a prayer without an explicit status, the shared assistant runtime stores a typed pending action and asks `On time or late?`. An in-app follow-up resolves that pending action without a second model call. Explicit status executes immediately.

## Schedule Ownership And Freshness

`PrayerProvider` is the sole timetable owner. Dashboard, Focus, Tasks, Profile, Chat, Voice, Settings, and Debug consume its state instead of fetching separately.

The provider refreshes on:

- local-date rollover;
- prayer location changes;
- browser visibility resume;
- explicit retry.

Only a cache matching the current local date and selected location may be shown. If a usable timetable is unavailable, the UI says so and does not manufacture deadline state.

AlAdhan schedule validation requires all five prayers plus Sunrise, Sunset, and Midnight, valid 24-hour clock ranges, and a plausible daily ordering. Reminder scheduling, deadline inference, next-prayer comparison, and clock-suggested outcomes pause when the returned IANA timezone does not match the browser timezone; Debug and Settings expose the mismatch instead of guessing. Shared prayer history is blocked offline, and missing outcomes are never inferred without a trusted matching schedule.

## Reminder Lifecycle

Prayer opportunity and deadline reminders are enabled alongside prayer notifications by default. Settings supports 5, 10, 15, or 30 deadline-warning minutes, with 15 minutes as the default. Opportunity notices fire at the canonical prayer start and remain exempt from non-prayer quiet hours.

Eligible prayers produce one global warning across every Sabah One surface. Dhuhr/Asr and Maghrib/Isha are grouped when they share a deadline. The banner offers completion and a single five-minute snooze; snooze is unavailable when five minutes or less remain. Completion removes the reminder immediately, while reaching the deadline closes it and materializes a Missed outcome when no completion exists.

The same `PrayerProvider` builds the prayer-relative Learn and Move plan; there is no second scheduler. Learn defaults to Dhuhr, Maghrib, and Isha anchors, while Move defaults to Asr, Maghrib, and Isha. Account-owned preferences can disable a pillar or edit its allowed anchors without hiding the Dashboard pillar. Simultaneous Learn/Move prompts coalesce, each logical pillar/anchor keeps its own stable receipt, Level 1 completion cancels future prompts, and 22:00-08:00 quiet hours suppress non-prayer prompts only. Each logical reminder has a hard one-snooze bound.

The browser page owns the in-page reminder timer. When the user grants permission, Web Notifications provide an additional browser notification while the page remains open. If permission is denied, unavailable, or delivery cannot be observed, the reminder stays visible in-app with a Settings repair action. Closing the page ends reminder observation; Sabah One does not promise background delivery after the page is closed.

Browser notification delivery is deduplicated by local prayer date, canonical prayer, and deadline. Permission is requested only after an explicit user action. `prefers-reduced-motion` replaces the gentle pulse with a static high-contrast warning.

## Reporting

Dashboard and Profile render a stacked accessible bar:

- green: On time;
- amber: Late;
- red: Missed.

The denominator includes only classified canonical opportunities: explicit On time/Late/Missed records and inferred misses whose deadlines have passed. Open or future prayers remain pending and do not dilute the percentages. A late backfill replaces an inferred miss. Sum-preserving rounding guarantees that a non-empty displayed split totals exactly 100%. Legacy unclassified completions are shown separately.

## Diagnostics And Verification

`Debug -> Prayer` shows schedule state and freshness, location and method, calculated deadlines, browser timezone, next reminder, suppression reason, notification permission, latest notification key, and last error. Its labelled test uses the same page timer to fire five seconds later; it never changes a prayer outcome, reminder receipt, or XP.

Minimum focused coverage:

- all five deadline mappings, exact boundary, cross-midnight Isha, local dates, and DST;
- schedule validation, retry, stale/offline handling, and timezone mismatch;
- activation migration, duplicate or recreated tasks, XP dedupe, correction, assistant clarification, and undo;
- stacked percentage totals, reminder threshold, grouping, snooze, dedupe, cancellation, resume, rollover, and reduced motion;
- a deterministic Playwright timetable containing Sunrise, Sunset, and Midnight, with completion from a non-Dashboard reminder and reload verification;
- browser notification permission, page-open delivery, denied-permission fallback, and the explicit limitation that a closed page is not observed.
