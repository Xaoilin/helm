import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerCompletionUndoData,
  PrayerDeadlineBounds,
  PrayerName,
  PrayerOutcomeStats,
  PrayerOutcomeStatus,
  PrayerScheduleDay,
  PrayerTrackingRecord,
  PrayerTrackingState,
} from '../../types/domain';
import { PRAYER_REMINDERS } from '../../config/constants';
import type { CompletionResult } from '../../services/gamification';
import { toLocalDateStr } from '../../services/financeHelpers';
import {
  getPrayerZonedDate,
  shiftPrayerDate,
  validatePrayerTimeZone,
} from '../../services/prayerTimeZone';
import {
  capturePrayerActivationDayEligibility,
  createPrayerTrackingState,
  getPrayerCompletionStatusAt,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  getPrayerRecordKey,
  normalizePrayerTrackingState,
  setPrayerReminderReceipt,
} from '../../services/prayerTracking';
import {
  cancelAllPrayerReminders,
  cancelPrayerReminder,
  getPrayerReminderPermission,
  onPrayerReminderFired,
  requestPrayerReminderPermission,
  schedulePrayerReminder,
  sendPrayerNotification,
  type PrayerReminderPermissionRequestResult,
  type PrayerReminderPermissionState,
} from '../../services/browserPrayerReminder';
import {
  getPrayerTimes,
  isAdhanTime,
  type PrayerTime,
  type PrayerTimesData,
} from '../../services/prayerTimes';
import type { getNextPrayer } from '../../services/prayerTimes';
import {
  applyPrayerCompletionUndo,
  buildPrayerCompletionTransition,
  buildPrayerCorrectionTransition,
} from '../../services/prayerCompletionPolicy';
import {
  buildPrayerReminderGroups,
  buildScheduledPrayerReminderGroup,
  selectActivePrayerReminder,
  type PrayerReminderGroup,
  type ScheduledPrayerReminderGroup,
} from '../../services/prayerReminderPolicy';
import {
  buildPrayerSchedulePolicySnapshot,
  classifyExpiredPrayerOutcomes,
} from '../../services/prayerSchedulePolicy';
import {
  buildBoundedReminderPlan,
  canSnoozeBoundedReminder,
  getActiveBoundedReminder,
  getAttemptableBoundedReminders,
  recordBoundedReminderAttempt,
  snoozeBoundedReminder,
  type BoundedReminderPlan,
} from '../../services/boundedReminders';
import { logError } from '../../services/logger';
import { loadStore, saveStore, saveStoreCommitted } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';
import { useGamificationContext } from './GamificationContext';
import { useDailyMomentumContext } from './DailyMomentumContext';
import { useKnowledgeContext } from './KnowledgeContext';
import { useSettingsContext } from './SettingsContext';
import { useTaskContext } from './TaskContext';

export interface PrayerCompletionMutationResult {
  undo: PrayerCompletionUndoData;
  xpEarned: number;
  status: PrayerCompletionStatus;
  prayerName: PrayerName;
  prayerDate: string;
  gamificationResult?: CompletionResult;
}

export interface PrayerCompletionRequest {
  prayerName: PrayerName;
  taskId?: string;
  prayerDate?: string;
  source: PrayerCompletionSource;
  suggestedStatus: PrayerCompletionStatus | null;
  onCompleted?: (result: PrayerCompletionMutationResult) => void;
}

export type { PrayerReminderGroup } from '../../services/prayerReminderPolicy';

export interface PrayerDiagnostics {
  scheduleStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  scheduleDate: string | null;
  scheduleSource: PrayerTimesData['source'] | null;
  fetchedAt: string | null;
  location: string;
  method: string | null;
  scheduleTimezone: string | null;
  localTimezone: string;
  timezoneMatches: boolean;
  scheduleTimezoneValid: boolean;
  nextReminderAt: string | null;
  suppressionReason: string | null;
  permissionState: PrayerReminderPermissionState;
  lastNotificationKey: string | null;
  lastError: string | null;
}

interface CompletePrayerOptions {
  taskId?: string;
  prayerDate?: string;
  source?: PrayerCompletionSource;
}

interface PrayerContextValue {
  loaded: boolean;
  tracking: PrayerTrackingState;
  schedule: PrayerTimesData | null;
  scheduleStatus: PrayerDiagnostics['scheduleStatus'];
  scheduleError: string | null;
  now: Date;
  today: string;
  localTimezone: string;
  timezoneMatches: boolean;
  scheduleTimezoneValid: boolean;
  scheduleDays: PrayerScheduleDay[];
  stats: PrayerOutcomeStats;
  deadlines: Record<PrayerName, PrayerDeadlineBounds | null>;
  nextPrayer: ReturnType<typeof getNextPrayer>;
  pendingCompletion: PrayerCompletionRequest | null;
  activeReminder: PrayerReminderGroup | null;
  activeBoundedReminder: BoundedReminderPlan | null;
  canSnoozeActiveBoundedReminder: boolean;
  adhanPrayer: PrayerTime | null;
  diagnostics: PrayerDiagnostics;
  requestPrayerCompletion: (
    prayerName: PrayerName,
    options?: Omit<PrayerCompletionRequest, 'prayerName' | 'suggestedStatus'>,
  ) => void;
  cancelPrayerCompletion: () => void;
  confirmPrayerCompletion: (status: PrayerCompletionStatus) => PrayerCompletionMutationResult | null;
  completePrayer: (
    prayerName: PrayerName,
    status: PrayerCompletionStatus,
    options?: CompletePrayerOptions,
  ) => PrayerCompletionMutationResult;
  correctPrayerOutcome: (
    prayerDate: string,
    prayerName: PrayerName,
    status: PrayerOutcomeStatus,
  ) => void;
  getOutcome: (prayerDate: string, prayerName: PrayerName) => PrayerTrackingRecord | undefined;
  undoPrayerCompletion: (inverse: PrayerCompletionUndoData) => void;
  replacePrayerTracking: (state: PrayerTrackingState) => void;
  snoozeActiveReminder: () => void;
  snoozeActiveBoundedReminder: () => void;
  retrySchedule: () => Promise<void>;
  requestReminderPermission: () => Promise<PrayerReminderPermissionRequestResult>;
  testReminder: (prayerName?: PrayerName) => Promise<boolean>;
  dismissAdhan: () => void;
}

const PrayerCtx = createContext<PrayerContextValue | null>(null);

export function usePrayerContext(): PrayerContextValue {
  const ctx = useContext(PrayerCtx);
  if (!ctx) throw new Error('usePrayerContext must be used within PrayerProvider');
  return ctx;
}

export function PrayerProvider({ children }: { children: ReactNode }) {
  const taskCtx = useTaskContext();
  const gamificationCtx = useGamificationContext();
  const momentumCtx = useDailyMomentumContext();
  const knowledge = useKnowledgeContext();
  const settingsCtx = useSettingsContext();
  const [tracking, setTracking] = useState<PrayerTrackingState>(() => createPrayerTrackingState());
  const [loaded, setLoaded] = useState(false);
  const [schedule, setSchedule] = useState<PrayerTimesData | null>(null);
  const [reminderSchedules, setReminderSchedules] = useState<Record<string, PrayerTimesData>>({});
  const [scheduleStatus, setScheduleStatus] = useState<PrayerDiagnostics['scheduleStatus']>('idle');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [pendingCompletion, setPendingCompletion] = useState<PrayerCompletionRequest | null>(null);
  const [permissionState, setPermissionState] = useState<PrayerReminderPermissionState>('unsupported');
  const [lastReminderError, setLastReminderError] = useState<string | null>(null);
  const [lastNotificationKey, setLastNotificationKey] = useState<string | null>(null);
  const [adhanPrayer, setAdhanPrayer] = useState<PrayerTime | null>(null);
  const trackingRef = useRef(tracking);
  const gamificationRef = useRef(gamificationCtx.gamification);
  const todayRef = useRef(toLocalDateStr(now));
  const refreshSequenceRef = useRef(0);
  const reminderReconcileQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reminderReconcileVersionRef = useRef(0);
  const reminderInventoryInitializedRef = useRef(false);
  const recoveringRewardKeysRef = useRef(new Set<string>());
  const scheduledGroupsRef = useRef(new Map<string, ScheduledPrayerReminderGroup>());
  const scheduledGroupNamesRef = useRef(new Map<string, PrayerName[]>());
  const shownAdhanKeysRef = useRef(new Set<string>());
  const attemptingBoundedKeysRef = useRef(new Set<string>());
  const permissionDeferredBoundedKeysRef = useRef(new Set<string>());
  const [reminderListenerReady, setReminderListenerReady] = useState(false);

  useEffect(() => () => {
    // Invalidate in-flight schedule requests before React tears down the test/app tree.
    refreshSequenceRef.current += 1;
  }, []);

  const prayerEnabled = settingsCtx.settings.prayerEnabled !== false;
  const reminderEnabled = settingsCtx.settings.prayerReminderEnabled !== false;
  const reminderMinutes = settingsCtx.settings.prayerReminderMinutes ?? PRAYER_REMINDERS.DEFAULT_MINUTES;
  const city = settingsCtx.settings.prayerCity || 'Bedford';
  const country = settingsCtx.settings.prayerCountry || 'United Kingdom';
  const localTimezone = settingsCtx.appTimeZone.browserTimeZone;
  const scheduleTimezone = validatePrayerTimeZone(schedule?.timezone || '');
  const scheduleTimezoneValid = Boolean(scheduleTimezone);
  const timezoneMatches = Boolean(scheduleTimezone && localTimezone && scheduleTimezone === localTimezone);
  const today = scheduleTimezone
    ? getPrayerZonedDate(now, scheduleTimezone) ?? toLocalDateStr(now)
    : toLocalDateStr(now);
  const reminderScheduleList = useMemo(
    () => Object.values(reminderSchedules),
    [reminderSchedules],
  );
  const reminderTimezonesValid = reminderScheduleList.length > 0
    && reminderScheduleList.every(candidate => Boolean(validatePrayerTimeZone(candidate.timezone || '')));

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  useEffect(() => {
    gamificationRef.current = gamificationCtx.gamification;
  }, [gamificationCtx.gamification]);

  const commitTracking = useCallback((
    update: PrayerTrackingState | ((current: PrayerTrackingState) => PrayerTrackingState),
  ): PrayerTrackingState => {
    const next = typeof update === 'function' ? update(trackingRef.current) : update;
    trackingRef.current = next;
    setTracking(next);
    return next;
  }, []);

  useEffect(() => {
    if (!taskCtx.loaded || !gamificationCtx.loaded) return;
    let cancelled = false;

    void loadStore<unknown>('prayerTracking').then(value => {
      if (cancelled) return;
      const normalized = normalizePrayerTrackingState(value, {
        now: new Date(),
        dailyLog: gamificationCtx.gamification.dailyLog,
        prayerCompletionLedger: gamificationCtx.gamification.prayerCompletionLedger,
        tasks: taskCtx.tasks,
      });
      trackingRef.current = normalized;
      setTracking(normalized);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
    // Initial migration intentionally uses the first fully loaded task/profile snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamificationCtx.loaded, taskCtx.loaded]);

  useRemoteStoreRefresh(['prayerTracking'], async () => {
    const value = await loadStore<unknown>('prayerTracking');
    const normalized = normalizePrayerTrackingState(value, {
      now: new Date(),
      dailyLog: gamificationCtx.gamification.dailyLog,
      prayerCompletionLedger: gamificationCtx.gamification.prayerCompletionLedger,
      tasks: taskCtx.tasks,
    });
    trackingRef.current = normalized;
    setTracking(normalized);
  });

  useEffect(() => {
    if (loaded) void saveStore('prayerTracking', tracking);
  }, [loaded, tracking]);

  const refreshSchedule = useCallback(async (forceRefresh: boolean) => {
    if (!prayerEnabled) {
      setSchedule(null);
      setScheduleStatus('idle');
      setScheduleError(null);
      return;
    }

    const sequence = ++refreshSequenceRef.current;
    setScheduleStatus(current => current === 'ready' ? current : 'loading');
    setScheduleError(null);
    try {
      const data = await getPrayerTimes(city, country, { forceRefresh });
      if (sequence !== refreshSequenceRef.current) return;
      const timezone = validatePrayerTimeZone(data.timezone);
      const currentPrayerDate = timezone ? getPrayerZonedDate(new Date(), timezone) : null;
      if (!timezone || !currentPrayerDate) {
        throw new Error('Prayer schedule timezone is invalid or missing.');
      }
      if (data.date !== currentPrayerDate) {
        throw new Error(`Prayer schedule is for ${data.date}, not the current schedule date.`);
      }
      setSchedule(data);
      setReminderSchedules(current => {
        const previousDate = shiftPrayerDate(data.date, -1);
        return {
          ...(previousDate && current[previousDate] ? { [previousDate]: current[previousDate] } : {}),
          [data.date]: data,
        };
      });
      setScheduleStatus('ready');
    } catch (error) {
      if (sequence !== refreshSequenceRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setSchedule(null);
      setScheduleStatus('unavailable');
      setScheduleError(message);
      logError('PrayerSchedule', error);
    }
  }, [city, country, prayerEnabled]);

  const retrySchedule = useCallback(
    () => refreshSchedule(true),
    [refreshSchedule],
  );

  useEffect(() => {
    setSchedule(null);
    setReminderSchedules({});
    void refreshSchedule(false);
    // Location and enablement own the schedule lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country, prayerEnabled]);

  useEffect(() => {
    const tick = () => {
      const nextNow = new Date();
      const nextToday = scheduleTimezone
        ? getPrayerZonedDate(nextNow, scheduleTimezone) ?? toLocalDateStr(nextNow)
        : toLocalDateStr(nextNow);
      setNow(nextNow);
      if (todayRef.current !== nextToday) {
        todayRef.current = nextToday;
        setSchedule(null);
        void refreshSchedule(true);
      }
    };
    const interval = window.setInterval(tick, PRAYER_REMINDERS.RUNTIME_TICK_MS);
    return () => window.clearInterval(interval);
  }, [refreshSchedule, scheduleTimezone]);

  useEffect(() => {
    const resume = () => {
      setNow(new Date());
      void refreshSchedule(true);
      void getPrayerReminderPermission().then(setPermissionState);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refreshSchedule]);

  useEffect(() => {
    void getPrayerReminderPermission().then(setPermissionState);
  }, []);

  useEffect(() => {
    if (!loaded || !schedule || !scheduleTimezoneValid) return;
    commitTracking(current => {
      if (current.activationDayEligibility) return current;
      return capturePrayerActivationDayEligibility(current, {
        date: schedule.date,
        timezone: schedule.timezone,
        prayers: schedule.prayers,
      });
    });
  }, [commitTracking, loaded, schedule, scheduleTimezoneValid]);

  const schedulePolicy = useMemo(() => buildPrayerSchedulePolicySnapshot({
    schedule: scheduleTimezoneValid ? schedule : null,
    tracking,
    today,
    now,
  }), [now, schedule, scheduleTimezoneValid, today, tracking]);
  const { scheduleDays, stats, deadlines, nextPrayer } = schedulePolicy;

  useEffect(() => {
    if (!loaded || !reminderTimezonesValid) return;
    const next = classifyExpiredPrayerOutcomes({
      schedules: reminderSchedules,
      tracking,
      today,
      now,
    });
    if (next !== tracking) commitTracking(next);
  }, [commitTracking, loaded, now, reminderSchedules, reminderTimezonesValid, today, tracking]);

  const cancelScheduledReminderForPrayer = useCallback((
    prayerDate: string,
    prayerName: PrayerName,
  ) => {
    for (const [groupKey, scheduled] of scheduledGroupsRef.current) {
      if (scheduled.prayerDate !== prayerDate || !scheduled.prayerNames.includes(prayerName)) continue;
      scheduledGroupsRef.current.delete(groupKey);
      scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
      void cancelPrayerReminder({
        prayerDate: scheduled.prayerDate,
        prayerName: scheduled.leader,
        deadlineIso: scheduled.deadlineIso,
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        setLastReminderError(message);
        logError('PrayerReminderCancel', error);
      });
    }
  }, []);

  const completePrayer = useCallback((
    prayerName: PrayerName,
    status: PrayerCompletionStatus,
    options: CompletePrayerOptions = {},
  ): PrayerCompletionMutationResult => {
    const completedAt = new Date();
    const prayerDate = options.prayerDate || today;
    const source = options.source || 'system';
    const transition = buildPrayerCompletionTransition({
      prayerName,
      status,
      prayerDate,
      source,
      completedAt,
      taskId: options.taskId,
      tasks: taskCtx.tasks,
      tracking: trackingRef.current,
      gamification: gamificationRef.current,
      goalTags: settingsCtx.settings.goalTags,
      knowledge: {
        knowledgeEntries: knowledge.knowledgeEntries.length,
        knowledgeTopics: knowledge.knowledgeTopics.length,
        lifestyleHaramMastered: knowledge.lifestyleItems.filter(
          item => item.type === 'haram' && item.status === 'mastered',
        ).length,
        lifestyleHalalConsistent: knowledge.lifestyleItems.filter(
          item => item.type === 'halal' && item.status === 'consistent',
        ).length,
        lifestyleTotal: knowledge.lifestyleItems.length,
      },
      scheduleTimeZone: scheduleTimezone,
    });

    // Both stores retain the canonical receipt. Hydration can repair either
    // side after an interrupted multi-store write without granting XP twice.
    commitTracking(transition.trackingAfter);
    gamificationRef.current = transition.gamificationAfter;
    gamificationCtx.updateGamification(transition.gamificationAfter);

    if (transition.taskCompletion && transition.task) {
      taskCtx.updateTask(transition.task.id, {
        completed: transition.taskCompletion.after.completed,
        completedAt: transition.taskCompletion.after.completedAt,
        ...(transition.task.recurring
          ? {
              recurring: {
                ...transition.task.recurring,
                lastReset: transition.taskCompletion.after.recurringLastReset,
              },
            }
          : {}),
      });
    }

    cancelScheduledReminderForPrayer(prayerDate, prayerName);
    return {
      undo: transition.undo,
      xpEarned: transition.xpEarned,
      status,
      prayerName,
      prayerDate,
      gamificationResult: transition.gamificationResult,
    };
  }, [
    commitTracking,
    cancelScheduledReminderForPrayer,
    gamificationCtx,
    knowledge.knowledgeEntries.length,
    knowledge.knowledgeTopics.length,
    knowledge.lifestyleItems,
    settingsCtx.settings.goalTags,
    scheduleTimezone,
    taskCtx,
    today,
  ]);

  useEffect(() => {
    if (!loaded) return;
    for (const record of Object.values(tracking.records)) {
      if (
        (record.status !== 'on_time' && record.status !== 'late')
        || record.rewarded !== true
      ) {
        continue;
      }
      const rewardKey = getPrayerRecordKey(record.date, record.prayerName);
      if (
        gamificationRef.current.prayerCompletionLedger?.[rewardKey]?.rewarded
        || recoveringRewardKeysRef.current.has(rewardKey)
      ) {
        continue;
      }

      recoveringRewardKeysRef.current.add(rewardKey);
      try {
        completePrayer(record.prayerName, record.status, {
          prayerDate: record.date,
          source: record.source || 'system',
          ...(record.taskId ? { taskId: record.taskId } : {}),
        });
      } finally {
        recoveringRewardKeysRef.current.delete(rewardKey);
      }
    }
  }, [completePrayer, loaded, tracking.records]);

  const requestPrayerCompletion = useCallback((
    prayerName: PrayerName,
    options: Omit<PrayerCompletionRequest, 'prayerName' | 'suggestedStatus'> = {
      source: 'system',
    },
  ) => {
    const prayerDate = options.prayerDate || today;
    const bounds = schedule && scheduleTimezoneValid
      ? getPrayerDeadlineBounds(schedule.prayers, prayerDate, prayerName, schedule.timezone)
      : null;
    const suggestedStatus = bounds
      ? getPrayerCompletionStatusAt(bounds.deadlineAt, new Date())
      : null;
    setPendingCompletion({
      ...options,
      prayerDate,
      prayerName,
      suggestedStatus,
    });
  }, [schedule, scheduleTimezoneValid, today]);

  const cancelPrayerCompletion = useCallback(() => {
    setPendingCompletion(null);
  }, []);

  const confirmPrayerCompletion = useCallback((status: PrayerCompletionStatus) => {
    const pending = pendingCompletion;
    if (!pending) return null;
    const result = completePrayer(pending.prayerName, status, {
      taskId: pending.taskId,
      prayerDate: pending.prayerDate,
      source: pending.source,
    });
    setPendingCompletion(null);
    pending.onCompleted?.(result);
    return result;
  }, [completePrayer, pendingCompletion]);

  const correctPrayerOutcome = useCallback((
    prayerDate: string,
    prayerName: PrayerName,
    status: PrayerOutcomeStatus,
  ) => {
    const correctedAt = new Date();
    const transition = buildPrayerCorrectionTransition({
      prayerDate,
      prayerName,
      status,
      correctedAt,
      tasks: taskCtx.tasks,
      tracking: trackingRef.current,
      gamification: gamificationRef.current,
    });
    commitTracking(transition.trackingAfter);
    cancelScheduledReminderForPrayer(prayerDate, prayerName);
    gamificationRef.current = transition.gamificationAfter;
    gamificationCtx.updateGamification(transition.gamificationAfter);

    if (prayerDate === today && transition.targetTask) {
      taskCtx.updateTask(transition.targetTask.id, {
        completed: transition.completed,
        completedAt: transition.completed
          ? correctedAt.toISOString()
          : undefined,
      });
    }
  }, [cancelScheduledReminderForPrayer, commitTracking, gamificationCtx, taskCtx, today]);

  const getOutcome = useCallback(
    (prayerDate: string, prayerName: PrayerName) => getPrayerOutcome(tracking, prayerDate, prayerName),
    [tracking],
  );

  const undoPrayerCompletion = useCallback((inverse: PrayerCompletionUndoData) => {
    const transition = applyPrayerCompletionUndo(
      trackingRef.current,
      gamificationRef.current,
      inverse,
    );
    commitTracking(transition.trackingAfter);
    gamificationRef.current = transition.gamificationAfter;
    gamificationCtx.updateGamification(transition.gamificationAfter);
  }, [commitTracking, gamificationCtx]);

  const replacePrayerTracking = useCallback((state: PrayerTrackingState) => {
    commitTracking(normalizePrayerTrackingState(state, { now: new Date() }));
  }, [commitTracking]);

  const reminderGroups = useMemo(
    () => buildPrayerReminderGroups({
      schedules: reminderScheduleList,
      tracking,
      today,
      now,
      reminderMinutes,
    }),
    [now, reminderMinutes, reminderScheduleList, today, tracking],
  );

  const activeReminder = useMemo(() => {
    if (!prayerEnabled || !reminderEnabled || !reminderTimezonesValid) return null;
    return selectActivePrayerReminder(reminderGroups, tracking, now);
  }, [
    now,
    prayerEnabled,
    reminderEnabled,
    reminderGroups,
    reminderTimezonesValid,
    tracking,
  ]);

  const boundedReminderPlans = useMemo(() => {
    if (!prayerEnabled || !schedule || !scheduleTimezoneValid || !momentumCtx.loaded) return [];
    return buildBoundedReminderPlan({
      prayerDate: today,
      schedule: schedule.prayers,
      timeZone: schedule.timezone,
      tracking,
      momentum: momentumCtx.state,
      reminderMinutes,
    }).filter(plan => plan.kind === 'momentum' || reminderEnabled);
  }, [
    momentumCtx.loaded,
    momentumCtx.state,
    prayerEnabled,
    reminderEnabled,
    reminderMinutes,
    schedule,
    scheduleTimezoneValid,
    today,
    tracking,
  ]);
  const boundedReminderPlansRef = useRef<readonly BoundedReminderPlan[]>(boundedReminderPlans);
  useEffect(() => {
    boundedReminderPlansRef.current = boundedReminderPlans;
  }, [boundedReminderPlans]);

  const activeBoundedReminder = useMemo(() => getActiveBoundedReminder(
    boundedReminderPlans,
    tracking.boundedReminderReceipts,
    now,
  ), [boundedReminderPlans, now, tracking.boundedReminderReceipts]);

  const canSnoozeActiveBoundedReminder = useMemo(() => activeBoundedReminder
    ? canSnoozeBoundedReminder(
      tracking,
      activeBoundedReminder,
      new Date(now.getTime() + PRAYER_REMINDERS.SNOOZE_MINUTES * 60_000),
    )
    : false, [activeBoundedReminder, now, tracking]);

  useEffect(() => {
    if (!loaded || boundedReminderPlans.length === 0) return;
    const attemptable = getAttemptableBoundedReminders(
      boundedReminderPlans,
      tracking.boundedReminderReceipts,
      now,
    ).filter(plan => (
      !attemptingBoundedKeysRef.current.has(plan.notificationKey)
      && !(
        permissionState !== 'granted'
        && permissionDeferredBoundedKeysRef.current.has(plan.notificationKey)
      )
    ));
    if (attemptable.length === 0) return;
    for (const plan of attemptable) attemptingBoundedKeysRef.current.add(plan.notificationKey);

    void (async () => {
      const permission = await getPrayerReminderPermission();
      setPermissionState(permission);
      if (permission === 'granted') permissionDeferredBoundedKeysRef.current.clear();
      for (const plan of attemptable) {
        let notified = false;
        try {
          const currentPlan = boundedReminderPlansRef.current.find(candidate => (
            candidate.notificationKey === plan.notificationKey
          ));
          const attemptedAt = new Date();
          if (!currentPlan || getAttemptableBoundedReminders(
            [currentPlan],
            trackingRef.current.boundedReminderReceipts,
            attemptedAt,
          ).length === 0) {
            continue;
          }
          if (permission !== 'granted') {
            permissionDeferredBoundedKeysRef.current.add(currentPlan.notificationKey);
            setLastNotificationKey(currentPlan.notificationKey);
            continue;
          }

          const attemptedState = recordBoundedReminderAttempt(
            trackingRef.current,
            currentPlan,
            attemptedAt,
            false,
          );
          await saveStoreCommitted('prayerTracking', attemptedState);
          commitTracking(attemptedState);
          notified = await sendPrayerNotification({ title: currentPlan.title, body: currentPlan.body });
          if (notified) {
            const notifiedState = recordBoundedReminderAttempt(
              trackingRef.current,
              currentPlan,
              attemptedAt,
              true,
            );
            await saveStoreCommitted('prayerTracking', notifiedState);
            commitTracking(notifiedState);
          }
          setLastNotificationKey(currentPlan.notificationKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setLastReminderError(message);
          logError('BoundedReminder', error);
        } finally {
          attemptingBoundedKeysRef.current.delete(plan.notificationKey);
        }
      }
    })();
  }, [
    boundedReminderPlans,
    commitTracking,
    loaded,
    now,
    permissionState,
    tracking.boundedReminderReceipts,
  ]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setReminderListenerReady(false);

    void onPrayerReminderFired(event => {
      setLastNotificationKey(event.key);
      if (event.error) setLastReminderError(event.error);
      if (event.testOnly) return;
      const prayerNames = scheduledGroupNamesRef.current.get(event.key) || [event.prayerName];
      scheduledGroupNamesRef.current.delete(event.key);
      for (const [groupKey, scheduled] of scheduledGroupsRef.current) {
        if (scheduled.reminderKey === event.key) {
          scheduledGroupsRef.current.delete(groupKey);
        }
      }
      commitTracking(current => {
        let next = current;
        for (const prayerName of prayerNames) {
          next = setPrayerReminderReceipt(next, {
            date: event.prayerDate,
            prayerName,
            deadlineAt: event.deadlineIso,
            notifiedAt: event.firedAtIso,
          });
        }
        return next;
      });
      setNow(new Date());
    }).then(nextUnsubscribe => {
      if (disposed) {
        nextUnsubscribe();
      } else {
        unsubscribe = nextUnsubscribe;
        setReminderListenerReady(true);
      }
    }).catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      setLastReminderError(message);
      logError('PrayerReminderListener', error);
    });

    return () => {
      disposed = true;
      setReminderListenerReady(false);
      unsubscribe?.();
    };
  }, [commitTracking]);

  useEffect(() => {
    const enabled = loaded
      && prayerEnabled
      && reminderEnabled
      && reminderListenerReady
      && reminderTimezonesValid;
    const desired = new Map<string, ScheduledPrayerReminderGroup>();
    if (enabled) {
      for (const group of reminderGroups) {
        const scheduled = buildScheduledPrayerReminderGroup(group, tracking);
        if (scheduled) desired.set(scheduled.groupKey, scheduled);
      }
    }

    const reconcileVersion = ++reminderReconcileVersionRef.current;
    reminderReconcileQueueRef.current = reminderReconcileQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (reconcileVersion !== reminderReconcileVersionRef.current) return;

        if (!reminderInventoryInitializedRef.current) {
          try {
            // Clear the in-memory browser timer inventory once, then rebuild it
            // from persisted outcomes for this page session.
            await cancelAllPrayerReminders();
            reminderInventoryInitializedRef.current = true;
            scheduledGroupsRef.current.clear();
            scheduledGroupNamesRef.current.clear();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLastReminderError(message);
            logError('PrayerReminderInventoryReset', error);
            return;
          }
        }

        if (!enabled) {
          if (scheduledGroupsRef.current.size > 0) {
            try {
              await cancelAllPrayerReminders();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              setLastReminderError(message);
              logError('PrayerReminderCancelAll', error);
            }
          }
          scheduledGroupsRef.current.clear();
          scheduledGroupNamesRef.current.clear();
          return;
        }

        for (const [groupKey, current] of [...scheduledGroupsRef.current]) {
          const replacement = desired.get(groupKey);
          if (replacement?.signature === current.signature) continue;

          scheduledGroupsRef.current.delete(groupKey);
          scheduledGroupNamesRef.current.delete(current.reminderKey);
          if (replacement?.reminderKey === current.reminderKey) continue;

          try {
            await cancelPrayerReminder({
              prayerDate: current.prayerDate,
              prayerName: current.leader,
              deadlineIso: current.deadlineIso,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setLastReminderError(message);
            logError('PrayerReminderCancel', error);
          }
        }

        if (reconcileVersion !== reminderReconcileVersionRef.current) return;

        for (const [groupKey, scheduled] of desired) {
          const current = scheduledGroupsRef.current.get(groupKey);
          if (current?.signature === scheduled.signature) continue;

          scheduledGroupsRef.current.set(groupKey, scheduled);
          scheduledGroupNamesRef.current.set(scheduled.reminderKey, [...scheduled.prayerNames]);
          try {
            const result = await schedulePrayerReminder({
              prayerDate: scheduled.prayerDate,
              prayerName: scheduled.leader,
              deadlineIso: scheduled.deadlineIso,
              fireAtIso: scheduled.fireAtIso,
              title: scheduled.title,
              body: scheduled.body,
            });
            setLastNotificationKey(result.key);
            if (result.status === 'expired' && scheduledGroupsRef.current.get(groupKey) === scheduled) {
              scheduledGroupsRef.current.delete(groupKey);
              scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
            }
          } catch (error) {
            if (scheduledGroupsRef.current.get(groupKey) === scheduled) {
              scheduledGroupsRef.current.delete(groupKey);
              scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
            }
            const message = error instanceof Error ? error.message : String(error);
            setLastReminderError(message);
            logError('PrayerReminder', error);
          }
        }
      });
  }, [
    loaded,
    prayerEnabled,
    reminderEnabled,
    reminderListenerReady,
    reminderGroups,
    reminderTimezonesValid,
    tracking,
  ]);

  const snoozeActiveReminder = useCallback(() => {
    if (!activeReminder || !activeReminder.canSnooze) return;
    const snoozedUntil = new Date(Date.now() + PRAYER_REMINDERS.SNOOZE_MINUTES * 60_000);
    if (snoozedUntil >= activeReminder.deadlineAt) return;

    let next = trackingRef.current;
    for (const prayerName of activeReminder.prayerNames) {
      next = setPrayerReminderReceipt(next, {
        date: activeReminder.prayerDate,
        prayerName,
        deadlineAt: activeReminder.deadlineAt,
        snoozedUntil,
      });
    }
    commitTracking(next);
  }, [activeReminder, commitTracking]);

  const snoozeActiveBoundedReminder = useCallback(() => {
    if (!activeBoundedReminder) return;
    const snoozedUntil = new Date(now.getTime() + PRAYER_REMINDERS.SNOOZE_MINUTES * 60_000);
    if (!canSnoozeBoundedReminder(trackingRef.current, activeBoundedReminder, snoozedUntil)) return;
    commitTracking(current => snoozeBoundedReminder(current, activeBoundedReminder, snoozedUntil));
  }, [activeBoundedReminder, commitTracking, now]);

  const requestReminderPermission = useCallback(async () => {
    const result = await requestPrayerReminderPermission();
    if (result === 'granted') permissionDeferredBoundedKeysRef.current.clear();
    setPermissionState(result === 'granted' ? 'granted' : result === 'unsupported' ? 'unsupported' : 'not_granted');
    return result;
  }, []);

  const testReminder = useCallback(async (prayerName: PrayerName = 'Fajr') => {
    const permission = await getPrayerReminderPermission();
    setPermissionState(permission);
    if (permission !== 'granted') return false;

    const reference = new Date();
    const fireAt = new Date(reference.getTime() + PRAYER_REMINDERS.TEST_DELAY_MS);
    const deadline = new Date(reference.getTime() + PRAYER_REMINDERS.TEST_DEADLINE_MS);
    try {
      const result = await schedulePrayerReminder({
        prayerDate: scheduleTimezone
          ? getPrayerZonedDate(reference, scheduleTimezone) ?? toLocalDateStr(reference)
          : toLocalDateStr(reference),
        prayerName,
        deadlineIso: deadline.toISOString(),
        fireAtIso: fireAt.toISOString(),
        title: `TEST — ${prayerName} deadline reminder`,
        body: 'Minimized-window timer test only. No prayer outcome, receipt, or XP was changed.',
        testOnly: true,
      });
      setLastNotificationKey(result.key);
      return result.status === 'scheduled';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastReminderError(message);
      logError('PrayerReminderTest', error);
      return false;
    }
  }, [scheduleTimezone]);

  useEffect(() => {
    if (!prayerEnabled || !schedule || !scheduleTimezoneValid) return;
    const adhan = isAdhanTime(schedule.prayers, now, schedule.timezone);
    if (!adhan) return;
    const key = `${today}:${adhan.name}`;
    if (shownAdhanKeysRef.current.has(key)) return;
    shownAdhanKeysRef.current.add(key);
    setAdhanPrayer(adhan);
  }, [now, prayerEnabled, schedule, scheduleTimezoneValid, today]);

  const dismissAdhan = useCallback(() => setAdhanPrayer(null), []);

  const nextReminderGroup = reminderGroups.find(group => group.deadlineAt > now) || null;
  const suppressionReason = !prayerEnabled
    ? 'Prayer times are disabled.'
    : !reminderEnabled
      ? 'Deadline reminders are disabled.'
      : scheduleStatus !== 'ready' || !schedule
        ? 'No matching current-day prayer schedule is available.'
        : !scheduleTimezone
          ? 'The schedule timezone could not be verified.'
          : reminderGroups.length === 0
              ? 'No incomplete prayer is currently eligible.'
              : null;
  const diagnostics = useMemo<PrayerDiagnostics>(() => ({
    scheduleStatus,
    scheduleDate: schedule?.date || null,
    scheduleSource: schedule?.source || null,
    fetchedAt: schedule?.fetchedAt || null,
    location: `${city}, ${country}`,
    method: schedule?.method || null,
    scheduleTimezone: scheduleTimezone || null,
    localTimezone,
    timezoneMatches,
    scheduleTimezoneValid,
    nextReminderAt: nextReminderGroup?.fireAt.toISOString() || null,
    suppressionReason,
    permissionState,
    lastNotificationKey,
    lastError: lastReminderError || scheduleError,
  }), [
    city,
    country,
    localTimezone,
    lastNotificationKey,
    lastReminderError,
    nextReminderGroup,
    permissionState,
    schedule,
    scheduleError,
    scheduleStatus,
    scheduleTimezone,
    scheduleTimezoneValid,
    suppressionReason,
    timezoneMatches,
  ]);

  const value = useMemo<PrayerContextValue>(() => ({
    loaded,
    tracking,
    schedule,
    scheduleStatus,
    scheduleError,
    now,
    today,
    localTimezone,
    timezoneMatches,
    scheduleTimezoneValid,
    scheduleDays,
    stats,
    deadlines,
    nextPrayer,
    pendingCompletion,
    activeReminder,
    activeBoundedReminder,
    canSnoozeActiveBoundedReminder,
    adhanPrayer,
    diagnostics,
    requestPrayerCompletion,
    cancelPrayerCompletion,
    confirmPrayerCompletion,
    completePrayer,
    correctPrayerOutcome,
    getOutcome,
    undoPrayerCompletion,
    replacePrayerTracking,
    snoozeActiveReminder,
    snoozeActiveBoundedReminder,
    retrySchedule,
    requestReminderPermission,
    testReminder,
    dismissAdhan,
  }), [
    activeReminder,
    activeBoundedReminder,
    adhanPrayer,
    cancelPrayerCompletion,
    canSnoozeActiveBoundedReminder,
    completePrayer,
    confirmPrayerCompletion,
    correctPrayerOutcome,
    deadlines,
    localTimezone,
    diagnostics,
    dismissAdhan,
    getOutcome,
    loaded,
    nextPrayer,
    now,
    pendingCompletion,
    replacePrayerTracking,
    requestPrayerCompletion,
    requestReminderPermission,
    retrySchedule,
    schedule,
    scheduleDays,
    scheduleError,
    scheduleStatus,
    snoozeActiveReminder,
    snoozeActiveBoundedReminder,
    stats,
    testReminder,
    timezoneMatches,
    scheduleTimezoneValid,
    today,
    tracking,
    undoPrayerCompletion,
  ]);

  return <PrayerCtx.Provider value={value}>{children}</PrayerCtx.Provider>;
}
