import { useMemo, useRef, useState, type CSSProperties } from 'react';
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
import {
  formatPrayerInstantTime,
  getPrayerZonedClockSeconds,
} from '../../services/prayerTimeZone';
import type {
  DailyMomentumActivityDay,
  DailyMomentumPillarDay,
} from '../../services/dailyMomentum';
import { useShell } from "../../store/ShellContext";
import { useSettingsContext } from "../../store/contexts/SettingsContext";
import { useTaskContext } from "../../store/contexts/TaskContext";
import { useDailyMomentumContext } from '../../store/contexts/DailyMomentumContext';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import PrayerStatsCard from './PrayerStatsCard';
import LifeHeroCompanion from './LifeHeroCompanion';
import type {
  DailyPillar,
  PrayerName,
  PrayerOutcomeStatus,
} from '../../types/domain';

type PrayerTemporalState = 'current' | 'next' | 'upcoming' | 'past' | 'not_tracked' | 'pending';

interface PrayerStatusPresentation {
  accessibleLabel: string;
  icon: string;
  label: string;
}

function outcomePresentation(status: PrayerOutcomeStatus): PrayerStatusPresentation {
  switch (status) {
    case 'on_time': return { accessibleLabel: 'Prayed on time', icon: '✓', label: 'Prayed' };
    case 'late': return { accessibleLabel: 'Prayed late', icon: '✓', label: 'Prayed late' };
    case 'missed': return { accessibleLabel: 'Missed, not confirmed', icon: '×', label: 'Missed' };
    default: return { accessibleLabel: 'Needs review', icon: '?', label: 'Review' };
  }
}

function temporalPresentation(state: PrayerTemporalState): PrayerStatusPresentation {
  switch (state) {
    case 'current': return { accessibleLabel: 'Current prayer', icon: '●', label: 'Now' };
    case 'next': return { accessibleLabel: 'Next prayer', icon: '→', label: 'Next' };
    case 'upcoming': return { accessibleLabel: 'Upcoming', icon: '○', label: 'Upcoming' };
    case 'past': return { accessibleLabel: 'Past, not confirmed', icon: '!', label: 'Check' };
    case 'not_tracked': return { accessibleLabel: 'Before tracking', icon: '–', label: 'Untracked' };
    default: return { accessibleLabel: 'Schedule pending', icon: '…', label: 'Pending' };
  }
}

function formatStepProgress(current: number, target: number, metric: string): string {
  return `${Math.min(current, target)} / ${target} ${metric}`;
}

const PRAYER_SYMBOLS: Record<PrayerName, string> = {
  Fajr: '◒',
  Dhuhr: '☀',
  Asr: '◓',
  Maghrib: '◑',
  Isha: '☾',
};

interface PrayerTimelineProgress {
  markerPosition: number;
  markerProgress: number;
  label: string;
}

const DAY_SECONDS = 24 * 60 * 60;
const DISPLAYED_CLOCK_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;

function parseDisplayedClockSeconds(time: string): number | null {
  const match = DISPLAYED_CLOCK_PATTERN.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 * 60 + minutes * 60 + seconds;
}

function getPrayerTimelineProgress(
  prayerEntries: readonly { name: string; time: string }[],
  now: Date,
  timeZone: string,
): PrayerTimelineProgress | null {
  const nowSeconds = getPrayerZonedClockSeconds(now, timeZone);
  if (nowSeconds === null) return null;

  const prayerTimes = CANONICAL_PRAYER_NAMES.map(name => {
    const entry = prayerEntries.find(candidate => candidate.name === name);
    const seconds = entry ? parseDisplayedClockSeconds(entry.time) : null;
    return { name, seconds };
  });
  if (prayerTimes.some(prayer => prayer.seconds === null)) return null;
  for (let index = 1; index < prayerTimes.length; index += 1) {
    if (prayerTimes[index].seconds! <= prayerTimes[index - 1].seconds!) return null;
  }

  let nextIndex = prayerTimes.findIndex(prayer => prayer.seconds! - nowSeconds > -60);
  const nextIsTomorrow = nextIndex < 0;
  if (nextIsTomorrow) nextIndex = 0;
  const previousIndex = nextIsTomorrow ? prayerTimes.length - 1 : nextIndex - 1;
  const previousSeconds = previousIndex >= 0 ? prayerTimes[previousIndex].seconds! : 0;
  const nextSeconds = prayerTimes[nextIndex].seconds! + (nextIsTomorrow ? DAY_SECONDS : 0);
  if (nextSeconds <= previousSeconds) return null;

  const markerProgress = Math.min(
    1,
    Math.max(0, (nowSeconds - previousSeconds) / (nextSeconds - previousSeconds)),
  );
  const markerPosition = nextIsTomorrow
    ? Math.max(0, 100 - markerProgress * 100)
    : Math.min(100, Math.max(0, (previousIndex + markerProgress) / (prayerTimes.length - 1) * 100));
  const minutesUntil = Math.max(0, (nextSeconds - nowSeconds) / 60);
  return {
    markerPosition,
    markerProgress,
    label: `Now · ${formatTimeUntil(minutesUntil)} to ${prayerTimes[nextIndex].name}${nextIsTomorrow ? ' tomorrow' : ''}`,
  };
}

interface MomentumCardProps {
  pillar: DailyPillar;
  day: DailyMomentumPillarDay;
  busy: boolean;
  contextError: string | null;
  actionError: string | null;
  onRecord: (templateId: string, stepId: string) => void;
  onReset: () => void;
}

interface MomentumActivityProps {
  pillar: DailyPillar;
  activity: DailyMomentumActivityDay;
  busy: boolean;
  onRecord: (templateId: string, stepId: string) => void;
}

const ACTIVITY_HELP_TEXT: Record<string, string> = {
  'learn-reading': 'Read pages from a book, article, or other focused material.',
  'learn-course': 'Spend minutes on a structured course or lesson.',
  'move-walk': 'Try an outdoor walk, a treadmill walk, or a few purposeful indoor laps.',
  'move-workout': 'Try squats, wall push-ups, cycling, a gym session, or another planned workout.',
  'move-stretching': 'Try gentle calf, hamstring, chest, or shoulder stretches.',
};

function getActivityHelpText(activity: DailyMomentumActivityDay): string {
  return ACTIVITY_HELP_TEXT[activity.template.id]
    ?? `${activity.template.label} activity. Use the progress control to work toward today's goal.`;
}

function ActivityTitleHelp({ pillar, activity }: Pick<MomentumActivityProps, 'pillar' | 'activity'>) {
  const [visible, setVisible] = useState(false);
  const tooltipId = `nc-${pillar}-${activity.template.id}-help`;

  return (
    <span className={`nc-activity-help${visible ? ' is-visible' : ''}`}>
      <button
        type="button"
        className="nc-activity-help-trigger"
        aria-label={`About ${activity.template.label}`}
        aria-controls={tooltipId}
        aria-expanded={visible}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        <svg
          className="nc-activity-help-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          data-icon="eye"
        >
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.75" />
        </svg>
      </button>
      <span id={tooltipId} className="nc-activity-tooltip" role="tooltip" hidden={!visible}>
        {getActivityHelpText(activity)}
      </span>
    </span>
  );
}

function MomentumActivity({ pillar, activity, busy, onRecord }: MomentumActivityProps) {
  const nextLevel = activity.template.levels[Math.min(activity.achievedLevel, 4)];
  const status = activity.complete
    ? `Level ${activity.achievedLevel} reached`
    : activity.log
      ? 'Level 1 in progress'
      : 'Not started';

  return (
    <article
      className="nc-activity-card"
      data-template-id={activity.template.id}
      aria-labelledby={`nc-${pillar}-${activity.template.id}-title`}
    >
      <div className="nc-activity-heading">
        <div>
          <div className="nc-activity-title">
            <h3 id={`nc-${pillar}-${activity.template.id}-title`}>{activity.template.label}</h3>
            <ActivityTitleHelp pillar={pillar} activity={activity} />
          </div>
          <p>{status}</p>
        </div>
        <span className={`nc-activity-status ${activity.complete ? 'complete' : ''}`}>
          {activity.log ? `L${Math.max(1, activity.achievedLevel)}` : '—'}
        </span>
      </div>

      <div className="nc-progress-controls">
        {nextLevel.steps.map(step => {
          const current = activity.log?.progress[step.id] ?? 0;
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
                onClick={() => onRecord(activity.template.id, step.id)}
              >
                {current >= step.amount ? 'Reached' : `Add 1 ${step.metric}`}
              </button>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function MomentumCard({
  pillar,
  day,
  busy,
  contextError,
  actionError,
  onRecord,
  onReset,
}: MomentumCardProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const accentIcon = pillar === 'learn' ? '◇' : '△';
  const title = pillar === 'learn' ? 'Learn' : 'Move';
  const completedActivities = day.activities.filter(activity => activity.complete).length;
  const hasProgress = day.activities.some(activity => activity.log);

  return (
    <section className={`nc-momentum-card nc-${pillar}`} aria-labelledby={`nc-${pillar}-title`}>
      <div className="nc-momentum-heading">
        <span className="nc-momentum-icon" aria-hidden="true">{accentIcon}</span>
        <div>
          <h2 id={`nc-${pillar}-title`}>{title}</h2>
          <p>{completedActivities} of {day.activities.length} activities at Level 1</p>
        </div>
        <span className={`nc-level-summary ${day.complete ? 'complete' : ''}`}>
          {day.complete ? `${completedActivities} ready` : 'Start any activity'}
        </span>
      </div>

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

      <div className="nc-activity-list" aria-label={`${title} activities`}>
        {day.activities.map(activity => (
          <MomentumActivity
            key={activity.template.id}
            pillar={pillar}
            activity={activity}
            busy={busy}
            onRecord={onRecord}
          />
        ))}
      </div>

      {(contextError || actionError) && (
        <p className="nc-inline-error" role="alert">{actionError || contextError}</p>
      )}

      {hasProgress && (
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
  const shell = useShell();
  const settings = useSettingsContext();
  const tasks = useTaskContext();
  const prayer = usePrayerContext();
  const momentum = useDailyMomentumContext();
  const [busyPillar, setBusyPillar] = useState<DailyPillar | null>(null);
  const [actionErrors, setActionErrors] = useState<Partial<Record<DailyPillar, string>>>({});
  const [showPrayerLog, setShowPrayerLog] = useState(false);
  const pendingPillars = useRef(new Set<DailyPillar>());
  const today = momentum.getDay();
  const motivation = getQuranMotivationForDate(prayer.today);

  const prayerEnabled = settings.settings.prayerEnabled !== false;
  const scheduleRepairNeeded = prayerEnabled && (
    prayer.scheduleStatus === 'unavailable'
    || Boolean(prayer.schedule && !prayer.scheduleTimezoneValid)
  );
  const scheduleLoading = prayerEnabled && !prayer.schedule
    && prayer.scheduleStatus !== 'unavailable';
  const nextPrayer = prayer.schedule && prayer.scheduleTimezoneValid ? prayer.nextPrayer : null;
  const currentPrayer = prayer.schedule && prayer.scheduleTimezoneValid
    ? [...CANONICAL_PRAYER_NAMES].reverse().map(name => ({
        name,
        entry: prayer.schedule!.prayers.find(candidate => candidate.name === name),
        bounds: getPrayerDeadlineBounds(
          prayer.schedule!.prayers,
          prayer.today,
          name,
          prayer.schedule!.timezone,
        ),
      })).find(candidate => (
        candidate.entry
        && candidate.bounds
        && prayer.now >= candidate.bounds.startsAt
        && prayer.now < candidate.bounds.deadlineAt
      )) ?? null
    : null;
  const nextBounds = nextPrayer
    ? getPrayerDeadlineBounds(
        prayer.schedule?.prayers ?? [],
        prayer.today,
        nextPrayer.prayer.name as PrayerName,
        prayer.schedule?.timezone ?? '',
      )
    : null;
  const nextIsTomorrow = Boolean(nextBounds && nextBounds.startsAt.getTime() + 60_000 < prayer.now.getTime());
  const timelineProgress = useMemo(
    () => prayer.schedule && prayer.scheduleTimezoneValid
      ? getPrayerTimelineProgress(prayer.schedule.prayers, prayer.now, prayer.schedule.timezone)
      : null,
    [prayer.now, prayer.schedule, prayer.scheduleTimezoneValid],
  );

  const dueTasks = useMemo(() => {
    const todayString = toLocalDateStr(prayer.now);
    const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
    return tasks.tasks
      .filter(task => task.category === 'task' && !task.completed && task.dueDate && task.dueDate <= todayString)
      .sort((left, right) => (
        (left.dueDate || '').localeCompare(right.dueDate || '')
        || priorityOrder[left.priority] - priorityOrder[right.priority]
      ));
  }, [tasks.tasks, prayer.now]);

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
        busy={!momentum.loaded || busyPillar === pillar}
        contextError={momentum.error}
        actionError={actionErrors[pillar] ?? null}
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
            {settings.settings.prayerCity || 'Prayer location'} · {prayer.schedule?.timezone || prayer.localTimezone}
          </span>
        </div>

        {prayer.schedule?.timezone
          && prayer.schedule.timezone !== settings.appTimeZone.effectiveTimeZone && (
          <div className="nc-time-zone-boundary" role="status">
            Prayer schedule: {prayer.schedule.timezone} · App time: {settings.appTimeZone.effectiveTimeZone}
          </div>
        )}

        {!prayerEnabled ? (
          <div className="nc-prayer-repair" role="status">
            <strong>Keep Prayer at the centre of Night Compass</strong>
            <span>Enable prayer tracking to load the five daily prayers and their canonical outcomes.</span>
            <button type="button" className="nc-primary-action" onClick={() => shell.navigate('settings')}>
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
                  On time until {currentPrayer.bounds.deadlineName} at {formatPrayerInstantTime(
                    currentPrayer.bounds.deadlineAt,
                    prayer.schedule?.timezone ?? '',
                  )}
                </small>
              ) : nextPrayer && nextBounds && !nextIsTomorrow ? (
                <small>
                  On time until {nextBounds.deadlineName} at {formatPrayerInstantTime(
                    nextBounds.deadlineAt,
                    prayer.schedule?.timezone ?? '',
                  )}
                </small>
              ) : null}
            </div>

            <div className="nc-prayer-timeline">
              <div className="nc-prayer-rail" aria-hidden="true">
                <span
                  className="nc-prayer-rail-progress"
                  style={{ width: `${timelineProgress?.markerPosition ?? 0}%` }}
                />
                {timelineProgress && (
                  <span
                    className="nc-now-marker"
                    style={{
                      '--nc-marker-position': `${timelineProgress.markerPosition}%`,
                      '--nc-marker-progress': timelineProgress.markerProgress,
                      '--nc-marker-size': `${10 + timelineProgress.markerProgress * 8}px`,
                      '--nc-marker-glow': `${10 + timelineProgress.markerProgress * 20}px`,
                    } as CSSProperties}
                  />
                )}
              </div>

              <ol className="nc-prayer-sequence" aria-label="Five daily prayers">
                {CANONICAL_PRAYER_NAMES.map(name => {
                  const entry = prayer.schedule?.prayers.find(candidate => candidate.name === name);
                  const bounds = prayer.schedule && prayer.scheduleTimezoneValid
                    ? getPrayerDeadlineBounds(
                        prayer.schedule.prayers,
                        prayer.today,
                        name,
                        prayer.schedule.timezone,
                      )
                    : null;
                  const opportunityTracked = Boolean(
                    prayer.schedule
                    && prayer.scheduleTimezoneValid
                    && isPrayerOpportunityTracked(
                      prayer.tracking,
                      {
                        date: prayer.today,
                        timezone: prayer.schedule.timezone,
                        prayers: prayer.schedule.prayers,
                      },
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
                  const statusPresentation = outcome
                    ? outcomePresentation(outcome)
                    : temporalPresentation(temporalState);
                  const completed = outcome === 'on_time' || outcome === 'late';
                  return (
                    <li className="nc-prayer-node" key={name}>
                      <button
                        type="button"
                        className={`nc-prayer-item temporal-${temporalState} ${outcome ? `outcome-${outcome}` : ''}`}
                        data-prayer-status={outcome ?? temporalState}
                        disabled={completed || isTomorrowOccurrence}
                        aria-label={isTomorrowOccurrence
                          ? `${name} Prayer — Next tomorrow`
                          : outcome === 'unclassified'
                            ? `Classify ${name} Prayer — Legacy record`
                            : completed
                              ? `${name} Prayer — confirmed, ${statusPresentation.accessibleLabel}`
                              : `Complete ${name} Prayer — ${statusPresentation.accessibleLabel}`}
                        aria-current={isCurrent || (!currentPrayer && isNext) ? 'true' : undefined}
                        onClick={() => prayer.requestPrayerCompletion(name, { source: 'dashboard' })}
                      >
                        <span className="nc-prayer-name">{name}</span>
                        <span className="nc-prayer-symbol" data-prayer={name} aria-hidden="true">
                          {PRAYER_SYMBOLS[name]}
                        </span>
                        <span className="nc-prayer-arabic">{entry?.nameArabic ?? PRAYER_NAMES[name]?.arabic}</span>
                        <time>{entry?.time ?? '—'}</time>
                        <span className="nc-prayer-state">
                          <span className="nc-prayer-state-icon" aria-hidden="true">
                            {statusPresentation.icon}
                          </span>
                          <span>{statusPresentation.label}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <p className="nc-prayer-timeline-caption" aria-live="polite">
                <span className="nc-now-caption-key" aria-hidden="true" />
                {timelineProgress?.label ?? (scheduleLoading
                  ? 'Now · prayer timeline loading…'
                  : 'Now · prayer timeline waiting for a schedule')}
              </p>
            </div>

            {scheduleRepairNeeded && (
              <div className="nc-prayer-repair" role="alert">
                <strong>
                  {prayer.scheduleStatus === 'unavailable'
                    ? 'Prayer schedule unavailable'
                    : 'Schedule timezone is invalid'}
                </strong>
                <span>
                  {prayer.scheduleStatus === 'unavailable'
                    ? prayer.scheduleError || 'No matching current-day schedule is available.'
                    : 'A validated IANA timezone is required for prayer clock calculations.'}
                </span>
                {prayer.scheduleStatus === 'unavailable' ? (
                  <button type="button" className="nc-primary-action" onClick={() => void prayer.retrySchedule()}>
                    Retry schedule
                  </button>
                ) : (
                  <button type="button" className="nc-primary-action" onClick={() => shell.navigate('settings')}>
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
          onClick={() => shell.requestAssistantNavigation({
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

      <LifeHeroCompanion localDate={prayer.today} />
    </section>
  );
}
