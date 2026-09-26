import { act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrayerProvider, usePrayerContext, type PrayerContextValue } from '../store/contexts/PrayerContext';
import { TaskCtx, type TaskContextValue } from '../store/contexts/TaskContext';
import { GamificationCtx, type GamificationContextValue } from '../store/contexts/GamificationContext';
import { DailyMomentumCtx, type DailyMomentumContextValue } from '../store/contexts/DailyMomentumContext';
import { KnowledgeCtx, type KnowledgeContextValue } from '../store/contexts/KnowledgeContext';
import { SettingsCtx, defaultSettings, type SettingsContextValue } from '../store/contexts/SettingsContext';
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
}));
vi.mock('../services/backend/prayerServiceApi', () => prayerService);

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
const dhuhrTask = makeTask({ id: 'task-dhuhr', title: 'Dhuhr Prayer', category: 'prayer', prayerName: 'Dhuhr' });

const VALUE_KEYS: (keyof PrayerContextValue)[] = [
  'loaded', 'tracking', 'schedule', 'scheduleStatus', 'scheduleError', 'now', 'today', 'localTimezone',
  'timezoneMatches', 'scheduleTimezoneValid', 'scheduleDays', 'stats', 'deadlines', 'nextPrayer',
  'pendingCompletion', 'activeReminder', 'activeBoundedReminder', 'canSnoozeActiveBoundedReminder', 'adhanPrayer',
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
  const tasks: TaskContextValue = {
    tasks: [dhuhrTask], loaded: true, addTask: vi.fn(() => 'task'), updateTask: vi.fn(), removeTask: vi.fn(), setTasks: vi.fn(),
  };
  const gamification: GamificationContextValue = {
    gamification: makeGamification(), loaded: true, updateGamification: vi.fn(), backfillPrayerLog: vi.fn(),
  };
  const momentum = {
    state: makeMomentumState(), loaded: true, saving: false, error: null,
  } as unknown as DailyMomentumContextValue;
  const knowledge = {
    knowledgeTopics: [], knowledgeEntries: [], lifestyleItems: [], loaded: true,
  } as unknown as KnowledgeContextValue;
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
  return { tasks, gamification, momentum, knowledge, settings };
}

function renderPrayerProvider(owners = fakeOwners()) {
  renderWithContexts(<PrayerProvider><PrayerProbe /></PrayerProvider>, [
    provide(SettingsCtx, owners.settings),
    provide(GamificationCtx, owners.gamification),
    provide(DailyMomentumCtx, owners.momentum),
    provide(KnowledgeCtx, owners.knowledge),
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
  // The account record holds only reminder receipts.
  persistence.loadStore.mockResolvedValue(null);
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
      nextReminderAt: '2026-09-26T15:05:00.000Z',
      suppressionReason: null,
    });
    // Bounded reminders fall back to the in-app banner without notification support.
    expect(prayer.activeBoundedReminder?.title).toBe('Dhuhr prayer opportunity');
  });

  it('completes a prayer across tracking, gamification and its task, then saves it to the prayer service', async () => {
    const owners = renderPrayerProvider();
    await waitFor(() => expect(prayer.scheduleStatus).toBe('ready'));
    await waitFor(() => expect(prayer.serviceSync.status).toBe('synced'));

    act(() => { prayer.requestPrayerCompletion('Dhuhr', { source: 'dashboard' }); });
    await waitFor(() => expect(prayer.pendingCompletion).toMatchObject({ prayerName: 'Dhuhr', suggestedStatus: 'on_time' }));

    let result: ReturnType<PrayerContextValue['confirmPrayerCompletion']> = null;
    act(() => { result = prayer.confirmPrayerCompletion('on_time'); });

    expect(result).toMatchObject({ prayerName: 'Dhuhr', status: 'on_time', prayerDate: PRAYER_TEST_DATE });
    await waitFor(() => expect(prayer.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'on_time' }));
    expect(prayer.pendingCompletion).toBeNull();
    expect(owners.gamification.updateGamification).toHaveBeenCalledWith(expect.objectContaining({
      prayerCompletionLedger: expect.objectContaining({ [DHUHR_KEY]: expect.objectContaining({ rewarded: true }) }),
    }));
    expect(owners.tasks.updateTask).toHaveBeenCalledWith('task-dhuhr', expect.objectContaining({ completed: true }));
    await waitFor(() => expect(prayerService.createPrayerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ date: PRAYER_TEST_DATE, prayer: 'Dhuhr', status: 'on_time' }),
      expect.stringMatching(/^prayer-outcome:create:/u),
    ));
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
