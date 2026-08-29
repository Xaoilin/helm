# App Time Zone

Sabah One has one optional account-shared app time-zone preference. It controls generic app dates and times, assistant temporal resolution, Calendar grouping and editing, and the explicit zone sent with Google Calendar writes.

## Resolution

`src/services/appTimeZone.ts` is the only browser time-zone discovery boundary. Resolution order is:

1. a validated `settings.appTimezone` IANA identifier;
2. the browser's validated IANA time zone (`Automatic`);
3. `UTC` when neither value is usable.

Settings commits a preferred zone before publishing it to React state. Clearing the value restores `Automatic`. Invalid values are rejected in the UI and discarded by the settings codec when reading untrusted records.

The optional field remains inside the existing account-owned `settings` JSON payload in `public.helm_records.payload`. The payload is already `jsonb`, and the field needs neither relational filtering nor indexing, so this change requires no database migration.

## Prayer Boundary

The app preference never changes prayer schedule authority. Prayer dates, schedule windows, current/next prayer, deadlines, reminders, completion dates, and prayer-relative assistant anchors continue to use the validated `PrayerTimesData.timezone` supplied with the timetable. Settings and Night Compass label a mismatch so the distinction is visible.

## Wall-Clock Conversion

`src/services/timeZone.ts` owns host-independent IANA conversion. Ambiguous fall-back times resolve to the earliest matching instant. Nonexistent spring-forward wall times fail closed and remain visible as a validation error; Sabah One does not silently move them.

Focused coverage uses London and New York plus London spring-forward and fall-back boundaries. Browser coverage verifies invalid input, committed save, reload, mismatch visibility, `Automatic`, and reset persistence.
