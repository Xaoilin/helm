import { useShell } from "../../store/ShellContext";
import { usePrayerContext } from '../../store/contexts/PrayerContext';

export default function BoundedReminderBanner() {
  const shell = useShell();
  const prayer = usePrayerContext();
  const reminder = prayer.activeBoundedReminder;
  if (!reminder || prayer.activeReminder) return null;

  const isPrayer = reminder.kind === 'prayer-opportunity';
  return (
    <aside
      className={`prayer-deadline-reminder bounded-reminder ${isPrayer ? 'bounded-reminder-prayer' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="prayer-deadline-icon" aria-hidden="true">{isPrayer ? '🕌' : '↗'}</div>
      <div className="prayer-deadline-copy">
        <strong>{reminder.title}</strong>
        <span>{reminder.body}</span>
        {prayer.diagnostics.permissionState !== 'granted' && (
          <span className="bounded-reminder-fallback">
            Browser notifications are unavailable; this in-app reminder remains active.
          </span>
        )}
      </div>
      <div className="prayer-deadline-actions">
        {isPrayer && reminder.prayerNames.map(prayerName => (
          <button
            key={prayerName}
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => prayer.requestPrayerCompletion(prayerName, {
              prayerDate: reminder.date,
              source: 'reminder',
            })}
          >
            Mark {prayerName} prayed
          </button>
        ))}
        {!isPrayer && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => shell.navigate('dashboard')}>
            Open dashboard
          </button>
        )}
        {prayer.canSnoozeActiveBoundedReminder && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={prayer.snoozeActiveBoundedReminder}>
            Snooze once
          </button>
        )}
        {prayer.diagnostics.permissionState !== 'granted' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => shell.navigate('settings')}>
            Repair notifications
          </button>
        )}
      </div>
    </aside>
  );
}
