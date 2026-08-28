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
  GamificationProfile,
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
  Task,
} from '../../types/domain';
import { PRAYER_REMINDERS } from '../../config/constants';
import {
  buildCompletionContext,
  levelFromXp,
  processTaskCompletion,
  recordHabitCompletion,
  type CompletionResult,
} from '../../services/gamification';
import { toLocalDateStr } from '../../services/financeHelpers';
import {
  formatPrayerInstantTime,
  getPrayerZonedDate,
  shiftPrayerDate,
  validatePrayerTimeZone,
} from '../../services/prayerTimeZone';
import {
  CANONICAL_PRAYER_NAMES,
  calculatePrayerOutcomeStats,
  capturePrayerActivationDayEligibility,
  createPrayerTrackingState,
  getPrayerCompletionStatusAt,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  getPrayerRecordKey,
  getPrayerRewardLogId,
  getPrayerReminderKey as getTrackingReminderKey,
  isPrayerOpportunityTracked,
  normalizePrayerTrackingState,
  setPrayerOutcome,
  setPrayerReminderReceipt,
} from '../../services/prayerTracking';
import {
  cancelAllPrayerReminders,
  cancelPrayerReminder,
  getPrayerReminderPermission,
  getPrayerReminderKey as getBrowserReminderKey,
  onPrayerReminderFired,
  requestPrayerReminderPermission,
  schedulePrayerReminder,
  sendPrayerNotification,
  type PrayerReminderPermissionRequestResult,
  type PrayerReminderPermissionState,
} from '../../services/browserPrayerReminder';
import {
  getNextPrayer,
  getPrayerTimes,
  isAdhanTime,
  type PrayerTime,
  type PrayerTimesData,
} from '../../services/prayerTimes';
import { getPrayerTaskName } from '../../services/prayerTasks';
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

export interface PrayerReminderGroup {
  prayerDate: string;
  prayerNames: PrayerName[];
  deadlineName: PrayerDeadlineBounds['deadlineName'];
  deadlineAt: Date;
  minutesRemaining: number;
  canSnooze: boolean;
  timezone: string;
}

interface ScheduledReminderGroup {
  groupKey: string;
  signature: string;
  prayerDate: string;
  prayerNames: PrayerName[];
  leader: PrayerName;
  deadlineIso: string;
  fireAtIso: string;
  reminderKey: string;
  title: string;
  body: string;
}

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

function buildScheduleDays(
  schedule: PrayerTimesData | null,
  trackingStartedAt: string,
  today: string,
): PrayerScheduleDay[] {
  if (!schedule) return [];

  const start = new Date(trackingStartedAt);
  if (!Number.isFinite(start.getTime())) return [];
  const firstDate = toLocalDateStr(start);
  if (firstDate > today) return [];

  const prayers = schedule.prayers.map(({ name, time }) => ({ name, time }));
  const days: PrayerScheduleDay[] = [];
  let cursor = firstDate;
  while (cursor <= today) {
    days.push({ date: cursor, timezone: schedule.timezone, prayers });
    const next = shiftPrayerDate(cursor, 1);
    if (!next) return [];
    cursor = next;
  }
  return days;
}

export function canonicalizeTimezone(timezone: string): string {
  // Validate the explicit zone without asking a potentially overridden Intl
  // implementation to rewrite it through resolvedOptions().
  return validatePrayerTimeZone(timezone);
}

function getMatchingPrayerTasks(tasks: Task[], prayerName: PrayerName): Task[] {
  return tasks.filter(task => getPrayerTaskName(task) === prayerName);
}

function getReminderGroups(
  schedules: readonly PrayerTimesData[],
  tracking: PrayerTrackingState,
  today: string,
  now: Date,
  reminderMinutes: number,
): Array<PrayerReminderGroup & { fireAt: Date }> {
  const scheduleByDate = new Map(schedules.map(schedule => [schedule.date, schedule]));
  const previousDate = shiftPrayerDate(today, -1);
  const candidates = previousDate ? [previousDate, today] : [today];
  const reminders: Array<PrayerReminderGroup & { fireAt: Date }> = [];

  for (const prayerDate of candidates) {
    const schedule = scheduleByDate.get(prayerDate);
    if (!schedule) continue;
    const scheduleEntries = schedule.prayers.map(({ name, time }) => ({ name, time }));

    for (const prayerName of CANONICAL_PRAYER_NAMES) {
      const outcome = getPrayerOutcome(tracking, prayerDate, prayerName);
      if (outcome) continue;

      const bounds = getPrayerDeadlineBounds(
        scheduleEntries,
        prayerDate,
        prayerName,
        schedule.timezone,
      );
      if (!bounds || now >= bounds.deadlineAt) continue;

      const fireAt = new Date(bounds.deadlineAt.getTime() - reminderMinutes * 60_000);
      const minutesRemaining = Math.max(0, (bounds.deadlineAt.getTime() - now.getTime()) / 60_000);
      reminders.push({
        prayerDate,
        prayerNames: [prayerName],
        deadlineName: bounds.deadlineName,
        deadlineAt: bounds.deadlineAt,
        fireAt,
        minutesRemaining,
        canSnooze: minutesRemaining > PRAYER_REMINDERS.SNOOZE_CUTOFF_MINUTES,
        timezone: schedule.timezone,
      });
    }
  }

  return reminders.sort((left, right) => left.deadlineAt.getTime() - right.deadlineAt.getTime());
}

function buildScheduledReminderGroup(
  group: PrayerReminderGroup & { fireAt: Date },
  tracking: PrayerTrackingState,
): ScheduledReminderGroup | null {
  const prayerNames = group.prayerNames.filter(prayerName => {
    const receiptKey = getTrackingReminderKey(group.prayerDate, prayerName, group.deadlineAt);
    return !tracking.reminderReceipts[receiptKey];
  });
  if (prayerNames.length === 0) return null;

  const leader = prayerNames[0];
  const deadlineIso = group.deadlineAt.toISOString();
  const fireAtIso = group.fireAt.toISOString();
  const groupKey = `${group.prayerDate}:${leader}:${group.deadlineAt.getTime()}`;
  const reminderKey = getBrowserReminderKey({
    prayerDate: group.prayerDate,
    prayerName: leader,
    deadlineIso,
  });
  const names = prayerNames.join(' and ');
  const title = `${names} prayer due soon`;
  const body = `Pray ${names} before ${group.deadlineName} at ${formatPrayerInstantTime(
    group.deadlineAt,
    group.timezone,
  )}.`;

  return {
    groupKey,
    signature: [leader, prayerNames.join(','), deadlineIso, fireAtIso, title, body].join('|'),
    prayerDate: group.prayerDate,
    prayerNames,
    leader,
    deadlineIso,
    fireAtIso,
    reminderKey,
    title,
    body,
  };
}

function prayerRecordsEqual(
  left: PrayerTrackingRecord | undefined,
  right: PrayerTrackingRecord | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.date === right.date
    && left.prayerName === right.prayerName
    && left.status === right.status
    && left.recordedAt === right.recordedAt
    && left.rewarded === right.rewarded
    && left.taskId === right.taskId
    && left.source === right.source;
}

function profilesEqual(left: GamificationProfile, right: GamificationProfile): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function reverseHabitTallyDelta(
  current: Record<string, number> | undefined,
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
): Record<string, number> {
  const next = { ...(current || {}) };
  const changedIds = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  for (const taskId of changedIds) {
    const delta = (after?.[taskId] || 0) - (before?.[taskId] || 0);
    if (delta === 0) continue;
    const value = Math.max(0, (next[taskId] || 0) - delta);
    if (value > 0) next[taskId] = value;
    else delete next[taskId];
  }
  return next;
}

function reverseDailyLogDelta(
  current: Record<string, string[]> | undefined,
  before: Record<string, string[]> | undefined,
  after: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const next = Object.fromEntries(
    Object.entries(current || {}).map(([date, taskIds]) => [date, [...taskIds]]),
  );
  const changedDates = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const date of changedDates) {
    const beforeIds = new Set(before?.[date] || []);
    const afterIds = new Set(after?.[date] || []);
    const currentIds = new Set(next[date] || []);
    for (const taskId of afterIds) {
      if (!beforeIds.has(taskId)) currentIds.delete(taskId);
    }
    for (const taskId of beforeIds) {
      if (!afterIds.has(taskId)) currentIds.add(taskId);
    }
    if (currentIds.size > 0) next[date] = [...currentIds];
    else delete next[date];
  }
  return next;
}

function reversePrayerLedgerDelta(
  current: GamificationProfile['prayerCompletionLedger'],
  before: GamificationProfile['prayerCompletionLedger'],
  after: GamificationProfile['prayerCompletionLedger'],
): NonNullable<GamificationProfile['prayerCompletionLedger']> {
  const next = { ...(current || {}) };
  const changedKeys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  for (const key of changedKeys) {
    const beforeEntry = before?.[key];
    const afterEntry = after?.[key];
    if (JSON.stringify(beforeEntry) === JSON.stringify(afterEntry)) continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(afterEntry)) continue;
    if (beforeEntry) next[key] = beforeEntry;
    else delete next[key];
  }
  return next;
}

function reversePrayerGamification(
  current: GamificationProfile,
  inverse: PrayerCompletionUndoData,
): GamificationProfile {
  const { gamificationBefore: before, gamificationAfter: after } = inverse;
  if (profilesEqual(current, after)) return before;

  const totalXp = Math.max(0, current.totalXp - (after.totalXp - before.totalXp));
  return {
    ...current,
    totalXp,
    level: levelFromXp(totalXp),
    totalTasksCompleted: Math.max(
      0,
      current.totalTasksCompleted - (after.totalTasksCompleted - before.totalTasksCompleted),
    ),
    habitTallies: reverseHabitTallyDelta(
      current.habitTallies,
      before.habitTallies,
      after.habitTallies,
    ),
    dailyLog: reverseDailyLogDelta(
      current.dailyLog,
      before.dailyLog,
      after.dailyLog,
    ),
    prayerCompletionLedger: reversePrayerLedgerDelta(
      current.prayerCompletionLedger,
      before.prayerCompletionLedger,
      after.prayerCompletionLedger,
    ),
  };
}

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
  const scheduledGroupsRef = useRef(new Map<string, ScheduledReminderGroup>());
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
  const localTimezone = canonicalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const scheduleTimezone = canonicalizeTimezone(schedule?.timezone || '');
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
    && reminderScheduleList.every(candidate => Boolean(canonicalizeTimezone(candidate.timezone || '')));

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
      const timezone = canonicalizeTimezone(data.timezone);
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

  const scheduleDays = useMemo(
    () => buildScheduleDays(scheduleTimezoneValid ? schedule : null, tracking.trackingStartedAt, today),
    [schedule, scheduleTimezoneValid, today, tracking.trackingStartedAt],
  );
  const stats = useMemo(
    () => calculatePrayerOutcomeStats(tracking, scheduleDays, now),
    [now, scheduleDays, tracking],
  );
  const deadlines = useMemo(() => Object.fromEntries(
    CANONICAL_PRAYER_NAMES.map(prayerName => [
      prayerName,
      schedule && scheduleTimezoneValid
        ? getPrayerDeadlineBounds(schedule.prayers, today, prayerName, schedule.timezone)
        : null,
    ]),
  ) as Record<PrayerName, PrayerDeadlineBounds | null>, [schedule, scheduleTimezoneValid, today]);
  const nextPrayer = schedule && scheduleTimezoneValid
    ? getNextPrayer(schedule.prayers, now, schedule.timezone)
    : null;

  useEffect(() => {
    if (!loaded || !reminderTimezonesValid) return;
    let next = tracking;
    let changed = false;

    const previousDate = shiftPrayerDate(today, -1);
    for (const prayerDate of previousDate ? [previousDate, today] : [today]) {
      const daySchedule = reminderSchedules[prayerDate];
      if (!daySchedule) continue;
      const scheduleDay = {
        date: prayerDate,
        timezone: daySchedule.timezone,
        prayers: daySchedule.prayers,
      };
      for (const prayerName of CANONICAL_PRAYER_NAMES) {
        if (getPrayerOutcome(next, prayerDate, prayerName)) continue;
        const bounds = getPrayerDeadlineBounds(
          daySchedule.prayers,
          prayerDate,
          prayerName,
          daySchedule.timezone,
        );
        if (
          !bounds
          || !isPrayerOpportunityTracked(next, scheduleDay, prayerName, now)
          || now < bounds.deadlineAt
        ) continue;
        next = setPrayerOutcome(next, {
          date: prayerDate,
          prayerName,
          status: 'missed',
          recordedAt: now,
          source: 'system',
        });
        changed = true;
      }
    }

    if (changed) commitTracking(next);
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
    const prayerDate = options.prayerDate || toLocalDateStr(completedAt);
    const source = options.source || 'system';
    const trackingBefore = trackingRef.current;
    const gamificationBefore = gamificationRef.current;
    const matchingTasks = getMatchingPrayerTasks(taskCtx.tasks, prayerName);
    const task = matchingTasks.find(candidate => candidate.id === options.taskId) || matchingTasks[0];
    const existingOutcome = getPrayerOutcome(trackingBefore, prayerDate, prayerName);
    const rewardKey = getPrayerRecordKey(prayerDate, prayerName);
    const canonicalLogId = getPrayerRewardLogId(prayerName);
    const relevantLogIds = new Set([
      canonicalLogId,
      ...matchingTasks.map(candidate => candidate.id),
      ...(existingOutcome?.taskId ? [existingOutcome.taskId] : []),
    ]);
    const rewardLogId = task?.id || existingOutcome?.taskId || canonicalLogId;
    const dayLog = gamificationBefore.dailyLog?.[prayerDate] || [];
    const alreadyRewarded = Boolean(
      gamificationBefore.prayerCompletionLedger?.[rewardKey]?.rewarded
      || dayLog.some(taskId => relevantLogIds.has(taskId)),
    );

    const nextTracking = setPrayerOutcome(trackingBefore, {
      date: prayerDate,
      prayerName,
      status,
      rewarded: true,
      taskId: task?.id,
      source,
      recordedAt: completedAt,
    });

    const taskCompletion = task && prayerDate === toLocalDateStr(completedAt)
      ? {
          taskId: task.id,
          before: {
            completed: task.completed,
            ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
            ...(task.recurring?.lastReset !== undefined
              ? { recurringLastReset: task.recurring.lastReset }
              : {}),
          },
          after: {
            completed: true,
            completedAt: completedAt.toISOString(),
            ...(task.recurring ? { recurringLastReset: prayerDate } : {}),
          },
        }
      : undefined;

    let xpEarned = 0;
    let gamificationResult: CompletionResult | undefined;
    const cleanedDayLog = dayLog.filter(taskId => !relevantLogIds.has(taskId));
    const baseDailyLog = { ...(gamificationBefore.dailyLog || {}) };
    if (cleanedDayLog.length > 0) baseDailyLog[prayerDate] = cleanedDayLog;
    else delete baseDailyLog[prayerDate];
    let gamificationAfter: GamificationProfile = {
      ...gamificationBefore,
      dailyLog: baseDailyLog,
    };

    if (!alreadyRewarded) {
      const todayForXp = toLocalDateStr(completedAt);
      const completionsToday = taskCtx.tasks.filter(candidate =>
        candidate.completed && candidate.completedAt && toLocalDateStr(new Date(candidate.completedAt)) === todayForXp
      ).length;
      const completionContext = buildCompletionContext(
        taskCtx.tasks,
        settingsCtx.settings.goalTags,
        todayForXp,
        gamificationBefore,
        {
          knowledgeEntries: knowledge.knowledgeEntries.length,
          knowledgeTopics: knowledge.knowledgeTopics.length,
          lifestyleHaramMastered: knowledge.lifestyleItems.filter(item => item.type === 'haram' && item.status === 'mastered').length,
          lifestyleHalalConsistent: knowledge.lifestyleItems.filter(item => item.type === 'halal' && item.status === 'consistent').length,
          lifestyleTotal: knowledge.lifestyleItems.length,
        },
      );
      const result = processTaskCompletion(
        gamificationAfter,
        task || { priority: 'medium', category: 'prayer' },
        completionsToday,
        completedAt,
        completionContext,
      );
      gamificationResult = result;
      xpEarned = result.xpEarned;
      gamificationAfter = recordHabitCompletion(result.updatedProfile, rewardLogId, prayerDate);
    } else {
      gamificationAfter = {
        ...gamificationAfter,
        dailyLog: {
          ...(gamificationAfter.dailyLog || {}),
          [prayerDate]: [...cleanedDayLog, rewardLogId],
        },
      };
    }

    gamificationAfter = {
      ...gamificationAfter,
      prayerCompletionLedger: {
        ...(gamificationAfter.prayerCompletionLedger || {}),
        [rewardKey]: {
          date: prayerDate,
          prayerName,
          status,
          recordedAt: completedAt.toISOString(),
          rewarded: true,
          ...(task?.id ? { taskId: task.id } : {}),
          source,
        },
      },
    };

    // Both stores retain the canonical receipt. Hydration can repair either
    // side after an interrupted multi-store write without granting XP twice.
    commitTracking(nextTracking);
    gamificationRef.current = gamificationAfter;
    gamificationCtx.updateGamification(gamificationAfter);

    if (taskCompletion) {
      taskCtx.updateTask(task.id, {
        completed: taskCompletion.after.completed,
        completedAt: taskCompletion.after.completedAt,
        ...(task.recurring
          ? { recurring: { ...task.recurring, lastReset: taskCompletion.after.recurringLastReset } }
          : {}),
      });
    }

    cancelScheduledReminderForPrayer(prayerDate, prayerName);
    const outcomeAfter = getPrayerOutcome(nextTracking, prayerDate, prayerName);
    if (!outcomeAfter) {
      throw new Error(`Prayer outcome was not recorded for ${prayerName} on ${prayerDate}.`);
    }

    return {
      undo: {
        prayerDate,
        prayerName,
        ...(taskCompletion ? { taskCompletion } : {}),
        ...(existingOutcome ? { outcomeBefore: existingOutcome } : {}),
        outcomeAfter,
        gamificationBefore,
        gamificationAfter,
      },
      xpEarned,
      status,
      prayerName,
      prayerDate,
      gamificationResult,
    };
  }, [
    commitTracking,
    cancelScheduledReminderForPrayer,
    gamificationCtx,
    knowledge.knowledgeEntries.length,
    knowledge.knowledgeTopics.length,
    knowledge.lifestyleItems,
    settingsCtx.settings.goalTags,
    taskCtx,
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
    const matchingTasks = getMatchingPrayerTasks(taskCtx.tasks, prayerName);
    const current = trackingRef.current;
    const existingRecord = getPrayerOutcome(current, prayerDate, prayerName);
    const targetTask = matchingTasks[0];
    const canonicalLogId = getPrayerRewardLogId(prayerName);
    const targetLogId = targetTask?.id || existingRecord?.taskId || canonicalLogId;
    const relevantLogIds = new Set([
      canonicalLogId,
      ...matchingTasks.map(task => task.id),
      ...(existingRecord?.taskId ? [existingRecord.taskId] : []),
    ]);
    const correctedAt = new Date();
    commitTracking(setPrayerOutcome(current, {
      date: prayerDate,
      prayerName,
      status,
      taskId: targetTask?.id,
      source: 'history',
      recordedAt: correctedAt,
    }));
    cancelScheduledReminderForPrayer(prayerDate, prayerName);

    const currentProfile = gamificationRef.current;
    const existingLog = currentProfile.dailyLog?.[prayerDate] || [];
    const completed = status === 'on_time' || status === 'late' || status === 'unclassified';
    const cleanedLog = existingLog.filter(taskId => !relevantLogIds.has(taskId));
    const nextDayLog = completed ? [...cleanedLog, targetLogId] : cleanedLog;
    const nextDailyLog = { ...(currentProfile.dailyLog || {}) };
    if (nextDayLog.length > 0) nextDailyLog[prayerDate] = nextDayLog;
    else delete nextDailyLog[prayerDate];
    const rewardKey = getPrayerRecordKey(prayerDate, prayerName);
    const previousLedger = currentProfile.prayerCompletionLedger?.[rewardKey];
    const nextProfile = {
      ...currentProfile,
      dailyLog: nextDailyLog,
      prayerCompletionLedger: {
        ...(currentProfile.prayerCompletionLedger || {}),
        [rewardKey]: {
          date: prayerDate,
          prayerName,
          status,
          recordedAt: correctedAt.toISOString(),
          rewarded: previousLedger?.rewarded === true || existingRecord?.rewarded === true,
          ...(targetTask?.id ? { taskId: targetTask.id } : {}),
          source: 'history',
        },
      },
    };
    gamificationRef.current = nextProfile;
    gamificationCtx.updateGamification(nextProfile);

    if (prayerDate === toLocalDateStr(correctedAt) && targetTask) {
      taskCtx.updateTask(targetTask.id, {
        completed,
        completedAt: completed
          ? correctedAt.toISOString()
          : undefined,
      });
    }
  }, [cancelScheduledReminderForPrayer, commitTracking, gamificationCtx, taskCtx]);

  const getOutcome = useCallback(
    (prayerDate: string, prayerName: PrayerName) => getPrayerOutcome(tracking, prayerDate, prayerName),
    [tracking],
  );

  const undoPrayerCompletion = useCallback((inverse: PrayerCompletionUndoData) => {
    commitTracking(current => {
      const key = getPrayerRecordKey(inverse.prayerDate, inverse.prayerName);
      const currentOutcome = current.records[key];
      if (!prayerRecordsEqual(currentOutcome, inverse.outcomeAfter)) {
        throw new Error(
          `${inverse.prayerName} on ${inverse.prayerDate} changed after completion and was not undone.`,
        );
      }

      const records = { ...current.records };
      if (inverse.outcomeBefore) records[key] = inverse.outcomeBefore;
      else delete records[key];
      return { ...current, records };
    });

    const nextProfile = reversePrayerGamification(gamificationRef.current, inverse);
    gamificationRef.current = nextProfile;
    gamificationCtx.updateGamification(nextProfile);
  }, [commitTracking, gamificationCtx]);

  const replacePrayerTracking = useCallback((state: PrayerTrackingState) => {
    commitTracking(normalizePrayerTrackingState(state, { now: new Date() }));
  }, [commitTracking]);

  const reminderGroups = useMemo(
    () => getReminderGroups(reminderScheduleList, tracking, today, now, reminderMinutes),
    [now, reminderMinutes, reminderScheduleList, today, tracking],
  );

  const activeReminder = useMemo(() => {
    if (!prayerEnabled || !reminderEnabled || !reminderTimezonesValid) return null;
    const active = reminderGroups.find(group => {
      if (now < group.fireAt || now >= group.deadlineAt) return false;
      return group.prayerNames.some(prayerName => {
        const receiptKey = getTrackingReminderKey(group.prayerDate, prayerName, group.deadlineAt);
        const snoozedUntil = tracking.reminderReceipts[receiptKey]?.snoozedUntil;
        return !snoozedUntil || now >= new Date(snoozedUntil);
      });
    });
    if (!active) return null;
    const alreadySnoozed = active.prayerNames.some(prayerName => {
      const receiptKey = getTrackingReminderKey(active.prayerDate, prayerName, active.deadlineAt);
      return Boolean(tracking.reminderReceipts[receiptKey]?.snoozedUntil);
    });
    return { ...active, canSnooze: active.canSnooze && !alreadySnoozed };
  }, [
    now,
    prayerEnabled,
    reminderEnabled,
    reminderGroups,
    reminderTimezonesValid,
    tracking.reminderReceipts,
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
    const desired = new Map<string, ScheduledReminderGroup>();
    if (enabled) {
      for (const group of reminderGroups) {
        const scheduled = buildScheduledReminderGroup(group, tracking);
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
