import type {
  CalendarEvent,
  CalendarSource,
  DashboardFocusStats,
  FocusCandidate,
  FocusDurationSource,
  FocusFeedback,
  FocusRecommendation,
  GamificationProfile,
  Project,
  Settings,
  Task,
} from '../types/domain';
import { LIMITS, TIMING } from '../config/constants';
import {
  getActivePrayerWindow,
  getPrayerTaskName,
  getRemainingPrayerNames,
  isPrayerTask,
} from './prayerTasks';
import { getHostedAssistantModelSetting } from './assistantModels';
import {
  chatWithHostedAssistantDetailed,
  testHostedAssistantConnection,
} from './hostedAssistantApi';
import type { PrayerTime } from './prayerTimes';

const TASK_PRIORITY_SCORE = {
  high: 30,
  medium: 18,
  low: 8,
} as const;

const ACTIONABLE_BLOCKED_PATTERN = /\b(next|reply|email|call|draft|review|ship|schedule|prepare|follow up)\b/i;
const PREP_PRESSURE_PATTERN = /\b(call|meeting|interview|review|sync|standup|demo|presentation|doctor|appointment|travel)\b/i;

interface ScoreSignal {
  label: string;
  value: number;
}

interface CandidateTimeEstimate {
  rankingMinutes: number;
  estimatedMinutes?: number;
  estimatedMinutesSource?: FocusDurationSource;
}

interface FocusCandidateDraft extends FocusCandidate {
  scoreSignals: ScoreSignal[];
}

export interface DashboardFocusEngineInput {
  tasks: Task[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  projects: Project[];
  gamification: GamificationProfile;
  feedback: FocusFeedback[];
  now: Date;
  prayerTimes?: PrayerTime[];
}

export interface DashboardFocusBuildResult {
  candidates: FocusCandidate[];
  stats: DashboardFocusStats;
  inputHash: string;
  recommendedRefreshMinutes: number;
}

export interface DashboardFocusSelectionResult {
  recommendation: FocusRecommendation;
  queueCandidateIds: string[];
  source: 'local' | 'openai';
  status: 'ready' | 'fallback';
  model?: string;
  rawModelResponse?: string;
  errorMessage?: string;
  fallbackReason?: string;
  latencyMs?: number;
}

interface DashboardFocusResponseSchema {
  selectedCandidateId: string;
  why: string;
  confidence: number;
  reasoningTags: string[];
  estimatedMinutes: number | null;
  alternativeIds: string[];
  refreshAfterMinutes: number;
}

interface DashboardFocusHostedReviewRecord {
  reviewDate: string;
  attemptedAt: string;
  source: 'local' | 'openai';
  fallbackReason?: string;
}

const DASHBOARD_FOCUS_CACHE_KEY = 'helm:dashboardFocusCache:v1';
const DASHBOARD_FOCUS_HOSTED_REVIEW_KEY = 'helm:dashboardFocusHostedReview:v1';

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fromLocalDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function diffMinutes(futureIso: string, now: Date): number {
  return Math.round((new Date(futureIso).getTime() - now.getTime()) / 60000);
}

function getEventPrepPressure(event: CalendarEvent): boolean {
  return Boolean(event.location?.trim())
    || Boolean(event.description?.trim())
    || PREP_PRESSURE_PATTERN.test(event.title);
}

function hasActionableNextStep(task: Task): boolean {
  if (!task.blockedReason) return true;
  return Boolean(task.description.trim())
    || ACTIONABLE_BLOCKED_PATTERN.test(task.blockedReason)
    || ACTIONABLE_BLOCKED_PATTERN.test(task.description);
}

function estimateTaskMinutes(task: Task): number {
  if (task.category === 'prayer') return 10;
  if (task.category === 'daily') return 10;
  if (task.priority === 'high') return 35;
  if (task.priority === 'medium') return 20;
  return 12;
}

function parseExplicitDurationMinutes(text: string): number | null {
  if (!text.trim()) return null;

  const matcher = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/gi;
  let totalMinutes = 0;
  let matched = false;

  for (const match of text.matchAll(matcher)) {
    const value = Number.parseFloat(match[1] || '');
    const unit = (match[2] || '').toLowerCase();
    if (!Number.isFinite(value)) continue;

    matched = true;
    totalMinutes += unit.startsWith('h') ? value * 60 : value;
  }

  return matched ? Math.max(1, Math.round(totalMinutes)) : null;
}

function getTaskTimeEstimate(task: Task): CandidateTimeEstimate {
  const titleMinutes = parseExplicitDurationMinutes(task.title);
  if (titleMinutes) {
    return {
      rankingMinutes: titleMinutes,
      estimatedMinutes: titleMinutes,
      estimatedMinutesSource: 'task_title',
    };
  }

  const descriptionMinutes = parseExplicitDurationMinutes(task.description);
  if (descriptionMinutes) {
    return {
      rankingMinutes: descriptionMinutes,
      estimatedMinutes: descriptionMinutes,
      estimatedMinutesSource: 'task_description',
    };
  }

  return {
    rankingMinutes: estimateTaskMinutes(task),
    estimatedMinutesSource: 'heuristic',
  };
}

function scoreCandidate(draft: Omit<FocusCandidateDraft, 'score'>): FocusCandidateDraft {
  const score = draft.scoreSignals.reduce((total, signal) => total + signal.value, 0);
  return { ...draft, score };
}

function finalizeCandidate(draft: FocusCandidateDraft): FocusCandidate {
  const sortedSignals = draft.scoreSignals
    .filter(signal => signal.value > 0)
    .sort((left, right) => right.value - left.value);

  return {
    id: draft.id,
    kind: draft.kind,
    title: draft.title,
    subtitle: draft.subtitle,
    score: draft.score,
    localWhy: sortedSignals.length > 0
      ? sortedSignals.slice(0, 2).map(signal => signal.label).join(' · ')
      : draft.localWhy,
    reasoningTags: draft.reasoningTags,
    estimatedMinutes: draft.estimatedMinutes,
    estimatedMinutesSource: draft.estimatedMinutesSource,
    taskId: draft.taskId,
    eventId: draft.eventId,
    projectId: draft.projectId,
    dueDate: draft.dueDate,
    isUrgent: draft.isUrgent,
  };
}

function getFeedbackWindow(feedback: FocusFeedback[], now: Date): FocusFeedback[] {
  const oldest = addMinutes(now, -LIMITS.DASHBOARD_FOCUS_FEEDBACK_DAYS * 24 * 60);
  return feedback.filter(item => new Date(item.createdAt) >= oldest);
}

function buildFeedbackMaps(feedback: FocusFeedback[], now: Date) {
  const recent = getFeedbackWindow(feedback, now);
  const dismissCounts = new Map<string, number>();
  const recentOpens = new Set<string>();
  const snoozedUntil = new Map<string, string>();

  for (const item of recent) {
    if (item.action === 'dismissed') {
      dismissCounts.set(item.candidateId, (dismissCounts.get(item.candidateId) || 0) + 1);
    }
    if (item.action === 'opened' || item.action === 'completed') {
      recentOpens.add(item.candidateId);
    }
    if (item.action === 'snoozed' && item.snoozedUntil && new Date(item.snoozedUntil) > now) {
      const current = snoozedUntil.get(item.candidateId);
      if (!current || new Date(item.snoozedUntil) > new Date(current)) {
        snoozedUntil.set(item.candidateId, item.snoozedUntil);
      }
    }
  }

  return { dismissCounts, recentOpens, snoozedUntil, recent };
}

function getVisibleUpcomingEvents(
  calendarSources: CalendarSource[],
  calendarEvents: CalendarEvent[],
  now: Date,
): CalendarEvent[] {
  const visibleSourceIds = new Set(calendarSources.filter(source => source.visible).map(source => source.id));
  const cutoff = addMinutes(now, 120).getTime();

  return calendarEvents
    .filter(event => visibleSourceIds.has(event.sourceId))
    .filter(event => !event.allDay)
    .filter(event => new Date(event.end).getTime() >= now.getTime())
    .filter(event => new Date(event.start).getTime() <= cutoff)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

function getRecentProjectMomentum(tasks: Task[], now: Date): {
  projectId?: string;
  completedToday: number;
} {
  const today = toLocalDateStr(now);
  const completedTasks = tasks
    .filter(task => Boolean(task.completedAt))
    .sort((left, right) => new Date(right.completedAt || 0).getTime() - new Date(left.completedAt || 0).getTime());

  return {
    projectId: completedTasks.find(task => task.projectId)?.projectId,
    completedToday: completedTasks.filter(task => task.completedAt && toLocalDateStr(new Date(task.completedAt)) === today).length,
  };
}

function buildStats(tasks: Task[], todayStr: string, prayerTimes: PrayerTime[] | undefined, now: Date): DashboardFocusStats {
  const activeTasks = tasks.filter(task => task.category !== 'goal' && !task.completed);
  const overdueCount = activeTasks.filter(task => task.category === 'task' && Boolean(task.dueDate) && task.dueDate! < todayStr).length;
  const dueTodayCount = activeTasks.filter(task => task.category === 'task' && task.dueDate === todayStr).length;
  const routinesLeft = activeTasks.filter(task => task.category === 'daily').length;
  const remainingPrayerNames = prayerTimes ? new Set(getRemainingPrayerNames(prayerTimes, now)) : null;
  const prayersLeft = activeTasks.filter(task => {
    if (!isPrayerTask(task)) return false;
    if (!remainingPrayerNames) return true;
    const prayerName = getPrayerTaskName(task);
    return prayerName ? remainingPrayerNames.has(prayerName) : false;
  }).length;

  return {
    overdueCount,
    dueTodayCount,
    routinesLeft,
    prayersLeft,
    activeTaskCount: activeTasks.length,
  };
}

function buildTaskCandidate(
  task: Task,
  input: DashboardFocusEngineInput,
  freeWindowMinutes: number,
  activeGoalTags: Set<string>,
  dismissCounts: Map<string, number>,
  recentOpens: Set<string>,
  recentProjectId: string | undefined,
): FocusCandidateDraft | null {
  const now = input.now;
  const todayStr = toLocalDateStr(now);
  const candidateId = `${task.category}:${task.id}`;
  const timeEstimate = getTaskTimeEstimate(task);
  const scoreSignals: ScoreSignal[] = [];
  const reasoningTags = new Set<string>();
  let subtitle = task.category === 'daily'
    ? 'Daily routine'
    : task.dueDate
      ? `Due ${task.dueDate}`
      : 'No due date yet';

  if (isPrayerTask(task)) {
    if (!input.prayerTimes) return null;

    const prayerName = getPrayerTaskName(task);
    const activePrayerWindow = getActivePrayerWindow(input.prayerTimes, now);
    if (!prayerName || !activePrayerWindow || activePrayerWindow.prayerName !== prayerName) {
      return null;
    }

    const windowClosesAt = activePrayerWindow.endsAt.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    scoreSignals.push({ label: 'Current prayer window is open', value: 108 });
    scoreSignals.push({ label: 'Prayer order is time-locked', value: 28 });
    reasoningTags.add('prayer');
    reasoningTags.add('prayer_window');

    if (activePrayerWindow.minutesRemaining <= 25) {
      scoreSignals.push({ label: `Prayer window closes in ${activePrayerWindow.minutesRemaining} min`, value: 24 });
      reasoningTags.add('window_ending');
    }

    subtitle = `Prayer window open until ${windowClosesAt}`;

    const dismissPenalty = dismissCounts.get(candidateId) || 0;
    if (dismissPenalty > 0) {
      scoreSignals.push({ label: 'You recently pushed this prayer back', value: -dismissPenalty * 22 });
      reasoningTags.add('recently_dismissed');
    }

    if (recentOpens.has(candidateId)) {
      scoreSignals.push({ label: 'Already opened recently', value: -10 });
    }

    return scoreCandidate({
      id: candidateId,
      kind: 'prayer',
      title: task.title,
      subtitle,
      localWhy: 'This is the current prayer window, and earlier prayers have already dropped out.',
      reasoningTags: Array.from(reasoningTags),
      estimatedMinutes: undefined,
      estimatedMinutesSource: 'heuristic',
      taskId: task.id,
      dueDate: undefined,
      isUrgent: activePrayerWindow.minutesRemaining <= 25,
      scoreSignals,
    });
  }

  if (task.category === 'task') {
    if (task.dueDate) {
      const dueDate = fromLocalDateStr(task.dueDate);
      const dayDiff = Math.round((new Date(todayStr).getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
      if (task.dueDate < todayStr) {
        scoreSignals.push({ label: `Overdue since ${task.dueDate}`, value: 120 + Math.max(dayDiff, 1) * 14 });
        reasoningTags.add('overdue');
        subtitle = `Overdue since ${task.dueDate}`;
      } else if (task.dueDate === todayStr) {
        scoreSignals.push({ label: 'Due today', value: 82 });
        reasoningTags.add('due_today');
        subtitle = `Due today · ${task.priority} priority`;
      } else {
        const daysUntil = Math.round((dueDate.getTime() - new Date(todayStr).getTime()) / (24 * 60 * 60 * 1000));
        scoreSignals.push({ label: `Upcoming in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`, value: Math.max(8, 36 - daysUntil * 6) });
        reasoningTags.add('upcoming');
        subtitle = `Upcoming · ${task.dueDate}`;
      }
    } else {
      scoreSignals.push({ label: 'Ready to move forward', value: 18 });
      reasoningTags.add('backlog_ready');
    }
    scoreSignals.push({ label: `${task.priority} priority`, value: TASK_PRIORITY_SCORE[task.priority] });
    reasoningTags.add(`${task.priority}_priority`);
  } else {
    scoreSignals.push({ label: 'Routine left for today', value: 76 });
    reasoningTags.add('routine');

    const tally = input.gamification.habitTallies?.[task.id] || 0;
    if (tally > 0) {
      scoreSignals.push({ label: 'Habit you usually keep', value: Math.min(18, Math.round(tally / 3)) });
      reasoningTags.add('streak_risk');
    }

    if (input.gamification.currentStreak > 0) {
      scoreSignals.push({ label: 'Protects your streak momentum', value: 12 });
      reasoningTags.add('momentum');
    }
  }

  if (task.blockedReason) {
    scoreSignals.push({ label: 'Has a blocker', value: -24 });
    reasoningTags.add('blocked');
    subtitle = `Blocked · ${task.blockedReason}`;
  }

  if (timeEstimate.rankingMinutes <= freeWindowMinutes || freeWindowMinutes === 0) {
    scoreSignals.push({ label: 'Fits the current runway', value: 14 });
    reasoningTags.add('fits_window');
  } else {
    scoreSignals.push({ label: 'May overrun the next free window', value: -18 });
  }

  const dismissPenalty = dismissCounts.get(candidateId) || 0;
  if (dismissPenalty > 0) {
    scoreSignals.push({ label: 'You recently pushed this back', value: -dismissPenalty * 22 });
    reasoningTags.add('recently_dismissed');
  }

  if (recentOpens.has(candidateId)) {
    scoreSignals.push({ label: 'Already opened recently', value: -10 });
  }

  if (task.projectId && task.projectId === recentProjectId) {
    scoreSignals.push({ label: 'Keeps the same project moving', value: 12 });
    reasoningTags.add('project_continuity');
  }

  if (task.goalTag && activeGoalTags.has(task.goalTag)) {
    scoreSignals.push({ label: 'Supports an active goal', value: 10 });
    reasoningTags.add('goal_support');
  }

  if (task.category === 'task' && task.workflowState === 'next_up') {
    scoreSignals.push({ label: 'Already marked as next up', value: 12 });
    reasoningTags.add('next_up');
  }

  const dueDate = task.dueDate;

  return scoreCandidate({
    id: candidateId,
    kind: task.category === 'daily' ? 'habit' : 'task',
    title: task.title,
    subtitle,
    localWhy: task.category === 'daily' ? 'Routine left for today.' : 'Best available task to move right now.',
    reasoningTags: Array.from(reasoningTags),
    estimatedMinutes: timeEstimate.estimatedMinutes,
    estimatedMinutesSource: timeEstimate.estimatedMinutesSource,
    taskId: task.id,
    projectId: task.projectId,
    dueDate,
    isUrgent: task.category === 'task' && typeof dueDate === 'string' && dueDate <= todayStr,
    scoreSignals,
  });
}

function buildMeetingPrepCandidate(
  event: CalendarEvent,
  now: Date,
): FocusCandidateDraft | null {
  const minutesUntil = diffMinutes(event.start, now);
  const prepPressure = getEventPrepPressure(event);
  if (minutesUntil > 15 && !prepPressure) {
    return null;
  }

  const scoreSignals: ScoreSignal[] = [];
  const reasoningTags = new Set<string>(['meeting_prep']);
  scoreSignals.push({ label: `Meeting starts in ${Math.max(minutesUntil, 0)} min`, value: 92 + Math.max(0, 15 - Math.max(minutesUntil, 0)) * 2 });

  if (prepPressure) {
    scoreSignals.push({ label: 'Needs location or prep context', value: 22 });
    reasoningTags.add('prep_pressure');
  }

  return scoreCandidate({
    id: `meeting:${event.id}`,
    kind: 'meeting_prep',
    title: `Prepare for ${event.title}`,
    subtitle: minutesUntil <= 0
      ? `Starting now${event.location ? ` · ${event.location}` : ''}`
      : `Starts in ${minutesUntil} min${event.location ? ` · ${event.location}` : ''}`,
    localWhy: 'This meeting is close enough that prep beats switching into new work.',
    reasoningTags: Array.from(reasoningTags),
    estimatedMinutes: clamp(minutesUntil > 0 ? minutesUntil : 5, 5, 15),
    estimatedMinutesSource: 'event_window',
    eventId: event.id,
    isUrgent: minutesUntil <= 15,
    scoreSignals,
  });
}

function buildBreakCandidate(
  freeWindowMinutes: number,
  completedToday: number,
): FocusCandidateDraft | null {
  if (completedToday < 3 || freeWindowMinutes < 25) {
    return null;
  }

  return scoreCandidate({
    id: 'break:reset',
    kind: 'break',
    title: 'Take a short reset',
    subtitle: `You have about ${freeWindowMinutes} minutes of runway`,
    localWhy: 'You have open runway and enough momentum for a short break without losing the day.',
    reasoningTags: ['break', 'runway'],
    estimatedMinutes: 10,
    scoreSignals: [
      { label: 'You have breathing room before the next commitment', value: 28 },
      { label: 'Momentum is already established today', value: 12 },
    ],
  });
}

function buildClearCandidate(nextEvent: CalendarEvent | undefined): FocusCandidateDraft {
  return scoreCandidate({
    id: 'clear:all_caught_up',
    kind: 'clear',
    title: "You're all caught up",
    subtitle: nextEvent
      ? `Next event: ${nextEvent.title} at ${new Date(nextEvent.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`
      : 'No urgent tasks, habits, or meetings need attention right now.',
    localWhy: 'No urgent tasks or habits need attention right now.',
    reasoningTags: ['clear'],
    estimatedMinutes: undefined,
    scoreSignals: [
      { label: 'No urgent follow-up right now', value: 6 },
    ],
  });
}

function buildQueueCandidateIds(candidates: FocusCandidate[], selectedCandidateId: string, alternativeIds: string[]): string[] {
  const ordered = [selectedCandidateId, ...alternativeIds, ...candidates.map(candidate => candidate.id)];
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const candidateId of ordered) {
    if (seen.has(candidateId)) continue;
    if (!candidates.some(candidate => candidate.id === candidateId)) continue;
    seen.add(candidateId);
    queue.push(candidateId);
    if (queue.length >= LIMITS.DASHBOARD_FOCUS_QUEUE) break;
  }

  return queue;
}

function buildLocalRecommendation(
  candidates: FocusCandidate[],
  inputHash: string,
  refreshAfterMinutes: number,
  fallbackReason?: string,
): DashboardFocusSelectionResult {
  const selected = candidates[0];
  const alternatives = candidates.slice(1, LIMITS.DASHBOARD_FOCUS_QUEUE).map(candidate => candidate.id);
  const confidenceGap = selected && candidates[1]
    ? selected.score - candidates[1].score
    : 30;
  const confidence = clamp(0.54 + confidenceGap / 120, 0.45, 0.92);
  const generatedAt = new Date().toISOString();
  const recommendation: FocusRecommendation = {
    selectedCandidateId: selected.id,
    why: selected.localWhy,
    confidence: Number(confidence.toFixed(2)),
    reasoningTags: selected.reasoningTags,
    estimatedMinutes: selected.estimatedMinutes,
    estimatedMinutesSource: selected.estimatedMinutesSource,
    alternativeIds: alternatives,
    refreshAfterMinutes,
    source: 'local',
    generatedAt,
    expiresAt: new Date(new Date(generatedAt).getTime() + refreshAfterMinutes * 60 * 1000).toISOString(),
    inputHash,
    fallbackReason,
  };

  return {
    recommendation,
    queueCandidateIds: buildQueueCandidateIds(candidates, recommendation.selectedCandidateId, recommendation.alternativeIds),
    source: 'local',
    status: fallbackReason ? 'fallback' : 'ready',
    fallbackReason,
  };
}

function buildFocusSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      selectedCandidateId: { type: 'string' },
      why: { type: 'string' },
      confidence: { type: 'number' },
      reasoningTags: {
        type: 'array',
        items: { type: 'string' },
      },
      estimatedMinutes: {
        anyOf: [
          { type: 'number' },
          { type: 'null' },
        ],
      },
      alternativeIds: {
        type: 'array',
        items: { type: 'string' },
      },
      refreshAfterMinutes: { type: 'number' },
    },
    required: [
      'selectedCandidateId',
      'why',
      'confidence',
      'reasoningTags',
      'estimatedMinutes',
      'alternativeIds',
      'refreshAfterMinutes',
    ],
  } as const;
}

function parseFocusResponse(rawText: string): DashboardFocusResponseSchema | null {
  try {
    const parsed = JSON.parse(rawText) as Partial<DashboardFocusResponseSchema>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.selectedCandidateId !== 'string' || typeof parsed.why !== 'string') return null;
    if (typeof parsed.confidence !== 'number' || typeof parsed.refreshAfterMinutes !== 'number') return null;
    if (!Array.isArray(parsed.reasoningTags) || !Array.isArray(parsed.alternativeIds)) return null;
    if (parsed.estimatedMinutes !== null && typeof parsed.estimatedMinutes !== 'number') return null;

    return {
      selectedCandidateId: parsed.selectedCandidateId,
      why: parsed.why.trim(),
      confidence: clamp(parsed.confidence, 0, 1),
      reasoningTags: parsed.reasoningTags.filter((tag): tag is string => typeof tag === 'string').slice(0, 6),
      estimatedMinutes: parsed.estimatedMinutes,
      alternativeIds: parsed.alternativeIds.filter((candidateId): candidateId is string => typeof candidateId === 'string').slice(0, LIMITS.DASHBOARD_FOCUS_QUEUE),
      refreshAfterMinutes: clamp(Math.round(parsed.refreshAfterMinutes), 1, 15),
    };
  } catch {
    return null;
  }
}

function buildFocusMessages(candidates: FocusCandidate[], now: Date) {
  const candidateBlock = candidates.map(candidate => JSON.stringify({
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    subtitle: candidate.subtitle,
    score: candidate.score,
    estimatedMinutes: candidate.estimatedMinutes ?? null,
    reasoningTags: candidate.reasoningTags,
    localWhy: candidate.localWhy,
  })).join('\n');

  return [
    {
      role: 'system' as const,
      content: [
        'You choose the single best next thing for HELM dashboard focus.',
        'Only choose from the provided candidate ids.',
        'Prefer the most actionable and time-aware item.',
        'Meeting prep should only win when it truly beats starting task work.',
        'Return concise JSON only.',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: [
        `Current local time: ${now.toString()}.`,
        `Choose the best candidate from this list and explain why in one short sentence.`,
        candidateBlock,
      ].join('\n'),
    },
  ];
}

export function buildDashboardFocusCandidates(input: DashboardFocusEngineInput): DashboardFocusBuildResult {
  const todayStr = toLocalDateStr(input.now);
  const stats = buildStats(input.tasks, todayStr, input.prayerTimes, input.now);
  const { dismissCounts, recentOpens, snoozedUntil, recent } = buildFeedbackMaps(input.feedback, input.now);
  const upcomingEvents = getVisibleUpcomingEvents(input.calendarSources, input.calendarEvents, input.now);
  const nextEvent = upcomingEvents[0];
  const freeWindowMinutes = nextEvent ? Math.max(0, diffMinutes(nextEvent.start, input.now)) : 0;
  const { projectId: recentProjectId, completedToday } = getRecentProjectMomentum(input.tasks, input.now);
  const activeGoalTags = new Set(
    input.tasks
      .filter(task => task.category === 'goal' && !task.completed && task.goalTag)
      .map(task => task.goalTag as string),
  );

  const drafts: FocusCandidateDraft[] = [];

  for (const task of input.tasks) {
    if (task.completed || task.category === 'goal') continue;
    if (snoozedUntil.has(`${task.category}:${task.id}`)) continue;
    if (!hasActionableNextStep(task)) continue;

    const draft = buildTaskCandidate(
      task,
      input,
      freeWindowMinutes,
      activeGoalTags,
      dismissCounts,
      recentOpens,
      recentProjectId,
    );

    if (draft) {
      drafts.push(draft);
    }
  }

  if (nextEvent) {
    const meetingPrep = buildMeetingPrepCandidate(nextEvent, input.now);
    if (meetingPrep && !snoozedUntil.has(meetingPrep.id)) {
      const dismissPenalty = dismissCounts.get(meetingPrep.id) || 0;
      if (dismissPenalty > 0) {
        meetingPrep.score -= dismissPenalty * 20;
      }
      drafts.push(meetingPrep);
    }
  }

  const hasUrgentWork = drafts.some(candidate => candidate.kind !== 'meeting_prep' && candidate.isUrgent);
  if (!hasUrgentWork) {
    const breakCandidate = buildBreakCandidate(freeWindowMinutes, completedToday);
    if (breakCandidate && !snoozedUntil.has(breakCandidate.id)) {
      drafts.push(breakCandidate);
    }
  }

  const sortedCandidates = drafts
    .sort((left, right) => right.score - left.score)
    .slice(0, LIMITS.DASHBOARD_FOCUS_CANDIDATE_POOL)
    .map(finalizeCandidate);

  const candidates = sortedCandidates.length > 0
    ? sortedCandidates
    : [finalizeCandidate(buildClearCandidate(nextEvent))];

  const recommendedRefreshMinutes = nextEvent && diffMinutes(nextEvent.start, input.now) > 15
    ? clamp(diffMinutes(nextEvent.start, input.now) - 15, 1, 15)
    : 15;

  const inputHash = JSON.stringify({
    today: todayStr,
    candidates: candidates.map(candidate => ({
      id: candidate.id,
      score: candidate.score,
      title: candidate.title,
      subtitle: candidate.subtitle,
      kind: candidate.kind,
      estimatedMinutes: candidate.estimatedMinutes ?? null,
    })),
    stats,
    feedback: recent.map(item => ({
      candidateId: item.candidateId,
      action: item.action,
      snoozedUntil: item.snoozedUntil || null,
    })),
  });

  return {
    candidates,
    stats,
    inputHash,
    recommendedRefreshMinutes,
  };
}

export async function selectDashboardFocusRecommendation(
  buildResult: DashboardFocusBuildResult,
  options: {
    allowHostedReview?: boolean;
    now: Date;
    settings: Pick<Settings, 'assistantProvider' | 'hostedModel'>;
  },
): Promise<DashboardFocusSelectionResult> {
  const { candidates, inputHash, recommendedRefreshMinutes } = buildResult;
  const providerMode = options.settings.assistantProvider || 'auto';
  const allowHostedReview = options.allowHostedReview ?? true;

  if (!allowHostedReview || providerMode === 'ollama' || candidates.length === 1 && candidates[0].kind === 'clear') {
    return buildLocalRecommendation(candidates, inputHash, recommendedRefreshMinutes);
  }

  const hostedModel = getHostedAssistantModelSetting(options.settings);
  const startedAt = performance.now();

  try {
    const availability = await testHostedAssistantConnection({ model: hostedModel });
    if (availability.status !== 'available') {
      return {
        ...buildLocalRecommendation(candidates, inputHash, recommendedRefreshMinutes, availability.status),
        errorMessage: availability.message,
      };
    }

    const response = await chatWithHostedAssistantDetailed(
      buildFocusMessages(candidates, options.now),
      buildFocusSchema(),
      { model: hostedModel },
    );
    const parsed = parseFocusResponse(response.text);
    if (!parsed) {
      return {
        ...buildLocalRecommendation(candidates, inputHash, recommendedRefreshMinutes, 'invalid_schema'),
        errorMessage: 'Hosted dashboard focus returned invalid JSON.',
        rawModelResponse: response.text,
      };
    }

    const selectedCandidate = candidates.find(candidate => candidate.id === parsed.selectedCandidateId);
    if (!selectedCandidate) {
      return {
        ...buildLocalRecommendation(candidates, inputHash, recommendedRefreshMinutes, 'invalid_selection'),
        errorMessage: `Hosted dashboard focus chose an unknown candidate (${parsed.selectedCandidateId}).`,
        rawModelResponse: response.text,
      };
    }

    const alternativeIds = parsed.alternativeIds.filter(candidateId => candidateId !== selectedCandidate.id);
    const refreshAfterMinutes = clamp(parsed.refreshAfterMinutes, 1, recommendedRefreshMinutes);
    const generatedAt = new Date().toISOString();
    const recommendation: FocusRecommendation = {
      selectedCandidateId: selectedCandidate.id,
      why: parsed.why || selectedCandidate.localWhy,
      confidence: Number(parsed.confidence.toFixed(2)),
      reasoningTags: parsed.reasoningTags.length > 0 ? parsed.reasoningTags : selectedCandidate.reasoningTags,
      estimatedMinutes: selectedCandidate.estimatedMinutes,
      estimatedMinutesSource: selectedCandidate.estimatedMinutesSource,
      alternativeIds,
      refreshAfterMinutes,
      source: 'openai',
      model: response.model,
      generatedAt,
      expiresAt: new Date(new Date(generatedAt).getTime() + refreshAfterMinutes * 60 * 1000).toISOString(),
      inputHash,
    };

    return {
      recommendation,
      queueCandidateIds: buildQueueCandidateIds(candidates, recommendation.selectedCandidateId, recommendation.alternativeIds),
      source: 'openai',
      status: 'ready',
      model: response.model,
      rawModelResponse: response.text,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ...buildLocalRecommendation(candidates, inputHash, recommendedRefreshMinutes, 'hosted_error'),
      errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

export function readDashboardFocusCache(): DashboardFocusSelectionResult | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_FOCUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardFocusSelectionResult | null;
    if (!parsed?.recommendation) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDashboardFocusCache(result: DashboardFocusSelectionResult): void {
  localStorage.setItem(DASHBOARD_FOCUS_CACHE_KEY, JSON.stringify(result));
}

export function clearDashboardFocusCache(): void {
  localStorage.removeItem(DASHBOARD_FOCUS_CACHE_KEY);
}

export function isDashboardFocusCacheValid(
  cached: DashboardFocusSelectionResult | null,
  inputHash: string,
  now: Date,
): boolean {
  if (!cached?.recommendation) return false;
  return cached.recommendation.inputHash === inputHash
    && new Date(cached.recommendation.expiresAt).getTime() > now.getTime();
}

export function getDashboardFocusExpiryDelay(
  recommendation: FocusRecommendation | null,
  now: Date,
): number | null {
  if (!recommendation) return null;
  const delay = new Date(recommendation.expiresAt).getTime() - now.getTime();
  if (delay <= 0) return 0;
  return Math.min(delay, TIMING.DASHBOARD_FOCUS_CACHE_TTL);
}

export function readDashboardFocusHostedReview(): DashboardFocusHostedReviewRecord | null {
  try {
    const raw = localStorage.getItem(DASHBOARD_FOCUS_HOSTED_REVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardFocusHostedReviewRecord | null;
    if (!parsed?.reviewDate || !parsed.attemptedAt || !parsed.source) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasDashboardFocusHostedReviewToday(now: Date): boolean {
  const record = readDashboardFocusHostedReview();
  if (!record) return false;
  return record.reviewDate === toLocalDateStr(now);
}

export function writeDashboardFocusHostedReview(result: DashboardFocusSelectionResult, now: Date): void {
  localStorage.setItem(DASHBOARD_FOCUS_HOSTED_REVIEW_KEY, JSON.stringify({
    reviewDate: toLocalDateStr(now),
    attemptedAt: now.toISOString(),
    source: result.source,
    fallbackReason: result.fallbackReason,
  } satisfies DashboardFocusHostedReviewRecord));
}

export function clearDashboardFocusHostedReview(): void {
  localStorage.removeItem(DASHBOARD_FOCUS_HOSTED_REVIEW_KEY);
}
