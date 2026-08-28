import { useState } from 'react';
import { CANONICAL_PRAYER_NAMES } from '../../services/prayerTracking';
import { formatPrayerInstantTime } from '../../services/prayerTimeZone';
import { usePrayerContext } from '../../store/contexts/PrayerContext';

function display(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function PrayerDebug() {
  const prayer = usePrayerContext();
  const diagnostics = prayer.diagnostics;
  const [testStatus, setTestStatus] = useState<string | null>(null);

  const rows = [
    ['Schedule status', diagnostics.scheduleStatus],
    ['Schedule date', diagnostics.scheduleDate],
    ['Source / freshness', diagnostics.scheduleSource && diagnostics.fetchedAt
      ? `${diagnostics.scheduleSource} · fetched ${new Date(diagnostics.fetchedAt).toLocaleString()}`
      : null],
    ['Location', diagnostics.location],
    ['Method', diagnostics.method],
    ['Schedule timezone', diagnostics.scheduleTimezone],
    ['Prayer clock basis', diagnostics.scheduleTimezoneValid ? diagnostics.scheduleTimezone : null],
    ['Local browser timezone', diagnostics.localTimezone],
    ['Timezone matches', diagnostics.timezoneMatches],
    ['Next reminder fire', diagnostics.nextReminderAt && diagnostics.scheduleTimezone
      ? new Date(diagnostics.nextReminderAt).toLocaleString([], { timeZone: diagnostics.scheduleTimezone })
      : null],
    ['Suppression reason', diagnostics.suppressionReason],
    ['Notification permission', diagnostics.permissionState],
    ['Last notification key', diagnostics.lastNotificationKey],
    ['Last error', diagnostics.lastError],
  ] as const;

  return (
    <div className="debug-prayer-layout">
      <section className="card debug-prayer-card">
        <div className="dash-card-header">
          <span>Prayer schedule and reminder runtime</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void prayer.retrySchedule()}>
            Retry schedule
          </button>
        </div>
        <dl className="debug-prayer-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{display(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card debug-prayer-card">
        <div className="dash-card-header"><span>Calculated final deadlines</span></div>
        <div className="debug-prayer-deadlines">
          {CANONICAL_PRAYER_NAMES.map(prayerName => {
            const bounds = prayer.deadlines[prayerName];
            return (
              <div key={prayerName}>
                <strong>{prayerName}</strong>
                <span>
                  {bounds
                    ? `${formatPrayerInstantTime(bounds.startsAt, prayer.schedule?.timezone ?? '')} → ${bounds.deadlineName} ${formatPrayerInstantTime(bounds.deadlineAt, prayer.schedule?.timezone ?? '')}`
                    : 'Unavailable'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card debug-prayer-card">
        <div className="dash-card-header"><span>Safe notification test</span></div>
        <p className="debug-prayer-help">
          Schedules a clearly labelled test for five seconds from now. Keep this page open after clicking to
          verify the browser timer; no prayer outcome, reminder receipt, or XP changes.
        </p>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              const result = await prayer.requestReminderPermission();
              setTestStatus(`Permission result: ${result}`);
            }}
          >
            Request permission
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={async () => {
              const sent = await prayer.testReminder('Fajr');
              setTestStatus(sent
                ? 'TEST scheduled for five seconds from now. Keep this page open.'
                : 'Test not scheduled; permission is not granted or scheduling failed.');
            }}
          >
            Schedule TEST reminder (5 sec)
          </button>
        </div>
        {testStatus && <div className="debug-prayer-test-status" role="status">{testStatus}</div>}
      </section>
    </div>
  );
}
