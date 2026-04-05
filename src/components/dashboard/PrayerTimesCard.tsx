import {
  formatTimeUntil,
  PRAYER_SOURCES,
  type PrayerTimesData,
  type PrayerTime as PrayerTimeType,
} from '../../services/prayerTimes';

interface PrayerTimesCardProps {
  prayerData: PrayerTimesData;
  nextPrayer: { prayer: PrayerTimeType; minutesUntil: number } | null;
  city: string;
  /** Forces re-render for countdown updates. */
  tick: number;
}

export default function PrayerTimesCard({ prayerData, nextPrayer, city, tick: _tick }: PrayerTimesCardProps) {
  return (
    <div className="dash-card" style={{ marginBottom: 16 }}>
      <div className="dash-card-header">
        <span>{'\u{1F54C}'} Prayer Times &mdash; {city}</span>
        <span style={{ fontSize: 11, color: '#6b6f85' }}>{prayerData.hijriDate}</span>
      </div>
      <div className="prayer-grid">
        {prayerData.prayers.map(p => {
          const isNext = nextPrayer?.prayer.name === p.name;
          const isPrayer = p.type === 'prayer';
          return (
            <div key={p.name} className={`prayer-row ${isNext ? 'next' : ''} ${isPrayer ? 'wajib' : 'event'}`}>
              <div className="prayer-name">
                {p.name}
                <span className="prayer-arabic">{p.nameArabic}</span>
              </div>
              <div className="prayer-time">{p.time}</div>
              {isNext && (
                <div className="prayer-countdown">in {formatTimeUntil(nextPrayer!.minutesUntil)}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="prayer-sources">
        <span style={{ fontSize: 10, color: '#4a4e62' }}>Sources:</span>
        <a href={PRAYER_SOURCES.api.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.api.name}</a>
        <span style={{ color: '#2a2d42' }}>|</span>
        <a href={PRAYER_SOURCES.method.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.method.name}</a>
        <span style={{ color: '#2a2d42' }}>|</span>
        <a href={PRAYER_SOURCES.verification.url} target="_blank" rel="noopener noreferrer">Verify times</a>
      </div>
    </div>
  );
}
