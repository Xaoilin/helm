import { useMemo, useRef, useState } from 'react';
import {
  CANONICAL_PRAYER_NAMES,
  calculatePrayerOutcomeStats,
  filterPrayerTrackingRecords,
  getPrayerDeadlineBounds,
  isPrayerOpportunityTracked,
} from '../../services/prayerTracking';
import { formatTimeUntil, PRAYER_NAMES } from '../../services/prayerTimes';
import { toLocalDateStr } from '../../services/financeHelpers';
import { getQuranMotivationForDate } from '../../services/quranMotivation';
import type { DailyMomentumPillarDay } from '../../services/dailyMomentum';
import { useApp } from '../../store/AppContext';
import { useDailyMomentumContext } from '../../store/contexts/DailyMomentumContext';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import PrayerStatsCard from './PrayerStatsCard';
import type {
  DailyActivityTemplate,
  DailyPillar,
  PrayerName,
  PrayerOutcomeStatus,
} from '../../types/domain';

type PrayerTemporalState = 'current' | 'next' | 'upcoming' | 'past' | 'not_tracked' | 'pending';

function outcomeLabel(status: PrayerOutcomeStatus): string {
  switch (status) {
    case 'on_time': return 'On time';
    case 'late': return 'Late';
    case 'missed': return 'Missed';
    default: return 'Legacy — classify';
  }
}

function temporalLabel(state: PrayerTemporalState): string {
  switch (state) {
    case 'current': return 'Current';
    case 'next': return 'Next';
    case 'upcoming': return 'Upcoming';
    case 'past': return 'Past — not recorded';
    case 'not_tracked': return 'Before tracking';
    default: return 'Schedule pending';
  }
}

function formatStepProgress(current: number, target: number, metric: string): string {
  return `${Math.min(current, target)} / ${target} ${metric}`;
}

interface MomentumCardProps {
  pillar: DailyPillar;
  day: DailyMomentumPillarDay;
  templates: DailyActivityTemplate[];
  busy: boolean;
  contextError: string | null;
  actionError: string | null;
  onSelectPath: (templateId: string) => void;
  onRecord: (templateId: string, stepId: string) => void;
  onReset: () => void;
}

function MomentumCard({
  pillar,
  day,
  templates,
  busy,
  contextError,
  actionError,
  onSelectPath,
  onRecord,
  onReset,
}: MomentumCardProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const selected = day.selectedTemplate;
  const nextLevel = selected?.levels[Math.min(day.achievedLevel, 4)] ?? null;
  const accentIcon = pillar === 'learn' ? '◇' : '△';
  const title = pillar === 'learn' ? 'Learn' : 'Move';
  const emptyCopy = pillar === 'learn' ? 'Choose what to learn next' : "Plan today's movement";

  return (
    <section className={`nc-momentum-card nc-${pillar}`} aria-labelledby={`nc-${pillar}-title`}>
      <div className="nc-momentum-heading">
        <span className="nc-momentum-icon" aria-hidden="true">{accentIcon}</span>
        <div>
          <h2 id={`nc-${pillar}-title`}>{title}</h2>
          <p>{selected?.label ?? emptyCopy}</p>
        </div>
        <span className={`nc-level-summary ${day.complete ? 'complete' : ''}`}>
          {day.complete ? `Level ${day.achievedLevel}` : 'Level 1 required'}
        </span>
      </div>

      <label className="nc-path-label">
        <span>Today's path</span>
        <select
          value={selected?.id ?? ''}
          disabled={busy || day.pathLocked}
          onChange={event => onSelectPath(event.target.value)}
          aria-label={`Choose ${title} path`}
        >
          <option value="">Choose a path</option>
          {templates.map(template => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
      </label>

      <div className="nc-level-track" aria-label={`${title} daily levels`}>
        {[1, 2, 3, 4, 5].map(level => (
          <span
            key={level}
            className={level <= day.achievedLevel ? 'achieved' : level === 1 ? 'required' : ''}
          >
            L{level}<small>{level === 1 ? 'required' : 'optional'}</small>
          </span>
        ))}
      </div>

      {selected && nextLevel ? (
        <div className="nc-progress-controls">
          {nextLevel.steps.map(step => {
            const current = day.log?.progress[step.id] ?? 0;
            return (
              <div className="nc-progress-row" key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{formatStepProgress(current, step.amount, step.metric)}</span>
                </div>
                <button
                  type="button"
                  className="nc-compact-action"
                  disabled={busy || current >= step.amount}
                  onClick={() => onRecord(selected.id, step.id)}
                >
                  {current >= step.amount ? 'Reached' : `Add 1 ${step.metric}`}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="nc-momentum-empty">Select one grounded path to begin Level 1.</p>
      )}

      {(contextError || actionError) && (
        <p className="nc-inline-error" role="alert">{actionError || contextError}</p>
      )}

      {day.log && (
        <div className="nc-reset-row">
          {confirmingReset ? (
            <>
              <span>Reset today's {title.toLowerCase()} progress?</span>
              <button
                type="button"
                className="nc-text-action danger"
                disabled={busy}
                onClick={() => {
                  onReset();
                  setConfirmingReset(false);
                }}
              >
                Confirm reset
              </button>
              <button type="button" className="nc-text-action" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="nc-text-action" onClick={() => setConfirmingReset(true)}>
              Reset today's progress
            </button>
          )}
        </div>
      )}
      <span className="nc-saving-status" aria-live="polite">{busy ? 'Saving…' : ''}</span>
    </section>
  );
}

export default function NightCompassDashboard() {
  const app = useApp();
  const prayer = usePrayerContext();
  const momentum = useDailyMomentumContext();
  const [busyPillar, setBusyPillar] = useState<DailyPillar | null>(null);
  const [actionErrors, setActionErrors] = useState<Partial<Record<DailyPillar, string>>>({});
  const [showPrayerLog, setShowPrayerLog] = useState(false);
  const pendingPillars = useRef(new Set<DailyPillar>());
  const today = momentum.getDay();
  const motivation = getQuranMotivationForDate(prayer.today);

  const prayerEnabled = app.settings.prayerEnabled !== false;
  const scheduleRepairNeeded = prayerEnabled && (
    prayer.scheduleStatus === 'unavailable'
    || Boolean(prayer.schedule && !prayer.timezoneMatches)
  );
  const scheduleLoading = prayerEnabled && !prayer.schedule
    && prayer.scheduleStatus !== 'unavailable';
  const nextPrayer = prayer.schedule && prayer.timezoneMatches ? prayer.nextPrayer : null;
  const currentPrayer = prayer.schedule && prayer.timezoneMatches
    ? [...CANONICAL_PRAYER_NAMES].reverse().map(name => ({
        name,
        entry: prayer.schedule!.prayers.find(candidate => candidate.name === name),
        bounds: getPrayerDeadlineBounds(prayer.schedule!.prayers, prayer.today, name),
      })).find(candidate => (
        candidate.entry
        && candidate.bounds
        && prayer.now >= candidate.bounds.startsAt
        && prayer.now < candidate.bounds.deadlineAt
      )) ?? null
    : null;
  const nextBounds = nextPrayer
    ? getPrayerDeadlineBounds(prayer.schedule?.prayers ?? [], prayer.today, nextPrayer.prayer.name as PrayerName)
    : null;
  const nextIsTomorrow = Boolean(nextBounds && nextBounds.startsAt.getTime() + 60_000 < prayer.now.getTime());

  const dueTasks = useMemo(() => {
    const todayString = toLocalDateStr(prayer.now);
    const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
    return app.tasks
      .filter(task => task.category === 'task' && !task.completed && task.dueDate && task.dueDate <= todayString)
      .sort((left, right) => (
        (left.dueDate || '').localeCompare(right.dueDate || '')
        || priorityOrder[left.priority] - priorityOrder[right.priority]
      ));
  }, [app.tasks, prayer.now]);

  const prayerStats = useMemo(() => {
    const currentMonth = prayer.today.slice(0, 7);
    return calculatePrayerOutcomeStats(
      filterPrayerTrackingRecords(
        prayer.tracking,
        recordDate => recordDate.startsWith(currentMonth),
      ),
      prayer.scheduleDays.filter(day => day.date.startsWith(currentMonth)),
      prayer.now,
    );
  }, [prayer.now, prayer.scheduleDays, prayer.today, prayer.tracking]);

  const runMomentumAction = async (pillar: DailyPillar, action: () => Promise<unknown>) => {
    if (pendingPillars.current.has(pillar)) return;
    pendingPillars.current.add(pillar);
    setBusyPillar(pillar);
    setActionErrors(current => ({ ...current, [pillar]: undefined }));
    try {
      await action();
    } catch (error) {
      setActionErrors(current => ({
        ...current,
        [pillar]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      pendingPillars.current.delete(pillar);
      setBusyPillar(current => current === pillar ? null : current);
    }
  };

  const renderMomentumCard = (pillar: DailyPillar) => {
    const pillarDay = today[pillar];
    return (
      <MomentumCard
        key={pillar}
        pillar={pillar}
        day={pillarDay}
        templates={momentum.state.templates.filter(template => template.pillar === pillar)}
        busy={!momentum.loaded || busyPillar === pillar}
        contextError={momentum.error}
        actionError={actionErrors[pillar] ?? null}
        onSelectPath={templateId => {
          if (!templateId) return;
          void runMomentumAction(pillar, () => momentum.selectPath(pillar, templateId));
        }}
        onRecord={(templateId, stepId) => {
          void runMomentumAction(pillar, () => momentum.recordProgress(pillar, templateId, stepId, 1));
        }}
        onReset={() => {
          void runMomentumAction(pillar, () => momentum.resetProgress(pillar, true));
        }}
      />
    );
  };

  return (
    <section className="nc-dashboard" aria-label="Night Compass daily dashboard">
      <section className="nc-prayer-card" aria-labelledby="nc-prayer-title">
        <div className="nc-celestial" aria-hidden="true">
          <span className="nc-celestial-arc" />
          <span className="nc-orientation-marker" />
          <i /><i /><i /><i /><i />
        </div>

        <div className="nc-prayer-heading">
          <div>
            <span className="nc-eyebrow">Prayer · Tier one</span>
            <h2 id="nc-prayer-title">Prayer</h2>
          </div>
          <span className="nc-prayer-location">
            {app.settings.prayerCity || 'Prayer location'} · {prayer.desktopTimezone}
          </span>
        </div>

        {!prayerEnabled ? (
          <div className="nc-prayer-repair" role="status">
            <strong>Keep Prayer at the centre of Night Compass</strong>
            <span>Enable prayer tracking to load the five daily prayers and their canonical outcomes.</span>
            <button type="button" className="nc-primary-action" onClick={() => app.navigate('settings')}>
              Open prayer settings
            </button>
          </div>
        ) : (
          <>
            <div className="nc-next-prayer" aria-live="polite">
              <span className="nc-eyebrow">
                {scheduleRepairNeeded
                  ? 'Prayer schedule needs attention'
                  : currentPrayer
                    ? 'Current prayer'
                    : nextIsTomorrow
                      ? "Tomorrow's next prayer"
                      : 'Next prayer'}
              </span>
              <strong>{currentPrayer?.name ?? nextPrayer?.prayer.name ?? 'Prayer schedule'}</strong>
              <time>{currentPrayer?.entry?.time ?? nextPrayer?.prayer.time ?? (scheduleLoading ? 'Loading' : '—')}</time>
              {currentPrayer?.bounds ? (
                <span className="nc-next-badge">
                  Current · {formatTimeUntil(Math.max(0, (currentPrayer.bounds.deadlineAt.getTime() - prayer.now.getTime()) / 60_000))} left
                </span>
              ) : nextPrayer ? (
                <span className="nc-next-badge">Next · {formatTimeUntil(nextPrayer.minutesUntil)}</span>
              ) : null}
              {currentPrayer?.bounds ? (
                <small>
                  On time until {currentPrayer.bounds.deadlineName} at {currentPrayer.bounds.deadlineAt.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              ) : nextPrayer && nextBounds && !nextIsTomorrow ? (
                <small>
                  On time until {nextBounds.deadlineName} at {nextBounds.deadlineAt.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              ) : null}
            </div>

            <div className="nc-prayer-sequence" aria-label="Five daily prayers">
              {CANONICAL_PRAYER_NAMES.map(name => {
                const entry = prayer.schedule?.prayers.find(candidate => candidate.name === name);
                const bounds = prayer.schedule && prayer.timezoneMatches
                  ? getPrayerDeadlineBounds(prayer.schedule.prayers, prayer.today, name)
                  : null;
                const opportunityTracked = Boolean(
                  prayer.schedule
                  && prayer.timezoneMatches
                  && isPrayerOpportunityTracked(
                    prayer.tracking,
                    { date: prayer.today, prayers: prayer.schedule.prayers },
                    name,
                    prayer.now,
                  ),
                );
                const isNext = Boolean(
                  nextPrayer?.prayer.name === name
                  && bounds
                  && (nextIsTomorrow || bounds.startsAt.getTime() + 60_000 >= prayer.now.getTime()),
                );
                const isCurrent = currentPrayer?.name === name;
                const isTomorrowOccurrence = isNext && nextIsTomorrow;
                const outcome = isTomorrowOccurrence
                  ? undefined
                  : prayer.getOutcome(prayer.today, name)?.status;
                const temporalState: PrayerTemporalState = isCurrent
                  ? 'current'
                  : isNext
                  ? 'next'
                  : !bounds
                    ? 'pending'
                    : prayer.now < bounds.startsAt
                      ? 'upcoming'
                      : opportunityTracked
                        ? 'past'
                        : 'not_tracked';
                const stateLabel = outcome ? outcomeLabel(outcome) : temporalLabel(temporalState);
                const completed = outcome === 'on_time' || outcome === 'late';
                return (
                  <button
                    type="button"
                    key={name}
                    className={`nc-prayer-item temporal-${temporalState} ${outcome ? `outcome-${outcome}` : ''}`}
                    disabled={completed || isTomorrowOccurrence}
                    aria-label={isTomorrowOccurrence
                      ? `${name} Prayer — Next tomorrow`
                      : outcome === 'unclassified'
                        ? `Classify ${name} Prayer — Legacy record`
                        : completed
                          ? `${name} Prayer — completed, ${stateLabel}`
                          : `Complete ${name} Prayer`}
                    aria-current={isCurrent || (!currentPrayer && isNext) ? 'true' : undefined}
                    onClick={() => prayer.requestPrayerCompletion(name, { source: 'dashboard' })}
                  >
                    <span className="nc-prayer-name">{name}</span>
                    <span className="nc-prayer-arabic">{entry?.nameArabic ?? PRAYER_NAMES[name]?.arabic}</span>
                    <time>{entry?.time ?? '—'}</time>
                    <span className="nc-prayer-state">{stateLabel}</span>
                  </button>
                );
              })}
            </div>

            {scheduleRepairNeeded && (
              <div className="nc-prayer-repair" role="alert">
                <strong>
                  {prayer.scheduleStatus === 'unavailable'
                    ? 'Prayer schedule unavailable'
                    : 'Schedule timezone does not match this desktop'}
                </strong>
                <span>
                  {prayer.scheduleStatus === 'unavailable'
                    ? prayer.scheduleError || 'No matching current-day schedule is available.'
                    : `Schedule: ${prayer.schedule?.timezone || 'unknown'} · Desktop: ${prayer.desktopTimezone}`}
                </span>
                {prayer.scheduleStatus === 'unavailable' ? (
                  <button type="button" className="nc-primary-action" onClick={() => void prayer.retrySchedule()}>
                    Retry schedule
                  </button>
                ) : (
                  <button type="button" className="nc-primary-action" onClick={() => app.navigate('settings')}>
                    Repair prayer settings
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="nc-quran-motivation" aria-label="Quran-first encouragement">
        <div className="nc-quran-motivation-heading">
          <span className="nc-eyebrow">Quran-first encouragement</span>
          <h2 id="nc-quran-motivation-title">{motivation.title}</h2>
        </div>
        <blockquote lang="ar" dir="rtl">{motivation.arabic}</blockquote>
        <p><strong>Reviewed meaning (paraphrase):</strong> {motivation.meaningSummary}</p>
        <a href={motivation.sourceUrl} target="_blank" rel="noreferrer">
          Quran {motivation.reference} · Source
        </a>
      </aside>

      <div className="nc-momentum-grid">
        {renderMomentumCard('learn')}
        {renderMomentumCard('move')}
      </div>

      <section className="nc-tasks-card" aria-labelledby="nc-tasks-title">
        <div className="nc-tasks-copy">
          <span className="nc-task-icon" aria-hidden="true">☷</span>
          <div>
            <h2 id="nc-tasks-title">Tasks</h2>
            <p>{dueTasks.length === 0 ? 'No tasks due today' : `${dueTasks.length} due or overdue`}</p>
          </div>
          {dueTasks.length > 0 && (
            <span className="nc-task-preview" title={dueTasks.map(task => task.title).join(' · ')}>
              {dueTasks.slice(0, 2).map(task => task.title).join(' · ')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="nc-secondary-action"
          onClick={() => app.requestAssistantNavigation({
            surface: 'tasks',
            surfaceState: { tasks: { tab: 'all', resetFilters: true } },
          })}
        >
          Open tasks
        </button>
      </section>

      <PrayerStatsCard
        prayerStats={prayerStats}
        showPrayerLog={showPrayerLog}
        onTogglePrayerLog={() => setShowPrayerLog(current => !current)}
      />
    </section>
  );
}
