import type {
  PrayerName,
  PrayerOutcomeStats,
  PrayerOutcomeTally,
} from '../../types/domain';
import { CANONICAL_PRAYER_NAMES } from '../../services/prayerTracking';

export function PrayerOutcomeLegend({ tally }: { tally: PrayerOutcomeTally | PrayerOutcomeStats }) {
  return (
    <div className="prayer-outcome-legend" aria-label="Prayer outcome percentages">
      <span className="on-time"><i aria-hidden="true" />On time <strong>{tally.percentages.onTime}%</strong></span>
      <span className="late"><i aria-hidden="true" />Late <strong>{tally.percentages.late}%</strong></span>
      <span className="missed"><i aria-hidden="true" />Missed <strong>{tally.percentages.missed}%</strong></span>
    </div>
  );
}

export function PrayerOutcomeStack({
  tally,
  label,
}: {
  tally: PrayerOutcomeTally | PrayerOutcomeStats;
  label: string;
}) {
  const percentages = tally.percentages;
  return (
    <div
      className="prayer-outcome-stack"
      role="img"
      aria-label={`${label}: ${percentages.onTime}% on time, ${percentages.late}% late, ${percentages.missed}% missed`}
    >
      <span className="on-time" style={{ width: `${percentages.onTime}%` }} />
      <span className="late" style={{ width: `${percentages.late}%` }} />
      <span className="missed" style={{ width: `${percentages.missed}%` }} />
    </div>
  );
}

export default function PrayerOutcomeBars({
  stats,
  prayerNames = CANONICAL_PRAYER_NAMES,
}: {
  stats: PrayerOutcomeStats;
  prayerNames?: readonly PrayerName[];
}) {
  return (
    <>
      <div className="prayer-outcome-overall">
        <PrayerOutcomeStack tally={stats} label="All prayers" />
        <PrayerOutcomeLegend tally={stats} />
      </div>
      <div className="prayer-outcome-rows">
        {prayerNames.map(prayerName => {
          const tally = stats.perPrayer[prayerName];
          return (
            <div key={prayerName} className="prayer-outcome-row">
              <span className="prayer-outcome-name">{prayerName}</span>
              <PrayerOutcomeStack tally={tally} label={prayerName} />
              <span
                className="prayer-outcome-total"
                aria-label={`${tally.classifiedTotal} classified ${prayerName} opportunities`}
              >
                {tally.classifiedTotal}
              </span>
            </div>
          );
        })}
      </div>
      {stats.unclassified > 0 && (
        <div className="prayer-legacy-count">
          {stats.unclassified} legacy completion{stats.unclassified === 1 ? '' : 's'} kept as unclassified and excluded from percentages.
        </div>
      )}
    </>
  );
}
