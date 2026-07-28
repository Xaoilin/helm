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
  getPrayerReminderKey as getNativeReminderKey,
  onPrayerReminderFired,
  requestPrayerReminderPermission,
  schedulePrayerReminder,
  sendPrayerNotification,
  type PrayerReminderPermissionRequestResult,
  type PrayerReminderPermissionState,
} from '../../services/nativePrayerReminder';
import {
  getNextPrayer,
  getPrayerTimes,
  isAdhanTime,
  type PrayerTime,
  type PrayerTimesData,
} from '../../services/prayerTimes';
import { getPrayerTaskName } from '../../services/prayerTasks';
import { logError } from '../../services/logger';
import { loadStore, saveStore } from '../persistence';
import { useGamificationContext } from './GamificationContext';
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
}

interface ScheduledReminderGroup {
  groupKey: string;
  signature: string;
  prayerDate: string;
  prayerNames: PrayerName[];
  leader: PrayerName;
  deadlineIso: string;
  fireAtIso: string;
  nativeKey: string;
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
  desktopTimezone: string;
  timezoneMatches: boolean;
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
  desktopTimezone: string;
  timezoneMatches: boolean;
  scheduleDays: PrayerScheduleDay[];
  stats: PrayerOutcomeStats;
  deadlines: Record<PrayerName, PrayerDeadlineBounds | null>;
  nextPrayer: ReturnType<typeof getNextPrayer>;
  pendingCompletion: PrayerCompletionRequest | null;
  activeReminder: PrayerReminderGroup | null;
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
  retrySchedule: () => Promise<void>;
  requestReminderPermission: () => Promise<PrayerReminderPermissionRequestResult>;
  testReminder: (prayerName?: PrayerName) => Promise<boolean>;
  dismissAdhan: () => void;
}

const PrayerCtx = createContext<PrayerContextValue | null>(null);

function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function shiftLocalDate(date: string, days: number): string {
  const shifted = parseLocalDate(date);
  shifted.setDate(shifted.getDate() + days);
  return toLocalDateStr(shifted);
}

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
  const cursor = parseLocalDate(firstDate);
  const end = parseLocalDate(today);
  while (cursor <= end) {
    days.push({ date: toLocalDateStr(cursor), prayers });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function canonicalizeTimezone(timezone: string): string {
  if (!timezone) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return timezone;
  }
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
  const candidates = [shiftLocalDate(today, -1), today];
  const grouped = new Map<string, PrayerReminderGroup & { fireAt: Date }>();

  for (const prayerDate of candidates) {
    const schedule = scheduleByDate.get(prayerDate);
    if (!schedule) continue;
    const scheduleEntries = schedule.prayers.map(({ name, time }) => ({ name, time }));

    for (const prayerName of CANONICAL_PRAYER_NAMES) {
      const outcome = getPrayerOutcome(tracking, prayerDate, prayerName);
      if (outcome) continue;

      const bounds = getPrayerDeadlineBounds(scheduleEntries, prayerDate, prayerName);
      if (!bounds || now >= bounds.deadlineAt) continue;

      const fireAt = new Date(bounds.deadlineAt.getTime() - reminderMinutes * 60_000);
      const key = `${prayerDate}:${bounds.deadlineAt.toISOString()}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.prayerNames.push(prayerName);
        continue;
      }

      const minutesRemaining = Math.max(0, (bounds.deadlineAt.getTime() - now.getTime()) / 60_000);
      grouped.set(key, {
        prayerDate,
        prayerNames: [prayerName],
        deadlineName: bounds.deadlineName,
        deadlineAt: bounds.deadlineAt,
        fireAt,
        minutesRemaining,
        canSnooze: minutesRemaining > PRAYER_REMINDERS.SNOOZE_CUTOFF_MINUTES,
      });
    }
  }

  return [...grouped.values()].sort((left, right) => left.deadlineAt.getTime() - right.deadlineAt.getTime());
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
  const groupKey = `${group.prayerDate}:${group.deadlineAt.getTime()}`;
  const nativeKey = getNativeReminderKey({
    prayerDate: group.prayerDate,
    prayerName: leader,
    deadlineIso,
  });
  const names = prayerNames.join(' and ');
  const title = `${names} prayer due soon`;
  const body = `Pray ${names} before ${group.deadlineName} at ${group.deadlineAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}.`;

  return {
    groupKey,
    signature: [leader, prayerNames.join(','), deadlineIso, fireAtIso, title, body].join('|'),
    prayerDate: group.prayerDate,
    prayerNames,
    leader,
    deadlineIso,
    fireAtIso,
    nativeKey,
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
  const [reminderListenerReady, setReminderListenerReady] = useState(false);

  const today = toLocalDateStr(now);
  const prayerEnabled = settingsCtx.settings.prayerEnabled !== false;
  const reminderEnabled = settingsCtx.settings.prayerReminderEnabled !== false;
  const reminderMinutes = settingsCtx.settings.prayerReminderMinutes ?? PRAYER_REMINDERS.DEFAULT_MINUTES;
  const city = settingsCtx.settings.prayerCity || 'Bedford';
  const country = settingsCtx.settings.prayerCountry || 'United Kingdom';
  const desktopTimezone = canonicalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const scheduleTimezone = canonicalizeTimezone(schedule?.timezone || '');
  const timezoneMatches = Boolean(scheduleTimezone && desktopTimezone && scheduleTimezone === desktopTimezone);
  const reminderScheduleList = useMemo(
    () => Object.values(reminderSchedules),
    [reminderSchedules],
  );
  const reminderTimezonesMatch = reminderScheduleList.length > 0
    && reminderScheduleList.every(candidate =>
      canonicalizeTimezone(candidate.timezone || '') === desktopTimezone
    );

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
      if (data.date !== toLocalDateStr(new Date())) {
        throw new Error(`Prayer schedule is for ${data.date}, not the current local date.`);
      }
      setSchedule(data);
      setReminderSchedules(current => {
        const previousDate = shiftLocalDate(data.date, -1);
        return {
          ...(current[previousDate] ? { [previousDate]: current[previousDate] } : {}),
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
      const nextToday = toLocalDateStr(nextNow);
      setNow(nextNow);
      if (todayRef.current !== nextToday) {
        todayRef.current = nextToday;
        setSchedule(null);
        void refreshSchedule(true);
      }
    };
    const interval = window.setInterval(tick, PRAYER_REMINDERS.RUNTIME_TICK_MS);
    return () => window.clearInterval(interval);
  }, [refreshSchedule]);

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
    if (!loaded || !schedule || !timezoneMatches) return;
    commitTracking(current => {
      if (current.activationDayEligibility) return current;
      return capturePrayerActivationDayEligibility(current, {
        date: schedule.date,
        prayers: schedule.prayers,
      });
    });
  }, [commitTracking, loaded, schedule, timezoneMatches]);

  const scheduleDays = useMemo(
    () => buildScheduleDays(timezoneMatches ? schedule : null, tracking.trackingStartedAt, today),
    [schedule, timezoneMatches, today, tracking.trackingStartedAt],
  );
  const stats = useMemo(
    () => calculatePrayerOutcomeStats(tracking, scheduleDays, now),
    [now, scheduleDays, tracking],
  );
  const deadlines = useMemo(() => Object.fromEntries(
    CANONICAL_PRAYER_NAMES.map(prayerName => [
      prayerName,
      schedule && timezoneMatches
        ? getPrayerDeadlineBounds(schedule.prayers, today, prayerName)
        : null,
    ]),
  ) as Record<PrayerName, PrayerDeadlineBounds | null>, [schedule, timezoneMatches, today]);
  const nextPrayer = schedule && timezoneMatches ? getNextPrayer(schedule.prayers) : null;

  useEffect(() => {
    if (!loaded || !reminderTimezonesMatch) return;
    let next = tracking;
    let changed = false;

    for (const prayerDate of [shiftLocalDate(today, -1), today]) {
      const daySchedule = reminderSchedules[prayerDate];
      if (!daySchedule) continue;
      const scheduleDay = {
        date: prayerDate,
        prayers: daySchedule.prayers,
      };
      for (const prayerName of CANONICAL_PRAYER_NAMES) {
        if (getPrayerOutcome(next, prayerDate, prayerName)) continue;
        const bounds = getPrayerDeadlineBounds(daySchedule.prayers, prayerDate, prayerName);
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
  }, [commitTracking, loaded, now, reminderSchedules, reminderTimezonesMatch, today, tracking]);

  const cancelScheduledReminderForPrayer = useCallback((
    prayerDate: string,
    prayerName: PrayerName,
  ) => {
    for (const [groupKey, scheduled] of scheduledGroupsRef.current) {
      if (scheduled.prayerDate !== prayerDate || !scheduled.prayerNames.includes(prayerName)) continue;
      scheduledGroupsRef.current.delete(groupKey);
      scheduledGroupNamesRef.current.delete(scheduled.nativeKey);
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
    const prayerDate = options.prayerDate || toLocalDateStr(new Date());
    const bounds = schedule && timezoneMatches
      ? getPrayerDeadlineBounds(schedule.prayers, prayerDate, prayerName)
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
  }, [schedule, timezoneMatches]);

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
    if (!prayerEnabled || !reminderEnabled || !reminderTimezonesMatch) return null;
    return reminderGroups.find(group => {
      if (now < group.fireAt || now >= group.deadlineAt) return false;
      return group.prayerNames.some(prayerName => {
        const receiptKey = getTrackingReminderKey(group.prayerDate, prayerName, group.deadlineAt);
        const snoozedUntil = tracking.reminderReceipts[receiptKey]?.snoozedUntil;
        return !snoozedUntil || now >= new Date(snoozedUntil);
      });
    }) || null;
  }, [
    now,
    prayerEnabled,
    reminderEnabled,
    reminderGroups,
    reminderTimezonesMatch,
    tracking.reminderReceipts,
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
        if (scheduled.nativeKey === event.key) {
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
      && reminderTimezonesMatch;
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
            // A Tauri process timer can outlive a renderer reload. Clear the
            // process inventory once, then rebuild it from persisted outcomes.
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
          scheduledGroupNamesRef.current.delete(current.nativeKey);
          if (replacement?.nativeKey === current.nativeKey) continue;

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
          scheduledGroupNamesRef.current.set(scheduled.nativeKey, [...scheduled.prayerNames]);
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
              scheduledGroupNamesRef.current.delete(scheduled.nativeKey);
            }
          } catch (error) {
            if (scheduledGroupsRef.current.get(groupKey) === scheduled) {
              scheduledGroupsRef.current.delete(groupKey);
              scheduledGroupNamesRef.current.delete(scheduled.nativeKey);
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
    reminderTimezonesMatch,
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

  const requestReminderPermission = useCallback(async () => {
    const result = await requestPrayerReminderPermission();
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
        prayerDate: toLocalDateStr(reference),
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
  }, []);

  useEffect(() => {
    if (!prayerEnabled || !schedule || !timezoneMatches) return;
    const adhan = isAdhanTime(schedule.prayers);
    if (!adhan) return;
    const key = `${today}:${adhan.name}`;
    if (shownAdhanKeysRef.current.has(key)) return;
    shownAdhanKeysRef.current.add(key);
    setAdhanPrayer(adhan);
    void sendPrayerNotification({
      title: `${adhan.nameArabic} — ${adhan.name}`,
      body: `It is time for ${adhan.name} prayer.`,
    });
  }, [now, prayerEnabled, schedule, timezoneMatches, today]);

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
          : !timezoneMatches
            ? `Schedule timezone ${scheduleTimezone} does not match desktop timezone ${desktopTimezone}.`
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
    desktopTimezone,
    timezoneMatches,
    nextReminderAt: nextReminderGroup?.fireAt.toISOString() || null,
    suppressionReason,
    permissionState,
    lastNotificationKey,
    lastError: lastReminderError || scheduleError,
  }), [
    city,
    country,
    desktopTimezone,
    lastNotificationKey,
    lastReminderError,
    nextReminderGroup,
    permissionState,
    schedule,
    scheduleError,
    scheduleStatus,
    scheduleTimezone,
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
    desktopTimezone,
    timezoneMatches,
    scheduleDays,
    stats,
    deadlines,
    nextPrayer,
    pendingCompletion,
    activeReminder,
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
    retrySchedule,
    requestReminderPermission,
    testReminder,
    dismissAdhan,
  }), [
    activeReminder,
    adhanPrayer,
    cancelPrayerCompletion,
    completePrayer,
    confirmPrayerCompletion,
    correctPrayerOutcome,
    deadlines,
    desktopTimezone,
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
    stats,
    testReminder,
    timezoneMatches,
    today,
    tracking,
    undoPrayerCompletion,
  ]);

  return <PrayerCtx.Provider value={value}>{children}</PrayerCtx.Provider>;
}
