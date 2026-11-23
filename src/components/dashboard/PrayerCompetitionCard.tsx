import { useViewPreference } from '../../store/ViewPreferencesContext';
import { useEffect, useState } from 'react';
import { useAuthSession } from '../../store/AuthSessionContext';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import { competitionIsPaused, competitionLeader, competitionPoints, competitionRange, competitionScore, getPrayerCompetition, type CompetitionPeriod } from '../../services/prayerCompetition';
import type { PrayerCompetition, PrayerCompetitionProgress, PrayerCompetitionSummary } from '../../types/domain';
import './prayer-competition.css';
import PrayerCompetitionRecord from './PrayerCompetitionRecord';
import PrayerExemptionGift from './PrayerExemptionGift';
import { PRAYER_TIMING_POINTS } from '../../config/prayerCompetition';

const SELF = 'Sabah';
const PARTNER = 'Lina';

function Player({ name, summary, leading, showPoints, pausedProgress }: {
  name: string;
  summary?: PrayerCompetitionSummary | null;
  leading?: boolean;
  showPoints?: boolean;
  pausedProgress?: PrayerCompetitionProgress | null;
}) {
  const paused = pausedProgress !== undefined;
  const progress = paused ? pausedProgress : summary;
  const completion = progress ? competitionScore(progress) : null;
  const points = summary && showPoints ? competitionPoints(summary) : null;
  const pending = progress?.pending ?? 0;
  const completionPercentage = completion?.percentage;

  const pausedCount = completion ? 'Prayed' : 'Prayer totals unavailable';
  const count = paused ? pausedCount : points ? `${points.available} points available`
    : completion ? `${completion.completed} of ${completion.total} prayed` : 'Waiting for totals';
  const fraction = completion ? <>{completion.completed}<span>/{completion.total}</span></> : '—';
  return <div className={`prayer-challenge-player ${name === 'Lina' ? 'is-lina' : 'is-sabah'}`}>
    <div className="prayer-challenge-name"><span className="prayer-challenge-avatar" aria-hidden="true">{name[0]}</span>
      <strong>{name}</strong>{leading && <span className="prayer-challenge-crown" aria-label="Leading">♛</span>}</div>
    <div className={`prayer-challenge-score${paused ? ' is-prayer-progress' : ''}`}>{paused ? fraction : points
      ? points.available > 0 ? <>{points.earned}<span className="prayer-challenge-point-unit"> pts</span></> : '—'
      : completionPercentage == null ? '—' : <>{completionPercentage}<span>%</span></>}</div>
    <div className="prayer-challenge-count">{count}</div>
    {points && completion && <div className="prayer-challenge-completion">{completion.completed} of {completion.total} prayed</div>}
    {(!paused || progress) && <div className="prayer-challenge-track" role="img"
      aria-label={progress ? `${name}: ${progress.onTime} on time, ${progress.late} late, ${progress.missed} missed${pending ? `, ${pending} pending` : ''}` : `${name}: totals unavailable`}>
      {progress && completion && completion.total > 0 && <>
        <span className="challenge-on-time" style={{ width: `${progress.onTime / completion.total * 100}%` }} />
        <span className="challenge-late" style={{ width: `${progress.late / completion.total * 100}%` }} />
        <span className="challenge-missed" style={{ width: `${progress.missed / completion.total * 100}%` }} />
        {pending > 0 && <span className="challenge-pending" style={{ width: `${pending / completion.total * 100}%` }} />}
      </>}
    </div>}
  </div>;
}

export default function PrayerCompetitionCard() {
  const { today, now, tracking, serviceSync } = usePrayerContext();
  const { sessionKey } = useAuthSession();
  const [selectedPeriod, setPeriod] = useViewPreference<CompetitionPeriod>('prayerChallenge.period', 'month');
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: PrayerCompetition; error?: string } | null>(null);
  const range = competitionRange(today, selectedPeriod, offset);
  const minute = Math.floor(now.getTime() / 60_000);
  const key = `${sessionKey}:${range.from}:${range.to}`;

  useEffect(() => {
    let active = true;
    if (serviceSync.status === 'syncing' || serviceSync.status === 'loading') return () => { active = false; };
    void getPrayerCompetition(range.from, range.to).then(data => {
      if (active) setResult({ key, data });
    }, (error: unknown) => {
      if (active) setResult(previous => ({ key, data: previous?.key === key ? previous.data : undefined, error: error instanceof Error ? error.message : 'Prayer comparison could not load.' }));
    });
    return () => { active = false; };
  }, [key, range.from, range.to, minute, attempt, tracking, serviceSync.status]);

  const current = result?.key === key ? result : null;
  const data = current?.data;
  const loading = current === null;
  const paused = data ? competitionIsPaused(data) : false;
  const excludedDays = data?.periodDaysExcluded ?? 0;
  const leader = data?.partner && !paused ? competitionLeader(data.self, data.partner) : null;
  const showPoints = Boolean(data && competitionPoints(data.self) && (!data.partner || competitionPoints(data.partner)));
  const pausedProgress = data?.pausedPrayerProgress ?? null;
  const hasPending = Boolean(paused ? pausedProgress?.pending : data?.self.pending || data?.partner?.pending);
  const pointsPending = Boolean(data?.partner && Boolean(competitionPoints(data.self)) !== Boolean(competitionPoints(data.partner)));
  const headline = !data?.partner ? 'A little friendly competition'
    : pointsPending ? 'Point totals are updating…'
    : leader === 'tie' ? 'You’re level — keep it going!'
      : leader ? `${leader === 'self' ? SELF : PARTNER} is leading` : 'A fresh start, together';

  return <section className="dash-card prayer-challenge" aria-labelledby="prayer-challenge-title" aria-busy={loading}>
    <div className="prayer-challenge-heading"><div><p className="prayer-challenge-eyebrow">BETTER TOGETHER</p>
      <h2 id="prayer-challenge-title">Prayer challenge <span aria-hidden="true">✦</span></h2></div>
      <div className="prayer-challenge-periods" role="group" aria-label="Comparison period">
        {(['day', 'week', 'month'] as const).map(period => <button key={period} type="button"
          aria-pressed={selectedPeriod === period} onClick={() => { setPeriod(period); setOffset(0); }}>
          {period[0].toUpperCase() + period.slice(1)}</button>)}
      </div>
    </div>
    <div className="prayer-challenge-dates"><button type="button" aria-label={`Previous ${selectedPeriod}`}
      onClick={() => setOffset(current => current - 1)}>‹</button>
      <strong>{range.label}</strong><button type="button" aria-label={`Next ${selectedPeriod}`} disabled={offset >= 0}
        onClick={() => setOffset(current => current + 1)}>›</button></div>
    <p className={`prayer-challenge-verdict${paused ? ' is-paused' : ''}`} aria-live="polite">
      {paused ? 'Not counted because of Lina’s period' : loading ? 'Loading your comparison…' : headline}
      {!paused && excludedDays > 0 && <span className="prayer-challenge-excluded">
        {excludedDays} {excludedDays === 1 ? 'day' : 'days'} not counted because of Lina’s period
      </span>}
    </p>
    <div className={`prayer-challenge-players${paused ? ' is-paused' : ''}`}>
      {paused ? <>
        <Player name={SELF} pausedProgress={pausedProgress} />
        <div className="prayer-challenge-player is-lina is-prayer-exempt" lang="ar" dir="rtl">
          <div className="prayer-challenge-name">
            <span className="prayer-challenge-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9c-6-9-12 1-4 4-7 6 3 12 5 4 7 5 12-5 4-7 3-8-8-10-5-1Z" />
                <circle cx="12" cy="12" r="2.2" />
              </svg>
            </span>
            <strong>لينه</strong>
          </div>
          <PrayerExemptionGift />
        </div>
      </> : <>
        <Player name={SELF} summary={data?.self ?? null} leading={leader === 'self'} showPoints={showPoints} />
        <Player name={PARTNER} summary={data?.partner ?? null} leading={leader === 'partner'} showPoints={showPoints} />
      </>}
    </div>
    {(!paused || pausedProgress) && <div className="prayer-challenge-key" aria-label="Chart key">
      <span><i className="challenge-on-time" />On time</span><span><i className="challenge-late" />Late</span>
      <span><i className="challenge-missed" />Missed</span>{hasPending && <span><i className="challenge-pending" />Pending</span>}
    </div>}
    <PrayerCompetitionRecord today={today} period={selectedPeriod} selectedDate={range.from} sessionKey={sessionKey} attempt={attempt} comparison={data} />
    {current?.error && <p className="prayer-challenge-message" role="alert">{current.error}</p>}
    {data?.status === 'not_connected' && <p className="prayer-challenge-message">Your shared challenge isn’t connected yet. Your own totals are shown.</p>}
    {!paused && data?.status === 'unavailable' && <p className="prayer-challenge-message" role="status">{PARTNER}’s totals are temporarily unavailable. Try refreshing.</p>}
    <div className={`prayer-challenge-footer${paused ? ' is-paused' : ''}`}>{!paused && <small>{showPoints ? `Points · Prompt ${PRAYER_TIMING_POINTS.prompt} · Within ${PRAYER_TIMING_POINTS.within_window} · Outside ${PRAYER_TIMING_POINTS.outside_window}` : 'Completion rate · On time + late'}<br />{PRAYER_TIMING_POINTS.prompt} points only within 15 minutes of the adhan.<br />Prayer windows count as soon as they open.</small>}
      <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => setAttempt(value => value + 1)}>
        Refresh<span className="sr-only"> comparison</span></button></div>
  </section>;
}
