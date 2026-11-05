import { useEffect, useState } from 'react';
import { competitionRecordWindow, loadCompetitionRecord, type CompetitionRecord } from '../../services/prayerCompetitionRecord';
import type { CompetitionPeriod } from '../../services/prayerCompetition';

export default function PrayerCompetitionRecord({ today, period, selectedDate, sessionKey, attempt }: {
  today: string; period: CompetitionPeriod; selectedDate: string; sessionKey: string; attempt: number;
}) {
  const recordDate = period === 'day' ? `${selectedDate.slice(0, 7)}-01` : today;
  const window = competitionRecordWindow(today, period, recordDate);
  const key = `${sessionKey}:${today}:${period}:${window.label}:${attempt}`;
  const [result, setResult] = useState<{ key: string; record: CompetitionRecord | null } | null>(null);

  useEffect(() => {
    let active = true;
    const { periods } = competitionRecordWindow(today, period, recordDate);
    void loadCompetitionRecord(periods, () => active).then(
      record => { if (active) setResult({ key, record }); },
      () => { if (active) setResult({ key, record: null }); },
    );
    return () => { active = false; };
  // The key changes only for a new record window, account, day or explicit refresh.
  // Minute-by-minute progress updates must not re-fetch completed periods.
  }, [key, today, period, recordDate]);

  const current = result?.key === key ? result : null;
  const record = current?.record;
  const unit = period === 'day' ? 'days' : period === 'week' ? 'weeks' : 'months';
  return <div className="prayer-challenge-record" role="group" aria-label={`${period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : 'Monthly'} record`} aria-busy={!current}>
    <div className="prayer-challenge-record-heading"><strong>{unit[0].toUpperCase() + unit.slice(1)} won</strong><span>{window.label}</span></div>
    <div className="prayer-challenge-record-score" aria-label={record ? `Sabah ${record.self}, Lina ${record.partner}` : 'Record unavailable'}>
      <span className="record-player"><span>Sabah</span><strong>{record?.self ?? '—'}</strong></span>
      <span className="record-divider" aria-hidden="true">–</span>
      <span className="record-player"><span>Lina</span><strong>{record?.partner ?? '—'}</strong></span>
    </div>
    <p className="prayer-challenge-record-note" role="status">{!current ? 'Loading record…'
      : !record ? 'Record unavailable. Refresh to try again.'
        : !window.periods.length ? `No completed ${unit} yet`
          : `${record.ties} tied · ${record.unscored} without scores · Completed ${unit} only`}</p>
  </div>;
}
