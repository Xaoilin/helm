import { act, cleanup, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrayerProvider, usePrayerContext, type PrayerContextValue } from '../store/contexts/PrayerContext';
import { TaskCtx, type TaskContextValue } from '../store/contexts/TaskContext';
import { GamificationCtx, type GamificationContextValue } from '../store/contexts/GamificationContext';
import { DailyMomentumCtx, type DailyMomentumContextValue } from '../store/contexts/DailyMomentumContext';
import { SettingsCtx, defaultSettings, type SettingsContextValue } from '../store/contexts/SettingsContext';
import { ServiceError } from '../services/backend/serviceClient';
import { getPrayerRecordKey } from '../services/prayerTracking';
import { provide, renderWithContexts } from './renderWithContexts';
import { makeGamification, makeMomentumState, makeTask } from './fixtures';
import { makePrayerTimesData, PRAYER_TEST_DATE } from './prayerFixtures';

const persistence = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStore: vi.fn(async () => undefined),
  saveStoreCommitted: vi.fn(async () => undefined),
  subscribeStoreKey: vi.fn(() => () => undefined),
}));
vi.mock('../store/persistence', () => persistence);

const prayerService = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => true),
  getPrayerSchedule: vi.fn(),
  getPrayerDashboard: vi.fn(),
  listPrayerOutcomes: vi.fn(),
  createPrayerOutcome: vi.fn(),
  correctPrayerOutcome: vi.fn(),
  deletePrayerOutcome: vi.fn(),
  getPrayerReminders: vi.fn(),
  snoozePrayerReminder: vi.fn(),
  saveMomentumReminders: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => prayerService);

const planner = vi.hoisted(() => ({
  isPlannerServiceEnabled: vi.fn(() => true),
  syncPrayerRewards: vi.fn(),
}));
vi.mock('../services/backend/plannerServiceApi', () => planner);

const FAJR_KEY = getPrayerRecordKey(PRAYER_TEST_DATE, 'Fajr');
const DHUHR_KEY = getPrayerRecordKey(PRAYER_TEST_DATE, 'Dhuhr');
const serviceFajr = {
  id: '1c52385c-3d06-43e5-849f-8c9652ddf677', date: PRAYER_TEST_DATE, prayer: 'Fajr', status: 'on_time',
  recordedAt: '2026-09-26T05:30:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
};

/** The prayer service's timetable for the fixture day. */
function serviceSchedule() {
  const times = makePrayerTimesData();
  return {
    date: times.date, hijriDate: times.hijriDate, city: times.city, country: times.country,
    timezone: times.timezone, method: times.method,
    times: times.prayers.map(({ name, nameArabic, time, type }) => ({ name, nameArabic, time, type })),
    windows: [],
  };
}
/** The Dhuhr opportunity reminder the prayer service sent at 11:55Z; it runs until 12:25Z. */
const dhuhrOpportunity = {
  key: `opportunity:${PRAYER_TEST_DATE}:Dhuhr`, kind: 'prayer-opportunity', date: PRAYER_TEST_DATE, prayer: 'Dhuhr',
  pillars: [], firesAt: '2026-09-26T11:55:00Z', expiresAt: '2026-09-26T12:25:00Z', deadline: null,
  timeZone: 'Europe/London', reminderMinutes: 15, snoozedUntil: null, snoozeCount: 0,
};
/** What the prayer service holds for the fixture's Daily Momentum (both pillars off). */
const savedMomentum = [
  { pillar: 'learn', enabled: false, afterPrayers: [], completedOn: null },
  { pillar: 'move', enabled: false, afterPrayers: [], completedOn: null },
];
const dhuhrTask = makeTask({ id: 'task-dhuhr', title: 'Dhuhr Prayer', category: 'prayer', prayerName: 'Dhuhr' });

const VALUE_KEYS: (keyof PrayerContextValue)[] = [
  'loaded', 'tracking', 'schedule', 'scheduleStatus', 'scheduleError', 'now', 'today', 'localTimezone',
  'timezoneMatches', 'scheduleTimezoneValid', 'scheduleDays', 'stats', 'deadlines', 'nextPrayer',
  'pendingCompletion', 'activeReminder', 'activeBoundedReminder', 'reminderSnoozeError', 'adhanPrayer',
  'diagnostics', 'serviceSync', 'completionNotice', 'dismissCompletionNotice', 'requestPrayerCompletion',
  'cancelPrayerCompletion', 'confirmPrayerCompletion', 'completePrayer', 'correctPrayerOutcome', 'getOutcome',
  'undoPrayerCompletion', 'replacePrayerTracking', 'snoozeActiveReminder', 'snoozeActiveBoundedReminder',
  'retrySchedule', 'requestReminderPermission', 'testReminder', 'dismissAdhan',
];

let prayer: PrayerContextValue;

function PrayerProbe() {
  const current = usePrayerContext();
  useEffect(() => { prayer = current; }, [current]);
  return null;
}

function fakeOwners() {
  const tasks = {
    tasks: [dhuhrTask], loaded: true, showPrayerHabit: vi.fn(), applyTask: vi.fn(),
  } as unknown as TaskContextValue;
  const gamification = {
    gamification: makeGamification(), loaded: true, applyProfile: vi.fn(),
  } as unknown as GamificationContextValue;
  const momentum = {
    state: makeMomentumState(), loaded: true, saving: false, error: null,
  } as unknown as DailyMomentumContextValue;
  const settings = {
    settings: defaultSettings,
    integrations: [],
    loaded: true,
    appTimeZone: { browserTimeZone: 'Europe/London', effectiveTimeZone: 'Europe/London', source: 'automatic' },
    appTimeZoneLoadWarning: null,
    serviceSettingsReady: true,
    updateSettings: vi.fn(),
    saveAppTimeZonePreference: vi.fn(),
    updateIntegration: vi.fn(),
  } as SettingsContextValue;
  return { tasks, gamification, momentum, settings };
}

function renderPrayerProvider(owners = fakeOwners()) {
  renderWithContexts(<PrayerProvider><PrayerProbe /></PrayerProvider>, [
    provide(SettingsCtx, owners.settings),
    provide(GamificationCtx, owners.gamification),
    provide(DailyMomentumCtx, owners.momentum),
    provide(TaskCtx, owners.tasks),
  ]);
  return owners;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Dhuhr started at 11:55Z (its opportunity reminder runs until 12:25Z); it is on time until Asr, 15:20Z.
  vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
  vi.clearAllMocks();
  prayerService.isPrayerServiceEnabled.mockReturnValue(true);
  prayerService.getPrayerSchedule.mockResolvedValue(serviceSchedule());
  prayerService.getPrayerDashboard.mockResolvedValue({
    today: PRAYER_TEST_DATE,
    tracking: {
      trackingStartedAt: '2026-09-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: null,
    },
  });
  prayerService.listPrayerOutcomes.mockResolvedValue([serviceFajr]);
  prayerService.createPrayerOutcome.mockImplementation(async (request: { prayer: string; status: string }) => ({
    outcome: { ...serviceFajr, id: crypto.randomUUID(), prayer: request.prayer, status: request.status },
    firstReward: true,
  }));
  prayerService.getPrayerReminders.mockResolvedValue({ active: [dhuhrOpportunity], momentum: savedMomentum });
  prayerService.saveMomentumReminders.mockImplementation(async (pillars: unknown) => pillars);
  persistence.loadStore.mockResolvedValue(null);
  planner.syncPrayerRewards.mockResolvedValue({
    reward: { xpEarned: 25, level: 1, leveledUp: false, title: 'Beginner', newBadges: [], currentStreak: 1,
      streakMilestone: false },
    task: { ...dhuhrTask, completed: true },
    profile: { ...makeGamification(), totalXp: 25 },
  });
});

describe('PrayerProvider', () => {
  it('loads outcomes and the timetable from the prayer service and publishes the same value shape', async () => {
    renderPrayerProvider();

    await waitFor(() => expect(prayer.loaded).toBe(true));
    await waitFor(() => expect(prayer.scheduleStatus).toBe('ready'));
    await waitFor(() => expect(prayer.serviceSync.status).toBe('synced'));
    expect(prayerService.getPrayerSchedule).toHaveBeenCalledWith('Bedford', 'United Kingdom', undefined);
    expect(Object.keys(prayer).sort()).toEqual([...VALUE_KEYS].sort());
    expect(prayer.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' });
    expect(prayer.getOutcome(PRAYER_TEST_DATE, 'Fajr')).toMatchObject({ status: 'on_time' });
    expect(prayer.today).toBe(PRAYER_TEST_DATE);
    expect(prayer.schedule?.date).toBe(PRAYER_TEST_DATE);
    expect(prayer.scheduleTimezoneValid).toBe(true);
    expect(prayer.timezoneMatches).toBe(true);
    expect(prayer.deadlines.Dhuhr?.deadlineName).toBe('Asr');
    expect(prayer.nextPrayer?.prayer.name).toBe('Asr');
    expect(prayer.diagnostics).toMatchObject({
      scheduleStatus: 'ready',
      location: 'Bedford, United Kingdom',
      scheduleTimezone: 'Europe/London',
      permissionState: 'unsupported',
      suppressionReason: null,
    });
    // The prayer service's reminders fall back to the in-app banner without notification support.
    await waitFor(() => expect(prayer.activeBoundedReminder?.title).toBe('Dhuhr prayer opportunity'));
    expect(prayer.diagnostics.activeReminders.map(reminder => reminder.key)).toEqual([dhuhrOpportunity.key]);
    expect(prayer.activeReminder).toBeNull();
    // Nothing reads or writes the retired account record, and unchanged momentum preferences are not re-sent.
    expect(persistence.loadStore).not.toHaveBeenCalledWith('prayerTracking');
    expect(persistence.saveStore).not.toHaveBeenCalled();
    expect(persistence.saveStoreCommitted).not.toHaveBeenCalled();
    expect(prayerService.saveMomentumReminders).not.toHaveBeenCalled();
  });

  it('completes a prayer, saves it to the prayer service, then shows the XP the planner granted', async () => {
    const owners = renderPrayerProvider();
    await waitFor(() => expect(prayer.scheduleStatus).toBe('ready'));
    await waitFor(() => expect(prayer.serviceSync.status).toBe('synced'));

    act(() => { prayer.requestPrayerCompletion('Dhuhr', { source: 'dashboard' }); });
    await waitFor(() => expect(prayer.pendingCompletion).toMatchObject({ prayerName: 'Dhuhr', suggestedStatus: 'on_time' }));

    let rewarded: ReturnType<PrayerContextValue['confirmPrayerCompletion']> = null;
    act(() => { rewarded = prayer.confirmPrayerCompletion('on_time'); });

    await waitFor(() => expect(prayer.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'on_time' }));
    expect(prayer.pendingCompletion).toBeNull();
    // Recording the prayer hides its reminder.
    expect(prayer.activeBoundedReminder).toBeNull();
    expect(owners.tasks.showPrayerHabit).toHaveBeenCalledWith('task-dhuhr', true);
    await waitFor(() => expect(prayerService.createPrayerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ date: PRAYER_TEST_DATE, prayer: 'Dhuhr', status: 'on_time' }),
      expect.stringMatching(/^prayer-outcome:create:/u),
    ));
    // Once the prayer service confirmed it, the planner rewards it once and says what it earned.
    await expect(rewarded).resolves.toMatchObject({ prayerName: 'Dhuhr', status: 'on_time', xpEarned: 25 });
    expect(planner.syncPrayerRewards).toHaveBeenCalledWith(PRAYER_TEST_DATE, 'Dhuhr');
    expect(owners.gamification.applyProfile).toHaveBeenCalledWith(expect.objectContaining({ totalXp: 25 }));
    expect(owners.tasks.applyTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-dhuhr', completed: true }));
  });

  it('snoozes the reminder through the prayer service, and shows why it refused a second snooze', async () => {
    prayerService.snoozePrayerReminder.mockResolvedValueOnce({
      ...dhuhrOpportunity, snoozedUntil: '2026-09-26T12:05:00Z', snoozeCount: 1,
    });
    renderPrayerProvider();
    await waitFor(() => expect(prayer.activeBoundedReminder?.canSnooze).toBe(true));

    act(() => prayer.snoozeActiveBoundedReminder());

    await waitFor(() => expect(prayer.activeBoundedReminder).toBeNull());
    expect(prayerService.snoozePrayerReminder).toHaveBeenCalledWith(dhuhrOpportunity.key);

    // Another tab still shows it unsnoozed; the service refuses the second snooze.
    cleanup();
    prayerService.getPrayerReminders.mockResolvedValue({ active: [dhuhrOpportunity], momentum: savedMomentum });
    prayerService.snoozePrayerReminder.mockRejectedValueOnce(
      new ServiceError(409, 'snooze_used', 'This reminder has already been snoozed once.'));
    renderPrayerProvider();
    await waitFor(() => expect(prayer.activeBoundedReminder?.canSnooze).toBe(true));
    act(() => prayer.snoozeActiveBoundedReminder());
    await waitFor(() => expect(prayer.reminderSnoozeError).toBe('This reminder has already been snoozed once.'));
  });

  it('tells the prayer service when the Learn/Move reminder preferences differ from what it holds', async () => {
    const owners = fakeOwners();
    const state = makeMomentumState();
    state.reminderPreferences.learn = { enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'] };
    renderPrayerProvider({ ...owners, momentum: { ...owners.momentum, state } });

    await waitFor(() => expect(prayerService.saveMomentumReminders).toHaveBeenCalledWith([
      { pillar: 'learn', enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'], completedOn: null },
      { pillar: 'move', enabled: false, afterPrayers: [], completedOn: null },
    ]), { timeout: 3_000 });
  });

  it('starts nothing until prayer preferences and location come from their services', async () => {
    const owners = fakeOwners();
    renderPrayerProvider({ ...owners, settings: { ...owners.settings, serviceSettingsReady: false } });

    await act(async () => { await Promise.resolve(); });

    expect(prayerService.getPrayerSchedule).not.toHaveBeenCalled();
    expect(prayerService.getPrayerDashboard).not.toHaveBeenCalled();
    expect(prayer.scheduleStatus).toBe('idle');
  });

  it('refuses to open a completion for a prayer that has not started', async () => {
    renderPrayerProvider();
    await waitFor(() => expect(prayer.scheduleStatus).toBe('ready'));

    act(() => { prayer.requestPrayerCompletion('Asr', { source: 'dashboard' }); });

    await waitFor(() => expect(prayer.completionNotice).toBe('Asr has not started yet.'));
    expect(prayer.pendingCompletion).toBeNull();
    act(() => prayer.dismissCompletionNotice());
    await waitFor(() => expect(prayer.completionNotice).toBeNull());
  });
});
