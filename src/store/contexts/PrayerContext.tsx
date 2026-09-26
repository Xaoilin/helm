import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
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
import { validatePrayerTimeZone } from '../../services/prayerTimeZone';
import { getPrayerOutcome, normalizePrayerTrackingState } from '../../services/prayerTracking';
import type { PrayerReminderPermissionRequestResult } from '../../services/browserPrayerReminder';
import type { getNextPrayer, PrayerTime, PrayerTimesData } from '../../services/prayerTimes';
import { countPrayerRewardKnowledge } from '../../services/prayerCompletionPolicy';
import type { PrayerReminderGroup } from '../../services/prayerReminderPolicy';
import {
  buildPrayerSchedulePolicySnapshot,
  reminderSchedulesHaveValidZones,
} from '../../services/prayerSchedulePolicy';
import type { BoundedReminderPlan } from '../../services/boundedReminders';
import {
  buildPrayerDiagnostics,
  describeReminderSuppression,
  findNextReminderAt,
  type PrayerDiagnostics,
} from '../../services/prayerDiagnostics';
import type { PrayerOutcomeRejection, PrayerServiceSyncState } from './usePrayerServiceSync';
import { useGamificationContext } from './GamificationContext';
import { useDailyMomentumContext } from './DailyMomentumContext';
import { useKnowledgeContext } from './KnowledgeContext';
import { useSettingsContext } from './SettingsContext';
import { useTaskContext } from './TaskContext';
import { usePrayerTracking } from './prayer/usePrayerTracking';
import { usePrayerSchedule } from './prayer/usePrayerSchedule';
import { usePrayerNotificationPermission } from './prayer/usePrayerNotificationPermission';
import { usePrayerClock } from './prayer/usePrayerClock';
import { usePrayerOutcomeUpkeep } from './prayer/usePrayerOutcomeUpkeep';
import { usePrayerReminderBanners } from './prayer/usePrayerReminderBanners';
import { usePrayerReminderDiagnostics } from './prayer/usePrayerReminderDiagnostics';
import { usePrayerDeadlineReminders } from './prayer/usePrayerDeadlineReminders';
import { usePrayerBoundedReminderNotifications } from './prayer/usePrayerBoundedReminderNotifications';
import {
  usePrayerCompletionWorkflow,
  type CompletePrayerOptions,
  type PrayerCompletionMutationResult,
} from './prayer/usePrayerCompletionWorkflow';
import { usePrayerPersistence } from './prayer/usePrayerPersistence';
import { usePrayerRewardRecovery } from './prayer/usePrayerRewardRecovery';
import {
  usePrayerCompletionPrompt,
  type PrayerCompletionRequest,
  type PrayerCompletionRequestOptions,
} from './prayer/usePrayerCompletionPrompt';
import { usePrayerAdhan } from './prayer/usePrayerAdhan';

export type { PrayerCompletionMutationResult } from './prayer/usePrayerCompletionWorkflow';
export type { PrayerCompletionRequest } from './prayer/usePrayerCompletionPrompt';
export type { PrayerReminderGroup } from '../../services/prayerReminderPolicy';
export type { PrayerDiagnostics } from '../../services/prayerDiagnostics';

export interface PrayerContextValue {
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
  /** Sync with the Spring Boot prayer service; `disabled` when it is not configured. */
  serviceSync: PrayerServiceSyncState;
  /** Why the last completion was refused or not saved; shown until dismissed. */
  completionNotice: string | null;
  dismissCompletionNotice: () => void;
  requestPrayerCompletion: (
    prayerName: PrayerName,
    options?: PrayerCompletionRequestOptions,
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

export const PrayerCtx = createContext<PrayerContextValue | null>(null);

export function usePrayerContext(): PrayerContextValue {
  const ctx = useContext(PrayerCtx);
  if (!ctx) throw new Error('usePrayerContext must be used within PrayerProvider');
  return ctx;
}

/**
 * Composes the prayer domain. Each hook under `./prayer/` owns one side effect
 * (clock, timetable, persistence, reminders, completion); business rules stay in
 * the pure `services/prayer*` policy modules. Hook order matters: React runs
 * their effects in this order.
 */
export function PrayerProvider({ children }: { children: ReactNode }) {
  const taskOwner = useTaskContext();
  const gamificationOwner = useGamificationContext();
  const momentumOwner = useDailyMomentumContext();
  const knowledge = useKnowledgeContext();
  const settingsOwner = useSettingsContext();

  const { settings } = settingsOwner;
  // Prayer preferences and location come from their services: wait for them, so the app never
  // briefly runs prayer features, or fetches a timetable, from defaults.
  const serviceSettingsReady = settingsOwner.serviceSettingsReady;
  const prayerEnabled = serviceSettingsReady && settings.prayerEnabled !== false;
  const reminderEnabled = settings.prayerReminderEnabled !== false;
  const reminderMinutes = settings.prayerReminderMinutes ?? PRAYER_REMINDERS.DEFAULT_MINUTES;
  const city = settings.prayerCity || 'Bedford';
  const country = settings.prayerCountry || 'United Kingdom';
  const localTimezone = settingsOwner.appTimeZone.browserTimeZone;

  // Tracking and timetable.
  const store = usePrayerTracking();
  const { tracking, loaded, getTracking, commitTracking } = store;
  const {
    schedule,
    reminderSchedules,
    status: scheduleStatus,
    error: scheduleError,
    retry: retrySchedule,
    reloadForNewDay,
  } = usePrayerSchedule({ city, country, prayerEnabled });
  const scheduleTimezone = validatePrayerTimeZone(schedule?.timezone || '');
  const scheduleTimezoneValid = Boolean(scheduleTimezone);
  const timezoneMatches = Boolean(scheduleTimezone && localTimezone && scheduleTimezone === localTimezone);
  const timetable = scheduleTimezoneValid ? schedule : null;
  const reminderScheduleList = useMemo(() => Object.values(reminderSchedules), [reminderSchedules]);
  const reminderSchedulesValid = reminderSchedulesHaveValidZones(reminderScheduleList);

  // Clock.
  const permission = usePrayerNotificationPermission();
  const { refresh: refreshPermission } = permission;
  const resume = useCallback(() => {
    void retrySchedule();
    void refreshPermission();
  }, [refreshPermission, retrySchedule]);
  const { now, today, getToday, touch } = usePrayerClock({
    scheduleTimeZone: scheduleTimezone,
    onDayChange: reloadForNewDay,
    onResume: resume,
  });

  const { scheduleDays, stats, deadlines, nextPrayer } = useMemo(() => buildPrayerSchedulePolicySnapshot({
    schedule: timetable,
    tracking,
    today,
    now,
  }), [now, timetable, today, tracking]);

  // Reminders: in-app banners, browser deadline timers, and bounded notifications.
  const {
    reminderGroups,
    boundedReminderPlans,
    activeReminder,
    activeBoundedReminder,
    canSnoozeActiveBoundedReminder,
    snoozeActiveReminder,
    snoozeActiveBoundedReminder,
  } = usePrayerReminderBanners({
    prayerEnabled,
    reminderEnabled,
    reminderMinutes,
    reminderSchedules: reminderScheduleList,
    reminderSchedulesValid,
    timetable,
    momentum: momentumOwner.loaded ? momentumOwner.state : null,
    tracking,
    getTracking,
    commitTracking,
    today,
    now,
  });
  const { lastNotificationKey, lastReminderError, reporter } = usePrayerReminderDiagnostics();
  const { cancelForPrayer, testReminder } = usePrayerDeadlineReminders({
    enabled: loaded && prayerEnabled && reminderEnabled && reminderSchedulesValid,
    reminderGroups,
    tracking,
    commitTracking,
    onFired: touch,
    refreshPermission,
    scheduleTimeZone: scheduleTimezone,
    reporter,
  });
  usePrayerBoundedReminderNotifications({
    loaded,
    plans: boundedReminderPlans,
    receipts: tracking.boundedReminderReceipts,
    getTracking,
    commitTracking,
    now,
    permission,
    reporter,
  });

  // Completion across prayer tracking, gamification and prayer tasks.
  const { knowledgeEntries, knowledgeTopics, lifestyleItems } = knowledge;
  const knowledgeCounts = useMemo(
    () => countPrayerRewardKnowledge({ knowledgeEntries, knowledgeTopics, lifestyleItems }),
    [knowledgeEntries, knowledgeTopics, lifestyleItems],
  );
  const {
    completePrayer,
    correctPrayerOutcome,
    undoPrayerCompletion,
    revertRefusedOutcome,
    getGamification,
  } = usePrayerCompletionWorkflow({
    taskOwner,
    gamificationOwner,
    knowledgeCounts,
    goalTags: settings.goalTags,
    timetable,
    scheduleTimeZone: scheduleTimezone,
    today,
    getToday,
    getTracking,
    commitTracking,
    cancelReminderForPrayer: cancelForPrayer,
  });

  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const dismissCompletionNotice = useCallback(() => setCompletionNotice(null), []);
  // The service refused an outcome outright: show the service's truth instead and say why.
  const rejectOutcome = useCallback((rejection: PrayerOutcomeRejection) => {
    revertRefusedOutcome(rejection);
    setCompletionNotice(`${rejection.record.prayerName} on ${rejection.record.date} was not saved: ${rejection.message}`);
  }, [revertRefusedOutcome]);

  // Persistence: the prayer service for outcomes, the account record for reminder receipts.
  // Rewards and tasks load first, so reward recovery never mistakes a missing receipt.
  const { serviceSync, reload: reloadOutcomes, allowBulkDelete } = usePrayerPersistence({
    store,
    sourcesLoaded: taskOwner.loaded && gamificationOwner.loaded && settingsOwner.loaded,
    locationReady: serviceSettingsReady,
    location: { city, country },
    onRejected: rejectOutcome,
  });
  usePrayerOutcomeUpkeep({
    loaded,
    tracking,
    reminderSchedules,
    reminderSchedulesValid,
    today,
    now,
    reload: reloadOutcomes,
  });
  usePrayerRewardRecovery({ loaded, records: tracking.records, getGamification, completePrayer });

  const {
    pendingCompletion,
    requestPrayerCompletion,
    cancelPrayerCompletion,
    confirmPrayerCompletion,
  } = usePrayerCompletionPrompt({ today, timetable, completePrayer, showNotice: setCompletionNotice });

  const getOutcome = useCallback(
    (prayerDate: string, prayerName: PrayerName) => getPrayerOutcome(tracking, prayerDate, prayerName),
    [tracking],
  );

  const replacePrayerTracking = useCallback((state: PrayerTrackingState) => {
    // Replacing the tracking (Settings → Reset all progress) is the one bulk deletion allowed.
    allowBulkDelete();
    commitTracking(normalizePrayerTrackingState(state, { now: new Date() }));
  }, [allowBulkDelete, commitTracking]);

  const { adhanPrayer, dismissAdhan } = usePrayerAdhan({ prayerEnabled, timetable, now, today });

  const nextReminderAt = findNextReminderAt(reminderGroups, now);
  const suppressionReason = describeReminderSuppression({
    prayerEnabled,
    reminderEnabled,
    scheduleStatus,
    schedule,
    scheduleTimezone,
    reminderGroupCount: reminderGroups.length,
  });
  const permissionState = permission.state;
  const diagnostics = useMemo(() => buildPrayerDiagnostics({
    scheduleStatus,
    schedule,
    scheduleError,
    city,
    country,
    scheduleTimezone,
    scheduleTimezoneValid,
    localTimezone,
    timezoneMatches,
    nextReminderAt,
    suppressionReason,
    permissionState,
    lastNotificationKey,
    lastReminderError,
  }), [
    city,
    country,
    lastNotificationKey,
    lastReminderError,
    localTimezone,
    nextReminderAt,
    permissionState,
    schedule,
    scheduleError,
    scheduleStatus,
    scheduleTimezone,
    scheduleTimezoneValid,
    suppressionReason,
    timezoneMatches,
  ]);

  const requestReminderPermission = permission.request;

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
    serviceSync,
    completionNotice,
    dismissCompletionNotice,
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
    completionNotice,
    confirmPrayerCompletion,
    correctPrayerOutcome,
    deadlines,
    diagnostics,
    dismissAdhan,
    dismissCompletionNotice,
    getOutcome,
    loaded,
    localTimezone,
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
    scheduleTimezoneValid,
    serviceSync,
    snoozeActiveBoundedReminder,
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
