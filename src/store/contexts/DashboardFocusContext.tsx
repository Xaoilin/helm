import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { v4 as uuid } from 'uuid';
import type {
  DashboardFocusState,
  FocusCandidate,
  FocusFeedback,
} from '../../types/domain';
import { LIMITS, TIMING } from '../../config/constants';
import {
  buildDashboardFocusCandidates,
  clearDashboardFocusCache,
  hasDashboardFocusHostedReviewToday,
  getDashboardFocusExpiryDelay,
  isDashboardFocusCacheValid,
  readDashboardFocusCache,
  writeDashboardFocusHostedReview,
  selectDashboardFocusRecommendation,
  writeDashboardFocusCache,
} from '../../services/dashboardFocus';
import { recordDashboardFocusDiagnostics } from '../../services/dashboardFocusDiagnostics';
import { loadStore, saveStore } from '../persistence';
import { useCalendar } from './CalendarContext';
import { useGamificationContext } from './GamificationContext';
import { useProjectContext } from './ProjectContext';
import { useSettingsContext } from './SettingsContext';
import { useTaskContext } from './TaskContext';

const EMPTY_STATS = {
  overdueCount: 0,
  dueTodayCount: 0,
  routinesLeft: 0,
  activeTaskCount: 0,
} as const;

const INITIAL_STATE: DashboardFocusState = {
  loaded: false,
  status: 'idle',
  recommendation: null,
  candidates: [],
  queueCandidateIds: [],
  stats: EMPTY_STATS,
};

interface DashboardFocusContextValue {
  dashboardFocus: DashboardFocusState;
  loaded: boolean;
  refreshDashboardFocus: () => void;
  dismissDashboardFocus: (candidateId?: string) => void;
  snoozeDashboardFocus: (candidateId?: string, minutes?: number) => void;
  noteDashboardFocusOpened: (candidateId?: string) => void;
}

const DashboardFocusCtx = createContext<DashboardFocusContextValue | null>(null);

function pruneFeedback(feedback: FocusFeedback[], now: Date): FocusFeedback[] {
  const cutoff = new Date(now.getTime() - LIMITS.DASHBOARD_FOCUS_FEEDBACK_DAYS * 24 * 60 * 60 * 1000);
  return feedback.filter(item => new Date(item.createdAt) >= cutoff);
}

function fallbackQueueIds(candidates: FocusCandidate[]): string[] {
  return candidates.slice(0, LIMITS.DASHBOARD_FOCUS_QUEUE).map(candidate => candidate.id);
}

export function useDashboardFocusContext(): DashboardFocusContextValue {
  const ctx = useContext(DashboardFocusCtx);
  if (!ctx) throw new Error('useDashboardFocusContext must be used within DashboardFocusProvider');
  return ctx;
}

export function DashboardFocusProvider({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const taskCtx = useTaskContext();
  const projectCtx = useProjectContext();
  const gamificationCtx = useGamificationContext();
  const settingsCtx = useSettingsContext();

  const [feedback, setFeedback] = useState<FocusFeedback[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dashboardFocus, setDashboardFocus] = useState<DashboardFocusState>(INITIAL_STATE);
  const [now, setNow] = useState(() => new Date());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshSequenceRef = useRef(0);
  const previousTaskCompletionRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), TIMING.DASHBOARD_FOCUS_TICK);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      const storedFeedback = await loadStore<FocusFeedback[]>('dashboardFocusFeedback');
      const nextFeedback = pruneFeedback(storedFeedback ?? [], new Date());
      setFeedback(nextFeedback);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void saveStore('dashboardFocusFeedback', pruneFeedback(feedback, new Date()));
  }, [feedback, loaded]);

  useEffect(() => {
    if (!loaded) return;

    const nextMap = new Map<string, boolean>();
    const completedFeedback: FocusFeedback[] = [];

    for (const task of taskCtx.tasks) {
      nextMap.set(task.id, task.completed);
      const previousCompleted = previousTaskCompletionRef.current.get(task.id);
      if (previousCompleted === false && task.completed) {
        completedFeedback.push({
          id: uuid(),
          candidateId: `${task.category}:${task.id}`,
          action: 'completed',
          createdAt: new Date().toISOString(),
        });
      }
    }

    previousTaskCompletionRef.current = nextMap;

    if (completedFeedback.length > 0) {
      const timeout = window.setTimeout(() => {
        clearDashboardFocusCache();
        setFeedback(current => pruneFeedback([...current, ...completedFeedback], new Date()));
      }, 0);

      return () => window.clearTimeout(timeout);
    }
  }, [loaded, taskCtx.tasks]);

  const buildResult = useMemo(() => buildDashboardFocusCandidates({
    tasks: taskCtx.tasks,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    projects: projectCtx.projects,
    gamification: gamificationCtx.gamification,
    feedback,
    now,
  }), [
    taskCtx.tasks,
    calendar.calendarSources,
    calendar.calendarEvents,
    projectCtx.projects,
    gamificationCtx.gamification,
    feedback,
    now,
  ]);

  const recordFeedback = useCallback((entry: Omit<FocusFeedback, 'id' | 'createdAt'>) => {
    clearDashboardFocusCache();
    setFeedback(current => pruneFeedback([
      ...current,
      {
        ...entry,
        id: uuid(),
        createdAt: new Date().toISOString(),
      },
    ], new Date()));
  }, []);

  const resolveCandidateId = useCallback((candidateId?: string) => (
    candidateId
      || dashboardFocus.recommendation?.selectedCandidateId
      || dashboardFocus.queueCandidateIds[0]
      || dashboardFocus.candidates[0]?.id
  ), [dashboardFocus.candidates, dashboardFocus.queueCandidateIds, dashboardFocus.recommendation]);

  const refreshDashboardFocus = useCallback(() => {
    clearDashboardFocusCache();
    const selectedCandidateId = resolveCandidateId();
    if (selectedCandidateId) {
      recordFeedback({
        candidateId: selectedCandidateId,
        action: 'refreshed',
      });
    }
    setRefreshNonce(current => current + 1);
  }, [recordFeedback, resolveCandidateId]);

  const dismissDashboardFocus = useCallback((candidateId?: string) => {
    const resolvedCandidateId = resolveCandidateId(candidateId);
    if (!resolvedCandidateId) return;
    recordFeedback({
      candidateId: resolvedCandidateId,
      action: 'dismissed',
    });
    setRefreshNonce(current => current + 1);
  }, [recordFeedback, resolveCandidateId]);

  const snoozeDashboardFocus = useCallback((candidateId?: string, minutes = 60) => {
    const resolvedCandidateId = resolveCandidateId(candidateId);
    if (!resolvedCandidateId) return;
    recordFeedback({
      candidateId: resolvedCandidateId,
      action: 'snoozed',
      snoozedUntil: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    });
    setRefreshNonce(current => current + 1);
  }, [recordFeedback, resolveCandidateId]);

  const noteDashboardFocusOpened = useCallback((candidateId?: string) => {
    const resolvedCandidateId = resolveCandidateId(candidateId);
    if (!resolvedCandidateId) return;
    recordFeedback({
      candidateId: resolvedCandidateId,
      action: 'opened',
    });
  }, [recordFeedback, resolveCandidateId]);

  useEffect(() => {
    if (!loaded) return;

    const sequence = refreshSequenceRef.current + 1;
    refreshSequenceRef.current = sequence;
    const cached = readDashboardFocusCache();
    const hostedReviewAlreadyRanToday = hasDashboardFocusHostedReviewToday(now);

    if (isDashboardFocusCacheValid(cached, buildResult.inputHash, now)) {
      const cachedHostedReviewAttempted = cached?.source === 'openai' || Boolean(cached?.fallbackReason);
      if (!hostedReviewAlreadyRanToday && cachedHostedReviewAttempted) {
        writeDashboardFocusHostedReview(cached!, now);
      }

      startTransition(() => {
        setDashboardFocus({
          loaded: true,
          status: 'ready',
          recommendation: cached!.recommendation,
          candidates: buildResult.candidates,
          queueCandidateIds: cached!.queueCandidateIds.filter(candidateId => buildResult.candidates.some(candidate => candidate.id === candidateId)),
          stats: buildResult.stats,
          lastError: cached!.errorMessage,
        });
      });

      recordDashboardFocusDiagnostics({
        recordedAt: new Date().toISOString(),
        status: cached?.fallbackReason ? 'fallback' : 'ready',
        source: cached?.source || 'local',
        providerMode: settingsCtx.settings.assistantProvider || 'auto',
        hostedReviewCadence: 'once_per_day',
        hostedReviewAttemptedToday: hostedReviewAlreadyRanToday || cachedHostedReviewAttempted,
        inputHash: buildResult.inputHash,
        selectedCandidateId: cached?.recommendation.selectedCandidateId,
        queueCandidateIds: cached?.queueCandidateIds || fallbackQueueIds(buildResult.candidates),
        candidateCount: buildResult.candidates.length,
        stats: buildResult.stats,
        model: cached?.recommendation.model,
        fallbackReason: cached?.recommendation.fallbackReason || cached?.fallbackReason,
        errorMessage: cached?.errorMessage,
        latencyMs: cached?.latencyMs,
        rawModelResponse: cached?.rawModelResponse,
        recommendation: cached?.recommendation,
        topCandidates: buildResult.candidates.slice(0, 5).map(candidate => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          score: candidate.score,
        })),
      });
      return;
    }

    startTransition(() => {
      setDashboardFocus(current => ({
        ...current,
        loaded: true,
        status: 'refreshing',
        candidates: buildResult.candidates,
        stats: buildResult.stats,
      }));
    });

    void (async () => {
      const selection = await selectDashboardFocusRecommendation(buildResult, {
        allowHostedReview: !hostedReviewAlreadyRanToday,
        now,
        settings: settingsCtx.settings,
      });
      if (refreshSequenceRef.current !== sequence) return;

      if (selection.source === 'openai' || Boolean(selection.fallbackReason)) {
        writeDashboardFocusHostedReview(selection, now);
      }

      writeDashboardFocusCache(selection);

      startTransition(() => {
        setDashboardFocus({
          loaded: true,
          status: 'ready',
          recommendation: selection.recommendation,
          candidates: buildResult.candidates,
          queueCandidateIds: selection.queueCandidateIds.length > 0
            ? selection.queueCandidateIds
            : fallbackQueueIds(buildResult.candidates),
          stats: buildResult.stats,
          lastError: selection.errorMessage,
        });
      });

      recordDashboardFocusDiagnostics({
        recordedAt: new Date().toISOString(),
        status: selection.status === 'fallback' ? 'fallback' : 'ready',
        source: selection.source,
        providerMode: settingsCtx.settings.assistantProvider || 'auto',
        hostedReviewCadence: 'once_per_day',
        hostedReviewAttemptedToday: hostedReviewAlreadyRanToday || selection.source === 'openai' || Boolean(selection.fallbackReason),
        inputHash: buildResult.inputHash,
        selectedCandidateId: selection.recommendation.selectedCandidateId,
        queueCandidateIds: selection.queueCandidateIds,
        candidateCount: buildResult.candidates.length,
        stats: buildResult.stats,
        model: selection.model || selection.recommendation.model,
        fallbackReason: selection.fallbackReason || selection.recommendation.fallbackReason,
        errorMessage: selection.errorMessage,
        latencyMs: selection.latencyMs,
        rawModelResponse: selection.rawModelResponse,
        recommendation: selection.recommendation,
        topCandidates: buildResult.candidates.slice(0, 5).map(candidate => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          score: candidate.score,
        })),
      });
    })();
  }, [
    buildResult,
    loaded,
    now,
    refreshNonce,
    settingsCtx.settings,
  ]);

  useEffect(() => {
    if (!loaded) return;
    const delay = getDashboardFocusExpiryDelay(dashboardFocus.recommendation, now);
    if (delay === null) return;

    const timeout = window.setTimeout(() => {
      setRefreshNonce(current => current + 1);
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [dashboardFocus.recommendation, loaded, now]);

  const value = useMemo(() => ({
    dashboardFocus,
    loaded,
    refreshDashboardFocus,
    dismissDashboardFocus,
    snoozeDashboardFocus,
    noteDashboardFocusOpened,
  }), [
    dashboardFocus,
    loaded,
    refreshDashboardFocus,
    dismissDashboardFocus,
    snoozeDashboardFocus,
    noteDashboardFocusOpened,
  ]);

  return (
    <DashboardFocusCtx.Provider value={value}>
      {children}
    </DashboardFocusCtx.Provider>
  );
}
