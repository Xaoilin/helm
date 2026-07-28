import { usePrayerContext } from '../../store/contexts/PrayerContext';

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function PrayerReminderBanner() {
  const prayer = usePrayerContext();
  const reminder = prayer.activeReminder;
  if (!reminder) return null;

  const names = reminder.prayerNames.join(' and ');
  const deadlineClock = reminder.deadlineAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <aside className="prayer-deadline-reminder" role="alert" aria-live="assertive">
      <div className="prayer-deadline-pulse" aria-hidden="true" />
      <div className="prayer-deadline-icon" aria-hidden="true">🕌</div>
      <div className="prayer-deadline-copy">
        <strong>Pray {names} before it is too late</strong>
        <span>
          On time until {reminder.deadlineName} at {deadlineClock}
          {' · '}
          <span className="prayer-deadline-countdown" aria-hidden="true">
            {formatRemaining(reminder.deadlineAt.getTime() - prayer.now.getTime())} remaining
          </span>
        </span>
      </div>
      <div className="prayer-deadline-actions">
        {reminder.prayerNames.map(prayerName => (
          <button
            key={prayerName}
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => prayer.requestPrayerCompletion(prayerName, {
              prayerDate: reminder.prayerDate,
              source: 'reminder',
            })}
          >
            Mark {prayerName} prayed
          </button>
        ))}
        {reminder.canSnooze && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={prayer.snoozeActiveReminder}>
            Snooze 5 min
          </button>
        )}
      </div>
    </aside>
  );
}
