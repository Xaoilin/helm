import { useViewPreference } from '../../store/ViewPreferencesContext';
import { useEffect, useState } from 'react';
import { useAuthSession } from '../../store/AuthSessionContext';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import { competitionLeader, competitionPoints, competitionRange, competitionScore, getPrayerCompetition, type CompetitionPeriod } from '../../services/prayerCompetition';
import type { PrayerCompetition, PrayerCompetitionSummary } from '../../types/domain';
import './prayer-competition.css';
import PrayerCompetitionRecord from './PrayerCompetitionRecord';
import { PRAYER_TIMING_POINTS } from '../../config/prayerCompetition';

const SELF = 'Sabah';
const PARTNER = 'Lina';

function Player({ name, summary, leading, showPoints }: {
  name: string; summary: PrayerCompetitionSummary | null; leading: boolean; showPoints: boolean;
}) {
  const completion = summary ? competitionScore(summary) : null;
  const points = summary && showPoints ? competitionPoints(summary) : null;
  const score = points ?? completion;
  return <div className={`prayer-challenge-player ${name === 'Lina' ? 'is-lina' : 'is-sabah'}`}>
    <div className="prayer-challenge-name"><span className="prayer-challenge-avatar" aria-hidden="true">{name[0]}</span>
      <strong>{name}</strong>{leading && <span className="prayer-challenge-crown" aria-label="Leading">♛</span>}</div>
    {points && <div className="prayer-challenge-score-caption">Challenge score</div>}
    <div className="prayer-challenge-score">{score?.percentage == null ? '—' : <>{score.percentage}<span>%</span></>}</div>
    <div className="prayer-challenge-count">{points ? `${points.earned} of ${points.available} points` : completion ? `${completion.completed} of ${completion.total} prayed` : 'Waiting for totals'}</div>
    {points && completion && <div className="prayer-challenge-completion">{completion.percentage ?? '—'}% complete · {completion.completed} of {completion.total} prayed</div>}
    <div className="prayer-challenge-track" role="img"
      aria-label={summary ? `${name}: ${summary.onTime} on time, ${summary.late} late, ${summary.missed} missed` : `${name}: totals unavailable`}>
      {summary && completion && completion.total > 0 && <>
        <span className="challenge-on-time" style={{ width: `${summary.onTime / completion.total * 100}%` }} />
        <span className="challenge-late" style={{ width: `${summary.late / completion.total * 100}%` }} />
        <span className="challenge-missed" style={{ width: `${summary.missed / completion.total * 100}%` }} />
      </>}
    </div>
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
  const leader = data?.partner ? competitionLeader(data.self, data.partner) : null;
  const showPoints = Boolean(data && competitionPoints(data.self) && (!data.partner || competitionPoints(data.partner)));
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
    <p className="prayer-challenge-verdict" aria-live="polite">{loading ? 'Loading your comparison…' : headline}</p>
    <div className="prayer-challenge-players">
      <Player name={SELF} summary={data?.self ?? null} leading={leader === 'self'} showPoints={showPoints} />
      <Player name={PARTNER} summary={data?.partner ?? null} leading={leader === 'partner'} showPoints={showPoints} />
    </div>
    <div className="prayer-challenge-key" aria-label="Chart key"><span><i className="challenge-on-time" />On time</span>
      <span><i className="challenge-late" />Late</span><span><i className="challenge-missed" />Missed</span></div>
    <PrayerCompetitionRecord today={today} period={selectedPeriod} selectedDate={range.from} sessionKey={sessionKey} attempt={attempt} comparison={data} />
    {current?.error && <p className="prayer-challenge-message" role="alert">{current.error}</p>}
    {data?.status === 'not_connected' && <p className="prayer-challenge-message">Your shared challenge isn’t connected yet. Your own totals are shown.</p>}
    {data?.status === 'unavailable' && <p className="prayer-challenge-message" role="status">{PARTNER}’s totals are temporarily unavailable. Try refreshing.</p>}
    <div className="prayer-challenge-footer"><small>{showPoints ? `Challenge score · Prompt ${PRAYER_TIMING_POINTS.prompt} · Within ${PRAYER_TIMING_POINTS.within_window} · Outside ${PRAYER_TIMING_POINTS.outside_window}` : 'Completion rate · On time + late'}<br />Pending and non-obligatory prayers don’t affect the score.</small>
      <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => setAttempt(value => value + 1)}>
        Refresh<span className="sr-only"> comparison</span></button></div>
  </section>;
}
