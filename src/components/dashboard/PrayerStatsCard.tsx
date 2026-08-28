import type { PrayerName, PrayerOutcomeStats, PrayerOutcomeStatus } from '../../types/domain';
import {
  CANONICAL_PRAYER_NAMES,
  getPrayerDeadlineBounds,
  isPrayerOpportunityTracked,
} from '../../services/prayerTracking';
import { shiftPrayerDate } from '../../services/prayerTimeZone';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import PrayerOutcomeBars from '../prayer/PrayerOutcomeBars';

interface PrayerStatsCardProps {
  prayerStats: PrayerOutcomeStats;
  showPrayerLog: boolean;
  onTogglePrayerLog: () => void;
}

function getDisplayedStatus(
  prayerName: PrayerName,
  date: string,
  prayer: ReturnType<typeof usePrayerContext>,
): PrayerOutcomeStatus | 'pending' | 'not_tracked' {
  const record = prayer.getOutcome(date, prayerName);
  if (record) return record.status;
  if (!prayer.schedule || !prayer.scheduleTimezoneValid) return 'pending';
  if (!isPrayerOpportunityTracked(
    prayer.tracking,
    { date, timezone: prayer.schedule.timezone, prayers: prayer.schedule.prayers },
    prayerName,
    prayer.now,
  )) {
    return 'not_tracked';
  }
  const bounds = getPrayerDeadlineBounds(
    prayer.schedule.prayers,
    date,
    prayerName,
    prayer.schedule.timezone,
  );
  return bounds && prayer.now >= bounds.deadlineAt ? 'missed' : 'pending';
}

export default function PrayerStatsCard({
  prayerStats,
  showPrayerLog,
  onTogglePrayerLog,
}: PrayerStatsCardProps) {
  const prayer = usePrayerContext();
  const last7Days: { dateStr: string; label: string }[] = [];
  for (let index = 6; index >= 0; index -= 1) {
    const dateStr = shiftPrayerDate(prayer.today, -index);
    if (!dateStr) continue;
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    last7Days.push({
      dateStr,
      label: index === 0
        ? 'Today'
        : index === 1
          ? 'Yesterday'
          : date.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }),
    });
  }

  return (
    <section className="dash-card prayer-stats-card">
      <div className="dash-card-header">
        <span>🙏 Prayer outcomes · Current month</span>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onTogglePrayerLog}>
          {showPrayerLog ? 'Close history' : 'Correct history'}
        </button>
      </div>

      {showPrayerLog && (
        <div className="prayer-history-editor">
          <p id="prayer-history-help">
            Correct On time, Late, or Missed outcomes. Corrections never award XP.
            Open and future prayers stay locked here; record them from Prayer Times or Tasks after praying.
          </p>
          <div className="prayer-history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  {CANONICAL_PRAYER_NAMES.map(prayerName => <th key={prayerName}>{prayerName}</th>)}
                </tr>
              </thead>
              <tbody>
                {last7Days.map(({ dateStr, label }) => (
                  <tr key={dateStr}>
                    <td>
                      <strong>{label}</strong>
                      <span>{dateStr.slice(5)}</span>
                    </td>
                    {CANONICAL_PRAYER_NAMES.map(prayerName => {
                      const status = getDisplayedStatus(prayerName, dateStr, prayer);
                      const isLocked = status === 'pending' || status === 'not_tracked';
                      return (
                        <td key={prayerName}>
                          <select
                            value={status}
                            className={`prayer-history-status ${status}`}
                            disabled={isLocked}
                            onChange={event => prayer.correctPrayerOutcome(
                              dateStr,
                              prayerName,
                              event.target.value as PrayerOutcomeStatus,
                            )}
                            aria-label={`${prayerName} outcome on ${label}`}
                            aria-describedby="prayer-history-help"
                            title={status === 'not_tracked'
                              ? 'This prayer deadline passed before classified tracking began.'
                              : status === 'pending'
                                ? 'Pending prayers cannot be corrected before their on-time window closes. Use Prayer Times or Tasks to record a prayer.'
                              : `Correct ${prayerName} outcome on ${label}`}
                          >
                            <option value="pending" disabled>Pending</option>
                            <option value="not_tracked" disabled>Before tracking</option>
                            <option value="unclassified" disabled>Legacy unknown</option>
                            <option value="on_time">On time</option>
                            <option value="late">Late</option>
                            <option value="missed">Missed</option>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PrayerOutcomeBars stats={prayerStats} />
      <div className="prayer-stats-meta">
        Current month · Classified opportunities only · {prayerStats.trackedDays} tracked day{prayerStats.trackedDays === 1 ? '' : 's'} · pending prayers excluded
      </div>
    </section>
  );
}
