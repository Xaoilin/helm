import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PrayerReminderFiredEvent,
  PrayerReminderScheduleRequest,
} from '../services/nativePrayerReminder';
import { AppProvider } from '../store/AppContext';
import { usePrayerContext } from '../store/contexts/PrayerContext';
import { useSettingsContext } from '../store/contexts/SettingsContext';

const reminderMocks = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  cancel: vi.fn(),
  permission: vi.fn(),
  requestPermission: vi.fn(),
  schedule: vi.fn(),
  send: vi.fn(),
  onFired: vi.fn(),
  listener: undefined as ((event: PrayerReminderFiredEvent) => void) | undefined,
}));

function expectLocalClock(instant: string | undefined, hours: number, minutes: number) {
  expect(instant).toBeTruthy();
  const value = new Date(instant!);
  expect([value.getHours(), value.getMinutes()]).toEqual([hours, minutes]);
}

vi.mock('../services/nativePrayerReminder', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/nativePrayerReminder')>();
  return {
    ...actual,
    cancelAllPrayerReminders: reminderMocks.cancelAll,
    cancelPrayerReminder: reminderMocks.cancel,
    getPrayerReminderPermission: reminderMocks.permission,
    requestPrayerReminderPermission: reminderMocks.requestPermission,
    schedulePrayerReminder: reminderMocks.schedule,
    sendPrayerNotification: reminderMocks.send,
    onPrayerReminderFired: reminderMocks.onFired,
  };
});

const fetchState = {
  sunrise: '06:50',
  midnight: '00:15',
  prayerFetches: 0,
};

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.aladhan.com/v1/timingsByCity')) {
      fetchState.prayerFetches += 1;
      const parsed = new URL(url);
      const city = parsed.searchParams.get('city') || 'Bedford';
      const sunrise = city === 'London' ? '07:10' : fetchState.sunrise;
      return new Response(JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: sunrise,
            Dhuhr: '13:00',
            Asr: '16:30',
            Sunset: '20:00',
            Maghrib: '20:15',
            Isha: '21:45',
            Midnight: fetchState.midnight,
          },
          date: {
            hijri: {
              day: '12',
              month: { en: 'Safar' },
              year: '1448',
            },
          },
          meta: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('localhost:11434/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    throw new Error(`Unexpected prayer reminder runtime fetch: ${url}`);
  }));
}

function seedSettings() {
  localStorage.setItem('helm:settings', JSON.stringify({
    theme: 'dark',
    dataRetentionDays: 90,
    telemetry: false,
    assistantProvider: 'ollama',
    prayerEnabled: true,
    prayerCity: 'Bedford',
    prayerCountry: 'United Kingdom',
    prayerReminderEnabled: true,
    prayerReminderMinutes: 15,
  }));
}

function RuntimeHarness() {
  const prayer = usePrayerContext();
  const settings = useSettingsContext();
  return (
    <div>
      <span data-testid="schedule-state">
        {prayer.diagnostics.scheduleStatus}:{prayer.schedule?.city || 'none'}:{prayer.today}
      </span>
      <span data-testid="previous-isha">
        {prayer.getOutcome('2026-07-28', 'Isha')?.status || 'pending'}
      </span>
      <button
        type="button"
        onClick={() => settings.updateSettings({ prayerReminderMinutes: 30 })}
      >
        Thirty minute reminder
      </button>
      <button
        type="button"
        onClick={() => settings.updateSettings({ prayerCity: 'London' })}
      >
        Change prayer city
      </button>
      <button
        type="button"
        onClick={() => prayer.completePrayer('Asr', 'on_time', { source: 'task-card' })}
      >
        Complete Asr
      </button>
    </div>
  );
}

function callsFor(prayerName: string): PrayerReminderScheduleRequest[] {
  return reminderMocks.schedule.mock.calls
    .map(([request]) => request as PrayerReminderScheduleRequest)
    .filter(request => request.prayerName === prayerName && request.testOnly !== true);
}

describe('prayer reminder runtime reconciliation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 28, 6, 0, 0));
    fetchState.sunrise = '06:50';
    fetchState.midnight = '00:15';
    fetchState.prayerFetches = 0;
    installFetch();
    seedSettings();

    reminderMocks.cancelAll.mockReset().mockResolvedValue(0);
    reminderMocks.cancel.mockReset().mockResolvedValue(true);
    reminderMocks.permission.mockReset().mockResolvedValue('granted');
    reminderMocks.requestPermission.mockReset().mockResolvedValue('granted');
    reminderMocks.send.mockReset().mockResolvedValue(true);
    reminderMocks.schedule.mockReset().mockImplementation(async (
      request: PrayerReminderScheduleRequest,
    ) => ({
      key: `${request.prayerDate}:${request.prayerName}:${Date.parse(request.deadlineIso)}`,
      status: 'scheduled',
      deadlineIso: request.deadlineIso,
      fireAtIso: request.fireAtIso,
    }));
    reminderMocks.listener = undefined;
    reminderMocks.onFired.mockReset().mockImplementation(async (
      listener: (event: PrayerReminderFiredEvent) => void,
    ) => {
      reminderMocks.listener = listener;
      return () => {
        if (reminderMocks.listener === listener) reminderMocks.listener = undefined;
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('replaces changed lead times and removes a completed member from a paired reminder', async () => {
    render(<AppProvider><RuntimeHarness /></AppProvider>);
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('ready:Bedford'));
    await waitFor(() => expect(callsFor('Fajr')).toHaveLength(1));

    const firstFajr = callsFor('Fajr')[0];
    expect(Date.parse(firstFajr.deadlineIso) - Date.parse(firstFajr.fireAtIso)).toBe(15 * 60_000);

    fireEvent.click(screen.getByRole('button', { name: 'Thirty minute reminder' }));
    await waitFor(() => expect(callsFor('Fajr')).toHaveLength(2));
    const replacedFajr = callsFor('Fajr').at(-1)!;
    expect(Date.parse(replacedFajr.deadlineIso) - Date.parse(replacedFajr.fireAtIso)).toBe(30 * 60_000);

    const paired = callsFor('Dhuhr').at(-1)!;
    expect(paired.body).toContain('Dhuhr and Asr');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Asr' }));

    await waitFor(() => expect(callsFor('Dhuhr').at(-1)?.body).not.toContain('Asr'));
    expect(reminderMocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      prayerDate: '2026-07-28',
      prayerName: 'Dhuhr',
    }));
  });

  it('refreshes on focus and visibility, then cancels incompatible location timers', async () => {
    render(<AppProvider><RuntimeHarness /></AppProvider>);
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('ready:Bedford'));
    await waitFor(() => expect(callsFor('Fajr')).toHaveLength(1));

    const fetchesBeforeFocus = fetchState.prayerFetches;
    fetchState.sunrise = '06:55';
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(fetchState.prayerFetches).toBeGreaterThan(fetchesBeforeFocus));
    await waitFor(() => expectLocalClock(callsFor('Fajr').at(-1)?.deadlineIso, 6, 55));

    const fetchesBeforeVisibility = fetchState.prayerFetches;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fetchState.sunrise = '07:00';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(fetchState.prayerFetches).toBeGreaterThan(fetchesBeforeVisibility));
    await waitFor(() => expectLocalClock(callsFor('Fajr').at(-1)?.deadlineIso, 7, 0));

    reminderMocks.cancelAll.mockClear();
    reminderMocks.cancel.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Change prayer city' }));
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('ready:London'));
    await waitFor(() => expectLocalClock(callsFor('Fajr').at(-1)?.deadlineIso, 7, 10));
    expect(reminderMocks.cancelAll.mock.calls.length + reminderMocks.cancel.mock.calls.length).toBeGreaterThan(0);
  });

  it('retains the previous-day Isha group across local-date rollover', async () => {
    vi.setSystemTime(new Date(2026, 6, 28, 23, 50, 0));
    render(<AppProvider><RuntimeHarness /></AppProvider>);
    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('ready:Bedford:2026-07-28'));
    await waitFor(() => expect(callsFor('Maghrib').at(-1)?.body).toContain('Maghrib and Isha'));
    const previousDeadline = callsFor('Maghrib').at(-1)!.deadlineIso;

    reminderMocks.cancelAll.mockClear();
    reminderMocks.cancel.mockClear();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 15_000);

    await waitFor(() => expect(screen.getByTestId('schedule-state')).toHaveTextContent('ready:Bedford:2026-07-29'));
    expect(screen.getByTestId('previous-isha')).toHaveTextContent('pending');
    expect(reminderMocks.cancelAll).not.toHaveBeenCalled();
    expect(reminderMocks.cancel).not.toHaveBeenCalledWith(expect.objectContaining({
      prayerDate: '2026-07-28',
      prayerName: 'Maghrib',
      deadlineIso: previousDeadline,
    }));
  });
});
