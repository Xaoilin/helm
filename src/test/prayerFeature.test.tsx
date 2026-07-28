import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AppProvider } from '../store/AppContext';

function installPrayerScheduleFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.aladhan.com/v1/timingsByCity')) {
      return new Response(JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: '06:50',
            Dhuhr: '13:00',
            Asr: '16:30',
            Sunset: '20:00',
            Maghrib: '20:15',
            Isha: '21:45',
            Midnight: '00:15',
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
    throw new Error(`Unexpected prayer feature fetch: ${url}`);
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

function seedPrayerAndHabit() {
  localStorage.setItem('helm:tasks', JSON.stringify([
    {
      id: 'prayer-fajr',
      title: 'Fajr Prayer',
      description: '',
      completed: false,
      priority: 'medium',
      category: 'prayer',
      prayerName: 'Fajr',
      recurring: { frequency: 'daily' },
      createdAt: '2026-07-28T04:00:00.000Z',
      updatedAt: '2026-07-28T04:00:00.000Z',
    },
    {
      id: 'habit-water',
      title: 'Drink water',
      description: '',
      completed: false,
      priority: 'low',
      category: 'daily',
      recurring: { frequency: 'daily' },
      createdAt: '2026-07-28T04:00:00.000Z',
      updatedAt: '2026-07-28T04:00:00.000Z',
    },
  ]));
}

describe('prayer completion UI and reminders', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 28, 6, 36, 0));
    installPrayerScheduleFetch();
    seedSettings();
    seedPrayerAndHabit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('uses the shared On time / Late selector while ordinary habits stay unchanged', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    render(<AppProvider><App /></AppProvider>);
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    const prayerDialog = await screen.findByRole('dialog', { name: 'How was Fajr prayed?' });
    expect(prayerDialog).toHaveTextContent('On time');
    expect(prayerDialog).toHaveTextContent('Late');
    expect(prayerDialog).toHaveTextContent('Cancel');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'How was Fajr prayed?' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(await screen.findByRole('button', { name: /On time/ }));
    await waitFor(() => expect(screen.getByRole('button', {
      name: 'Fajr Prayer \u2014 completed, On time',
    })).toHaveAttribute('aria-disabled', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Complete Drink water' }));
    expect(screen.getByText('Did you complete this?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Drink water/ })).not.toBeInTheDocument();
  });

  it('opens the shared selector from the Dashboard prayer habit card', async () => {
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    expect(screen.getByText('🙏 Prayer outcomes · Current month')).toBeInTheDocument();
    expect(screen.getByText(/Current month · Classified opportunities only/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });

  it('awards canonical one-time XP when no prayer task exists', async () => {
    localStorage.setItem('helm:tasks', '[]');
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });

    const fajrRow = screen.getByText('Fajr', { selector: '.prayer-name' }).closest('.prayer-row');
    fireEvent.click(within(fajrRow!).getByRole('button', { name: 'Mark prayed' }));
    fireEvent.click(await screen.findByRole('button', { name: /On time/ }));

    await waitFor(() => {
      const profile = JSON.parse(localStorage.getItem('helm:gamification') || '{}');
      expect(profile.totalXp).toBe(15);
      expect(profile.dailyLog['2026-07-28']).toEqual(['prayer:fajr']);
      expect(profile.prayerCompletionLedger['2026-07-28::Fajr']).toMatchObject({
        status: 'on_time',
        rewarded: true,
      });
    });
    expect(JSON.parse(localStorage.getItem('helm:prayerTracking') || '{}')
      .records['2026-07-28::Fajr']).toMatchObject({
        status: 'on_time',
        rewarded: true,
      });
  });

  it('recovers an interrupted tracking-first reward exactly once', async () => {
    localStorage.setItem('helm:tasks', '[]');
    localStorage.setItem('helm:prayerTracking', JSON.stringify({
      schemaVersion: 1,
      trackingStartedAt: new Date(2026, 6, 28, 6, 30, 0).toISOString(),
      records: {
        '2026-07-28::Fajr': {
          date: '2026-07-28',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: new Date(2026, 6, 28, 6, 35, 0).toISOString(),
          rewarded: true,
          source: 'dashboard',
        },
      },
      reminderReceipts: {},
    }));

    const first = render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    await waitFor(() => {
      const profile = JSON.parse(localStorage.getItem('helm:gamification') || '{}');
      expect(profile.totalXp).toBe(15);
      expect(profile.prayerCompletionLedger['2026-07-28::Fajr'].rewarded).toBe(true);
    });
    first.unmount();

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(15);
    });
  });

  it('persists the activation-day eligibility from the matching schedule once', async () => {
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{}');
      expect(stored.activationDayEligibility).toEqual({
        date: '2026-07-28',
        prayerNames: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
      });
    });
  });

  it('pauses deadline inference and clock suggestions on a timezone mismatch', async () => {
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify({
      prayers: [
        { name: 'Fajr', nameArabic: 'Fajr', time: '05:00', type: 'prayer' },
        { name: 'Sunrise', nameArabic: 'Sunrise', time: '06:50', type: 'event' },
        { name: 'Dhuhr', nameArabic: 'Dhuhr', time: '13:00', type: 'prayer' },
        { name: 'Asr', nameArabic: 'Asr', time: '16:30', type: 'prayer' },
        { name: 'Sunset', nameArabic: 'Sunset', time: '20:00', type: 'event' },
        { name: 'Maghrib', nameArabic: 'Maghrib', time: '20:15', type: 'prayer' },
        { name: 'Isha', nameArabic: 'Isha', time: '21:45', type: 'prayer' },
        { name: 'Midnight', nameArabic: 'Midnight', time: '00:15', type: 'event' },
      ],
      date: '2026-07-28',
      hijriDate: '12 Safar 1448',
      city: 'Bedford',
      country: 'United Kingdom',
      timezone: 'America/New_York',
      method: 'Shia Ithna-Ashari, Leva Institute, Qum',
      fetchedAt: new Date().toISOString(),
      source: 'network',
    }));

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Deadline classification and reminders paused',
    );

    const fajrRow = screen.getByText('Fajr', { selector: '.prayer-name' }).closest('.prayer-row');
    expect(fajrRow).toHaveTextContent('Pending');
    expect(fajrRow).not.toHaveTextContent('Before tracking');
    fireEvent.click(within(fajrRow!).getByRole('button', { name: 'Mark prayed' }));
    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
    expect(screen.queryByText('Likely from the clock')).not.toBeInTheDocument();
  });

  it('opens the shared selector from the Dashboard Up Next quick-complete action', async () => {
    const tasks = JSON.parse(localStorage.getItem('helm:tasks') || '[]') as Array<{ category?: string }>;
    localStorage.setItem('helm:tasks', JSON.stringify(tasks.filter(task => task.category === 'prayer')));

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });

    fireEvent.click(await screen.findByRole('button', { name: 'Complete now' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });

  it('contains modal keyboard focus and returns it to the completion trigger', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Tasks' });

    const trigger = screen.getByRole('button', { name: 'Complete Fajr Prayer' });
    trigger.focus();
    fireEvent.click(trigger);

    const onTime = await screen.findByRole('button', { name: /On time/ });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(onTime).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(onTime).toHaveFocus();

    onTime.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'How was Fajr prayed?' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens the same selector from the All Tasks checkbox', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Tasks' });

    fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Fajr Prayer" as complete' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });

  it('shows a global non-Dashboard deadline warning, completes from it, and persists stats after reload', async () => {
    sessionStorage.setItem('helm:shell-surface', 'settings');
    const firstRender = render(<AppProvider><App /></AppProvider>);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Pray Fajr before it is too late');
    expect(warning).toHaveTextContent('Sunrise');

    fireEvent.click(screen.getByRole('button', { name: 'Mark Fajr prayed' }));
    fireEvent.click(await screen.findByRole('button', { name: /On time/ }));
    await waitFor(() => {
      expect(screen.queryByText('Pray Fajr before it is too late')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const stored = localStorage.getItem('helm:prayerTracking');
      expect(stored).toContain('"status":"on_time"');
    });

    firstRender.unmount();
    sessionStorage.setItem('helm:shell-surface', 'profile');
    await act(async () => {
      render(<AppProvider><App /></AppProvider>);
    });
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'All prayers: 100% on time, 0% late, 0% missed' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: '2026-07-28: 100% on time, 0% late, 0% missed',
    })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: '2026-07-27: 0% on time, 0% late, 0% missed',
    })).toBeInTheDocument();
  });

  it('snoozes for five minutes, then restores the warning without dismissing it permanently', async () => {
    sessionStorage.setItem('helm:shell-surface', 'settings');
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Settings' });
    await screen.findByText('Pray Fajr before it is too late');

    fireEvent.click(screen.getByRole('button', { name: 'Snooze 5 min' }));
    expect(screen.queryByText('Pray Fajr before it is too late')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 15_000);
    });
    expect(await screen.findByText('Pray Fajr before it is too late')).toBeInTheDocument();
  });

  it('removes snooze once five minutes or less remain', async () => {
    vi.setSystemTime(new Date(2026, 6, 28, 6, 46, 0));
    sessionStorage.setItem('helm:shell-surface', 'settings');
    render(<AppProvider><App /></AppProvider>);

    await screen.findByText('Pray Fajr before it is too late');
    expect(screen.queryByRole('button', { name: 'Snooze 5 min' })).not.toBeInTheDocument();
  });

  it('does not remind for a legacy completion imported as unclassified', async () => {
    localStorage.setItem('helm:gamification', JSON.stringify({
      totalXp: 15,
      level: 1,
      currentStreak: 1,
      longestStreak: 1,
      totalTasksCompleted: 1,
      badges: [],
      habitTallies: { 'prayer-fajr': 1 },
      dailyLog: { '2026-07-28': ['prayer-fajr'] },
    }));
    sessionStorage.setItem('helm:shell-surface', 'settings');

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Settings' });
    await waitFor(() => expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"unclassified"'));

    expect(screen.queryByText('Pray Fajr before it is too late')).not.toBeInTheDocument();
  });

  it('resets canonical prayer outcomes with the gamification reset', async () => {
    localStorage.setItem('helm:gamification', JSON.stringify({
      totalXp: 15,
      level: 1,
      currentStreak: 1,
      longestStreak: 1,
      totalTasksCompleted: 1,
      badges: [],
      habitTallies: { 'prayer-fajr': 1 },
      dailyLog: { '2026-07-28': ['prayer-fajr'] },
    }));
    localStorage.setItem('helm:prayerTracking', JSON.stringify({
      schemaVersion: 1,
      trackingStartedAt: '2026-07-28T00:00:00.000Z',
      records: {
        '2026-07-28::Fajr': {
          date: '2026-07-28',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: '2026-07-28T05:30:00.000Z',
          rewarded: true,
          taskId: 'prayer-fajr',
          source: 'tasks',
        },
      },
      reminderReceipts: {},
    }));
    sessionStorage.setItem('helm:shell-surface', 'settings');

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset All Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Reset Everything' }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{}');
      expect(stored.records).toEqual({});
    });
    expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(0);
  });

  it('labels pre-activation deadlines as Before tracking instead of Missed', async () => {
    vi.setSystemTime(new Date(2026, 6, 28, 7, 0, 0));
    localStorage.setItem('helm:prayerTracking', JSON.stringify({
      schemaVersion: 1,
      trackingStartedAt: new Date(2026, 6, 28, 6, 55, 0).toISOString(),
      records: {},
      reminderReceipts: {},
    }));
    sessionStorage.setItem('helm:shell-surface', 'dashboard');

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    await screen.findByText('Prayer Times — Bedford', { exact: false });

    const prayerTimesCard = screen.getByText('Prayer Times — Bedford', { exact: false })
      .closest('.prayer-times-card');
    expect(prayerTimesCard).toHaveTextContent('Before tracking');
    expect(prayerTimesCard?.querySelector('.prayer-outcome-badge.missed')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const fajrCorrection = screen.getByLabelText('Fajr outcome on Today');
    expect(fajrCorrection).toBeDisabled();
    expect(fajrCorrection).toHaveValue('not_tracked');
    expect(fajrCorrection).toHaveAttribute('title', expect.stringContaining('before classified tracking began'));
  });

  it('corrects a recorded status without awarding XP again', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Tasks' });

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(await screen.findByRole('button', { name: /On time/ }));
    await waitFor(() => expect(localStorage.getItem('helm:gamification')).toContain('"totalXp":15'));
    const xpBefore = JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp;

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Dashboard' }));
    await screen.findByRole('heading', { name: 'Good morning' });
    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const fajrCorrection = screen.getByLabelText('Fajr outcome on Today');
    const dhuhrCorrection = screen.getByLabelText('Dhuhr outcome on Today');
    expect(fajrCorrection).toBeEnabled();
    expect(dhuhrCorrection).toBeDisabled();
    expect(dhuhrCorrection).toHaveAttribute('aria-describedby', 'prayer-history-help');
    expect(dhuhrCorrection).toHaveAttribute('title', expect.stringContaining('Pending prayers cannot be corrected'));

    fireEvent.change(fajrCorrection, { target: { value: 'missed' } });

    await waitFor(() => expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"missed"'));
    expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(xpBefore);

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Tasks' }));
    await screen.findByRole('heading', { name: 'Tasks' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(await screen.findByRole('button', { name: /Late/ }));

    await waitFor(() => expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"late"'));
    expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(xpBefore);
  });

  it('corrects task-churned history with one canonical daily-log identity', async () => {
    const currentTasks = [
      {
        id: 'new-fajr',
        title: 'Fajr Prayer',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'prayer',
        prayerName: 'Fajr',
        recurring: { frequency: 'daily' },
        createdAt: '2026-07-28T06:00:00.000Z',
        updatedAt: '2026-07-28T06:00:00.000Z',
      },
      {
        id: 'duplicate-fajr',
        title: 'Fajr Prayer duplicate',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'prayer',
        prayerName: 'Fajr',
        recurring: { frequency: 'daily' },
        createdAt: '2026-07-28T06:01:00.000Z',
        updatedAt: '2026-07-28T06:01:00.000Z',
      },
    ];
    localStorage.setItem('helm:tasks', JSON.stringify(currentTasks));
    localStorage.setItem('helm:gamification', JSON.stringify({
      totalXp: 15,
      level: 1,
      currentStreak: 1,
      longestStreak: 1,
      totalTasksCompleted: 1,
      badges: [],
      habitTallies: { 'old-fajr': 1 },
      dailyLog: { '2026-07-28': ['old-fajr'] },
    }));
    localStorage.setItem('helm:prayerTracking', JSON.stringify({
      schemaVersion: 1,
      trackingStartedAt: new Date(2026, 6, 28, 6, 30, 0).toISOString(),
      records: {
        '2026-07-28::Fajr': {
          date: '2026-07-28',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: new Date(2026, 6, 28, 6, 35, 0).toISOString(),
          rewarded: true,
          taskId: 'old-fajr',
          source: 'tasks',
        },
      },
      reminderReceipts: {},
    }));

    render(<AppProvider><App /></AppProvider>);
    await screen.findByRole('heading', { name: 'Good morning' });
    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const correction = screen.getByLabelText('Fajr outcome on Today');

    fireEvent.change(correction, { target: { value: 'missed' } });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}')
        .dailyLog['2026-07-28']).toBeUndefined();
    });

    fireEvent.change(correction, { target: { value: 'late' } });
    await waitFor(() => {
      const profile = JSON.parse(localStorage.getItem('helm:gamification') || '{}');
      expect(profile.totalXp).toBe(15);
      expect(profile.dailyLog['2026-07-28']).toEqual(['new-fajr']);
    });
  });
});
