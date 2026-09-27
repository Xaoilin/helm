import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '../services/backend/liveContracts';
import { setPrayerOutcome } from '../services/prayerTracking';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerNotificationPermission } from '../store/contexts/prayer/usePrayerNotificationPermission';
import { usePrayerReminderBanners } from '../store/contexts/prayer/usePrayerReminderBanners';
import { usePrayerDeadlineReminders } from '../store/contexts/prayer/usePrayerDeadlineReminders';
import { usePrayerBoundedReminderNotifications } from '../store/contexts/prayer/usePrayerBoundedReminderNotifications';
import type { PrayerReminderReporter } from '../store/contexts/prayer/usePrayerReminderDiagnostics';
import { makeMomentumState } from './fixtures';
import { makePrayerTimesData, PRAYER_TEST_DATE, PRAYER_TEST_ZONE } from './prayerFixtures';

const persistence = vi.hoisted(() => ({
  saveStoreCommitted: vi.fn(async () => undefined),
}));
vi.mock('../store/persistence', () => persistence);

const live = vi.hoisted(() => ({ listeners: new Set<(event: LiveEvent) => void>() }));
vi.mock('../services/backend/liveEvents', () => ({
  subscribeLiveEvents: (listener: (event: LiveEvent) => void) => {
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  },
}));

/** The live-update stream delivering an event, as the gateway does. */
function emit(event: LiveEvent) {
  act(() => { for (const listener of [...live.listeners]) listener(event); });
}

const shown: { title: string; body?: string; tag?: string }[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body, ...(options?.tag ? { tag: options.tag } : {}) });
  }
}

function makeReporter(): PrayerReminderReporter & { [K in keyof PrayerReminderReporter]: ReturnType<typeof vi.fn> } {
  return { noteNotificationKey: vi.fn(), noteError: vi.fn(), fail: vi.fn() };
}

const timetable = makePrayerTimesData();

/** Wires the reminder hooks exactly as PrayerProvider does, around real tracking state. */
function useReminderHarness({ now, reporter, onFired }: {
  now: Date;
  reporter: PrayerReminderReporter;
  onFired: () => void;
}) {
  const { tracking, getTracking, commitTracking } = usePrayerTracking();
  const permission = usePrayerNotificationPermission();
  const banners = usePrayerReminderBanners({
    prayerEnabled: true,
    reminderEnabled: true,
    reminderMinutes: 15,
    reminderSchedules: [timetable],
    reminderSchedulesValid: true,
    timetable,
    momentum: makeMomentumState(),
    tracking,
    getTracking,
    commitTracking,
    today: PRAYER_TEST_DATE,
    now,
  });
  const deadline = usePrayerDeadlineReminders({
    enabled: true,
    getTracking,
    onFired,
    refreshPermission: permission.refresh,
    scheduleTimeZone: PRAYER_TEST_ZONE,
    reporter,
  });
  usePrayerBoundedReminderNotifications({
    loaded: true,
    plans: banners.boundedReminderPlans,
    receipts: tracking.boundedReminderReceipts,
    getTracking,
    commitTracking,
    now,
    permission,
    reporter,
  });
  return { tracking, commitTracking, permission, banners, deadline };
}

beforeEach(() => {
  shown.length = 0;
  FakeNotification.permission = 'granted';
  persistence.saveStoreCommitted.mockReset();
  persistence.saveStoreCommitted.mockResolvedValue(undefined);
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bounded reminder notifications', () => {
  // Dhuhr starts at 11:55Z; its opportunity reminder is due until 12:25Z.
  const dueAt = new Date('2026-09-26T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(dueAt);
  });

  it('shows a permitted reminder once, saving the attempt before it and the delivery after', async () => {
    const reporter = makeReporter();
    const { result, rerender } = renderHook(props => useReminderHarness(props), {
      initialProps: { now: dueAt, reporter, onFired: vi.fn() },
    });

    await waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].title).toBe('Dhuhr prayer opportunity');
    await waitFor(() => expect(persistence.saveStoreCommitted).toHaveBeenCalledTimes(2));
    const [attempted, delivered] = persistence.saveStoreCommitted.mock.calls.map(call => (call as unknown[])[1]) as {
      boundedReminderReceipts: Record<string, { attemptedAt?: string; notifiedAt?: string }>;
    }[];
    expect(Object.values(attempted.boundedReminderReceipts)[0]).not.toHaveProperty('notifiedAt');
    expect(Object.values(delivered.boundedReminderReceipts)[0].notifiedAt).toBe(dueAt.toISOString());
    await waitFor(() => expect(Object.keys(result.current.tracking.boundedReminderReceipts)).toHaveLength(1));

    // The receipt prevents a repeat on the next tick.
    vi.setSystemTime(new Date('2026-09-26T12:00:15Z'));
    rerender({ now: new Date('2026-09-26T12:00:15Z'), reporter, onFired: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(shown).toHaveLength(1);
    expect(persistence.saveStoreCommitted).toHaveBeenCalledTimes(2);
    expect(reporter.fail).not.toHaveBeenCalled();
  });

  it('without permission sends and receipts nothing, waits for permission, and leaves the banner showing', async () => {
    FakeNotification.permission = 'denied';
    const reporter = makeReporter();
    const { result, rerender } = renderHook(props => useReminderHarness(props), {
      initialProps: { now: dueAt, reporter, onFired: vi.fn() },
    });

    const waitingKey = result.current.banners.activeBoundedReminder!.notificationKey;
    // The deadline-reminder timers note their keys too; count only this reminder's.
    const notesOfWaitingKey = () => reporter.noteNotificationKey.mock.calls.filter(([key]) => key === waitingKey).length;
    await waitFor(() => expect(notesOfWaitingKey()).toBe(1));
    expect(result.current.permission.waitingReminderKeysRef.current.has(waitingKey)).toBe(true);
    expect(result.current.permission.state).toBe('not_granted');
    expect(shown).toHaveLength(0);
    expect(persistence.saveStoreCommitted).not.toHaveBeenCalled();
    expect(result.current.tracking.boundedReminderReceipts).toEqual({});
    expect(result.current.banners.activeBoundedReminder?.title).toBe('Dhuhr prayer opportunity');

    // Still no permission on the next tick: the waiting reminder is not retried.
    rerender({ now: new Date('2026-09-26T12:00:15Z'), reporter, onFired: vi.fn() });
    await act(async () => { await Promise.resolve(); });
    expect(notesOfWaitingKey()).toBe(1);

    // Granting permission clears the wait, and the next tick sends it.
    FakeNotification.permission = 'granted';
    await act(async () => { await result.current.permission.request(); });
    expect(result.current.permission.waitingReminderKeysRef.current.size).toBe(0);
    rerender({ now: new Date('2026-09-26T12:00:30Z'), reporter, onFired: vi.fn() });
    await waitFor(() => expect(shown).toHaveLength(1));
  });

  it('surfaces a failed receipt save and shows nothing', async () => {
    const failure = new Error('database unavailable');
    persistence.saveStoreCommitted.mockRejectedValue(failure);
    const reporter = makeReporter();
    const { result } = renderHook(props => useReminderHarness(props), {
      initialProps: { now: dueAt, reporter, onFired: vi.fn() },
    });

    await waitFor(() => expect(reporter.fail).toHaveBeenCalledWith('BoundedReminder', failure));
    expect(shown).toHaveLength(0);
    expect(result.current.tracking.boundedReminderReceipts).toEqual({});
  });
});

describe('deadline reminder notifications', () => {
  // Dhuhr's deadline (Asr) is 15:20Z; the prayer service sends its reminder at 15:05Z.
  const reminderTime = new Date('2026-09-26T15:05:00Z');
  const reminder: LiveEvent = {
    type: 'prayer.reminder',
    domain: 'prayer',
    at: reminderTime.toISOString(),
    data: {
      date: PRAYER_TEST_DATE,
      prayer: 'Dhuhr',
      deadlineAt: '2026-09-26T15:20:00Z',
      deadline: 'Asr',
      timeZone: PRAYER_TEST_ZONE,
      reminderMinutes: 15,
    },
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(reminderTime);
  });

  it('shows the reminder the prayer service sends as one notification shared by every open tab', async () => {
    const reporter = makeReporter();
    const onFired = vi.fn();
    renderHook(props => useReminderHarness(props), { initialProps: { now: reminderTime, reporter, onFired } });

    emit(reminder);

    await waitFor(() => expect(shown.filter(notification => notification.title === 'Dhuhr prayer due soon')).toEqual([
      { title: 'Dhuhr prayer due soon', body: expect.stringContaining('Pray Dhuhr before Asr'), tag: expect.any(String) },
    ]));
    expect(onFired).toHaveBeenCalledOnce();
    expect(reporter.fail).not.toHaveBeenCalled();
  });

  it('shows nothing for a prayer recorded meanwhile, or once its deadline has passed', async () => {
    const { result } = renderHook(props => useReminderHarness(props), {
      initialProps: { now: reminderTime, reporter: makeReporter(), onFired: vi.fn() },
    });
    act(() => result.current.commitTracking(current => setPrayerOutcome(current, {
      date: PRAYER_TEST_DATE,
      prayerName: 'Dhuhr',
      status: 'on_time',
      recordedAt: reminderTime,
      source: 'dashboard',
    })));

    emit(reminder);
    vi.setSystemTime(new Date('2026-09-26T15:21:00Z'));
    emit({ ...reminder, data: { ...(reminder.data as object), prayer: 'Asr' } });
    await act(async () => { await Promise.resolve(); });

    expect(shown.some(notification => notification.title.includes('due soon'))).toBe(false);
  });

  it('ignores other live events and reminders in an unexpected shape', async () => {
    const reporter = makeReporter();
    renderHook(props => useReminderHarness(props), { initialProps: { now: reminderTime, reporter, onFired: vi.fn() } });

    emit({ ...reminder, type: 'tasks.save-task', domain: 'tasks' });
    emit({ ...reminder, data: { prayer: 'Dhuhr' } });
    await act(async () => { await Promise.resolve(); });

    expect(shown.some(notification => notification.title.includes('due soon'))).toBe(false);
    expect(reporter.noteError).toHaveBeenCalledOnce();
  });
});
