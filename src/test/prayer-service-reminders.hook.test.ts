import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyMomentumState, PrayerTrackingState } from '../types/domain';
import type { ServicePrayerReminders } from '../services/backend/contracts';
import type { LiveEvent } from '../services/backend/liveContracts';
import { ServiceError } from '../services/backend/serviceClient';
import { createPrayerTrackingState, setPrayerOutcome } from '../services/prayerTracking';
import { usePrayerServiceReminders } from '../store/contexts/prayer/usePrayerServiceReminders';
import { usePrayerMomentumReminderSync } from '../store/contexts/prayer/usePrayerMomentumReminderSync';
import type { PrayerReminderReporter } from '../store/contexts/prayer/usePrayerReminderDiagnostics';
import { makeMomentumState } from './fixtures';

const api = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => true),
  getPrayerReminders: vi.fn(),
  snoozePrayerReminder: vi.fn(),
  saveMomentumReminders: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => api);

const live = vi.hoisted(() => ({ listeners: new Set<(event: LiveEvent) => void>() }));
vi.mock('../services/backend/liveEvents', () => ({
  LIVE_READY: 'live.ready',
  subscribeLiveEvents: (listener: (event: LiveEvent) => void) => {
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  },
}));

/** The live-update stream delivering an event, as the gateway does. */
function emit(event: LiveEvent) {
  act(() => { for (const listener of [...live.listeners]) listener(event); });
}

function fixture<T>(name: string): T {
  return (JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'prayer-service', `${name}.json`), 'utf8')) as {
    body: T;
  }).body;
}

const reminders = fixture<ServicePrayerReminders>('reminders');
const [opportunity, momentumReminder] = reminders.active;
/** A minute after Dhuhr began, while both fixture reminders are active. */
const NOW = new Date('2026-09-25T11:53:00Z');

const shown: { title: string; body?: string; tag?: string }[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body, ...(options?.tag ? { tag: options.tag } : {}) });
  }
}

function makeReporter() {
  return {
    noteNotificationKey: vi.fn<PrayerReminderReporter['noteNotificationKey']>(),
    noteError: vi.fn<PrayerReminderReporter['noteError']>(),
    fail: vi.fn<PrayerReminderReporter['fail']>(),
  };
}

interface HarnessProps {
  tracking: PrayerTrackingState;
  momentum: DailyMomentumState | null;
  now: Date;
  prayerRemindersEnabled?: boolean;
}

function renderReminders(initial: Partial<HarnessProps> = {}) {
  const reporter = makeReporter();
  const onArrived = vi.fn();
  const refreshPermission = vi.fn(async () => (FakeNotification.permission === 'granted' ? 'granted' as const : 'not_granted' as const));
  const props: HarnessProps = {
    tracking: createPrayerTrackingState(new Date('2026-09-01T00:00:00Z')),
    momentum: makeMomentumState(),
    now: NOW,
    ...initial,
  };
  const rendered = renderHook((current: HarnessProps) => usePrayerServiceReminders({
    enabled: true,
    prayerRemindersEnabled: current.prayerRemindersEnabled ?? true,
    tracking: current.tracking,
    getTracking: () => current.tracking,
    momentum: current.momentum,
    now: current.now,
    refreshPermission,
    onArrived,
    reporter,
  }), { initialProps: props });
  return { ...rendered, reporter, onArrived, props };
}

function notice(data: unknown): LiveEvent {
  return { type: 'prayer.notice', domain: 'prayer', at: NOW.toISOString(), data };
}

beforeEach(() => {
  shown.length = 0;
  live.listeners.clear();
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  api.isPrayerServiceEnabled.mockReturnValue(true);
  api.getPrayerReminders.mockResolvedValue({ active: [], momentum: reminders.momentum });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('usePrayerServiceReminders', () => {
  // A notification is checked against the wall clock, so pin it to NOW (timers stay real for waitFor).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the reminders the service already sent, without notifying them again', async () => {
    api.getPrayerReminders.mockResolvedValue(reminders);
    const { result } = renderReminders();

    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));
    expect(result.current.showing.map(reminder => reminder.key)).toEqual([opportunity.key, momentumReminder.key]);
    expect(result.current.momentumPreferences).toEqual(reminders.momentum);
    expect(shown).toEqual([]);
  });

  it('shows a prayer.notice as a banner and one notification tagged with its key', async () => {
    const { result, onArrived } = renderReminders();
    await waitFor(() => expect(api.getPrayerReminders).toHaveBeenCalled());

    emit(notice(momentumReminder));

    await waitFor(() => expect(shown).toEqual([{
      title: 'Learn — Level 1', body: "Dhuhr has begun. Complete today's Learn Level 1.", tag: momentumReminder.key,
    }]));
    expect(result.current.notice).toMatchObject({ kind: 'momentum', pillars: ['learn'] });
    expect(onArrived).toHaveBeenCalledOnce();
  });

  it('shows a deadline prayer.reminder in the shape the service first sent it', async () => {
    const { result } = renderReminders({ now: new Date('2026-09-27T15:06:00Z') });
    await waitFor(() => expect(api.getPrayerReminders).toHaveBeenCalled());

    emit({
      type: 'prayer.reminder', domain: 'prayer', at: '2026-09-27T15:05:00Z',
      data: {
        date: '2026-09-27', prayer: 'Dhuhr', deadlineAt: '2026-09-27T15:20:00Z', deadline: 'Asr',
        timeZone: 'Europe/London', reminderMinutes: 15,
      },
    });

    await waitFor(() => expect(result.current.deadline).toMatchObject({
      key: 'deadline:2026-09-27:Dhuhr', deadlineName: 'Asr', title: 'Dhuhr prayer due soon', canSnooze: true,
    }));
    expect(shown).toEqual([{
      title: 'Dhuhr prayer due soon', body: expect.stringContaining('Pray Dhuhr before Asr'),
      tag: 'deadline:2026-09-27:Dhuhr',
    }]);
  });

  it('without permission shows only the banner', async () => {
    FakeNotification.permission = 'denied';
    const { result, reporter } = renderReminders();

    emit(notice(opportunity));

    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));
    await waitFor(() => expect(reporter.noteNotificationKey).toHaveBeenCalledWith(opportunity.key));
    expect(shown).toEqual([]);
  });

  it('neither notifies nor shows a reminder whose prayer is already recorded, and hides it when recorded later', async () => {
    const recorded = setPrayerOutcome(createPrayerTrackingState(new Date('2026-09-01T00:00:00Z')), {
      date: opportunity.date, prayerName: 'Dhuhr', status: 'on_time', recordedAt: NOW, source: 'dashboard',
    });
    const { result, rerender, props } = renderReminders();
    emit(notice(opportunity));
    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));

    rerender({ ...props, tracking: recorded });
    expect(result.current.notice).toBeNull();

    shown.length = 0;
    emit(notice({ ...opportunity, key: 'opportunity:2026-09-25:Dhuhr:again' }));
    await act(async () => { await Promise.resolve(); });
    expect(shown).toEqual([]);
  });

  it('hides a reminder once it expires', async () => {
    const { result, rerender, props } = renderReminders();
    emit(notice(opportunity));
    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));

    rerender({ ...props, now: new Date(opportunity.expiresAt) });

    expect(result.current.notice).toBeNull();
  });

  it('shows Learn/Move reminders even when prayer reminders are off', async () => {
    const { result } = renderReminders({ prayerRemindersEnabled: false });

    emit(notice(opportunity));
    emit(notice(momentumReminder));

    await waitFor(() => expect(result.current.notice?.kind).toBe('momentum'));
    await waitFor(() => expect(shown.map(notification => notification.tag)).toEqual([momentumReminder.key]));
  });

  it('snoozes through the service and hides the reminder until the snooze ends', async () => {
    api.getPrayerReminders.mockResolvedValue({ active: [opportunity], momentum: reminders.momentum });
    api.snoozePrayerReminder.mockResolvedValue({
      ...opportunity, snoozedUntil: '2026-09-25T11:58:00Z', snoozeCount: 1,
    });
    const { result, rerender, props } = renderReminders();
    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));

    await act(async () => { await result.current.snooze(opportunity.key); });

    expect(api.snoozePrayerReminder).toHaveBeenCalledWith(opportunity.key);
    expect(result.current.notice).toBeNull();
    rerender({ ...props, now: new Date('2026-09-25T11:58:00Z') });
    expect(result.current.notice).toMatchObject({ key: opportunity.key, canSnooze: false });
  });

  it('shows the service refusing a snooze in its own words', async () => {
    api.getPrayerReminders.mockResolvedValue({ active: [opportunity], momentum: reminders.momentum });
    api.snoozePrayerReminder.mockRejectedValue(
      new ServiceError(409, 'snooze_used', 'This reminder has already been snoozed once.'));
    const { result } = renderReminders();
    await waitFor(() => expect(result.current.notice?.key).toBe(opportunity.key));

    await act(async () => { await result.current.snooze(opportunity.key); });

    expect(result.current.snoozeError).toBe('This reminder has already been snoozed once.');
    expect(result.current.notice?.key).toBe(opportunity.key);
  });

  it('ignores other live events and reports reminders in an unexpected shape', async () => {
    const { result, reporter } = renderReminders();

    emit({ type: 'tasks.save-task', domain: 'tasks', at: NOW.toISOString(), data: null });
    emit(notice({ key: 'x' }));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.showing).toEqual([]);
    expect(reporter.noteError).toHaveBeenCalledOnce();
  });
});

describe('usePrayerMomentumReminderSync', () => {
  const learnOn = {
    ...makeMomentumState(),
    reminderPreferences: {
      learn: { enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'] },
      move: { enabled: false, afterPrayers: [] },
    },
  } as DailyMomentumState;
  const saved = [
    { pillar: 'learn' as const, enabled: true, afterPrayers: ['Dhuhr' as const, 'Maghrib' as const, 'Isha' as const], completedOn: null },
    { pillar: 'move' as const, enabled: false, afterPrayers: [], completedOn: null },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    api.saveMomentumReminders.mockImplementation(async pillars => pillars);
  });
  afterEach(() => vi.useRealTimers());

  function renderSync(momentum: DailyMomentumState | null, current: typeof saved | null) {
    return renderHook(props => usePrayerMomentumReminderSync({ ...props, reporter: makeReporter() }), {
      initialProps: { momentum, saved: current },
    });
  }

  it('sends nothing while the service holds the same preferences, or before either has loaded', () => {
    renderSync(learnOn, saved);
    renderSync(null, saved);
    renderSync(learnOn, null);
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(api.saveMomentumReminders).not.toHaveBeenCalled();
  });

  it('sends changed preferences once, after changes settle', async () => {
    const { rerender } = renderSync(learnOn, saved);
    const moveOn = {
      ...learnOn,
      reminderPreferences: { ...learnOn.reminderPreferences, move: { enabled: true, afterPrayers: ['Asr'] } },
    } as DailyMomentumState;
    const moveLater = {
      ...moveOn,
      reminderPreferences: { ...moveOn.reminderPreferences, move: { enabled: true, afterPrayers: ['Asr', 'Isha'] } },
    } as DailyMomentumState;

    rerender({ momentum: moveOn, saved });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ momentum: moveLater, saved });
    await act(async () => { vi.advanceTimersByTime(1_000); });

    expect(api.saveMomentumReminders).toHaveBeenCalledOnce();
    expect(api.saveMomentumReminders).toHaveBeenCalledWith([
      saved[0],
      { pillar: 'move', enabled: true, afterPrayers: ['Asr', 'Isha'], completedOn: null },
    ]);

    // Sent and confirmed: the same state again sends nothing more.
    rerender({ momentum: { ...moveLater }, saved });
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(api.saveMomentumReminders).toHaveBeenCalledOnce();
  });
});
