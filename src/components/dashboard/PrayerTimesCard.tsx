import {
  formatTimeUntil,
  PRAYER_SOURCES,
  type PrayerTimesData,
  type PrayerTime as PrayerTimeType,
} from '../../services/prayerTimes';
import {
  getPrayerDeadlineBounds,
  getPrayerDeadlineName,
  isPrayerOpportunityTracked,
} from '../../services/prayerTracking';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import type { PrayerName, PrayerOutcomeStatus } from '../../types/domain';
import { formatPrayerInstantTime } from '../../services/prayerTimeZone';

interface PrayerTimesCardProps {
  prayerData: PrayerTimesData;
  nextPrayer: { prayer: PrayerTimeType; minutesUntil: number } | null;
  city: string;
}

type DisplayedPrayerStatus = PrayerOutcomeStatus | 'pending' | 'not_tracked';

function outcomeLabel(status: DisplayedPrayerStatus): string {
  switch (status) {
    case 'on_time': return 'On time';
    case 'late': return 'Late';
    case 'missed': return 'Missed';
    case 'unclassified': return 'Legacy — classify';
    case 'not_tracked': return 'Before tracking';
    default: return 'Pending';
  }
}

export default function PrayerTimesCard({ prayerData, nextPrayer, city }: PrayerTimesCardProps) {
  const prayer = usePrayerContext();

  return (
    <section className="dash-card prayer-times-card">
      <div className="dash-card-header">
        <span>🕌 Prayer Times — {city}</span>
        <span className="prayer-hijri-date">{prayerData.hijriDate}</span>
      </div>
      <div className="prayer-grid">
        {prayerData.prayers.map(entry => {
          const isNext = nextPrayer?.prayer.name === entry.name;
          if (entry.type === 'event') {
            return (
              <div key={entry.name} className="prayer-row event">
                <div className="prayer-name">
                  {entry.name}
                  <span className="prayer-arabic">{entry.nameArabic}</span>
                </div>
                <div className="prayer-time">{entry.time}</div>
              </div>
            );
          }

          const prayerName = entry.name as PrayerName;
          const bounds = prayer.scheduleTimezoneValid
            ? getPrayerDeadlineBounds(
                prayerData.prayers,
                prayer.today,
                prayerName,
                prayerData.timezone,
              )
            : null;
          const deadlineName = getPrayerDeadlineName(prayerName);
          const deadlineTime = prayerData.prayers.find(candidate => candidate.name === deadlineName)?.time;
          const record = prayer.getOutcome(prayer.today, prayerName);
          const opportunityIsTracked = prayer.scheduleTimezoneValid && isPrayerOpportunityTracked(
            prayer.tracking,
            { date: prayer.today, timezone: prayerData.timezone, prayers: prayerData.prayers },
            prayerName,
            prayer.now,
          );
          const status: DisplayedPrayerStatus = record?.status
            || (!prayer.scheduleTimezoneValid
              ? 'pending'
              : !opportunityIsTracked
              ? 'not_tracked'
              : bounds && prayer.now >= bounds.deadlineAt
                ? 'missed'
                : 'pending');
          const isCompleted = status === 'on_time' || status === 'late' || status === 'unclassified';

          return (
            <div
              key={entry.name}
              className={`prayer-row wajib ${isNext ? 'next' : ''} outcome-${status}`}
            >
              <div className="prayer-name">
                {entry.name}
                <span className="prayer-arabic">{entry.nameArabic}</span>
              </div>
              <div className="prayer-window-copy">
                <strong>Starts {entry.time}</strong>
                {(bounds || deadlineTime) && (
                  <span>
                    On time until {deadlineName} {bounds
                      ? formatPrayerInstantTime(bounds.deadlineAt, prayerData.timezone)
                      : deadlineTime}
                  </span>
                )}
                {isNext && nextPrayer && (
                  <small>Starts in {formatTimeUntil(nextPrayer.minutesUntil)}</small>
                )}
              </div>
              <span className={`prayer-outcome-badge ${status}`}>{outcomeLabel(status)}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm prayer-mark-button"
                disabled={isCompleted}
                onClick={() => prayer.requestPrayerCompletion(prayerName, { source: 'dashboard' })}
              >
                {isCompleted ? 'Recorded' : 'Mark prayed'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="prayer-schedule-meta">
        <span>{prayerData.source === 'cache' ? 'Same-day cached schedule' : 'Live schedule'} · {prayerData.timezone || 'Timezone unavailable'}</span>
        <span>{prayerData.method}</span>
      </div>
      <div className="prayer-sources">
        <span>Sources:</span>
        <a href={PRAYER_SOURCES.api.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.api.name}</a>
        <span>|</span>
        <a href={PRAYER_SOURCES.method.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.method.name}</a>
        <span>|</span>
        <a href={PRAYER_SOURCES.verification.url} target="_blank" rel="noopener noreferrer">Verify times</a>
      </div>
    </section>
  );
}
