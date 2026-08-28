import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardSurface from '../surfaces/DashboardSurface';
import { toLocalDateStr } from '../services/financeHelpers';
import { renderWithProvider } from './surfaceTestHarness';

const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;

function seedPrayerSettings() {
  localStorage.setItem('helm:settings', JSON.stringify({
    prayerEnabled: true,
    prayerReminderEnabled: false,
    prayerCity: 'Bedford',
    prayerCountry: 'United Kingdom',
  }));
}

describe('DashboardSurface Night Compass', () => {
  beforeEach(() => {
    localStorage.clear();
    seedPrayerSettings();
  });

  it('keeps Prayer first and dominant while rendering Learn, Move, and Tasks once', async () => {
    await act(async () => { renderWithProvider(<DashboardSurface />); });

    const dashboard = screen.getByRole('region', { name: 'Night Compass daily dashboard' });
    const prayer = within(dashboard).getByRole('heading', { name: 'Prayer' });
    const learn = within(dashboard).getByRole('heading', { name: 'Learn' });
    const move = within(dashboard).getByRole('heading', { name: 'Move' });
    const tasks = within(dashboard).getByRole('heading', { name: 'Tasks' });

    expect(prayer.compareDocumentPosition(learn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(learn.compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(move.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dashboard.querySelectorAll('.nc-prayer-card')).toHaveLength(1);
    expect(dashboard.querySelectorAll('.nc-tasks-card')).toHaveLength(1);
    expect(screen.queryByText('UP NEXT')).not.toBeInTheDocument();
    expect(screen.queryByText('Task Snapshot')).not.toBeInTheDocument();

    for (const name of PRAYER_NAMES) {
      expect(within(dashboard).getByText(name, { selector: '.nc-prayer-name' })).toBeInTheDocument();
    }
  });

  it('keeps all five prayers visible with an actionable timezone repair state', async () => {
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify({
      prayers: [
        { name: 'Fajr', nameArabic: 'Fajr', time: '05:00', type: 'prayer' },
        { name: 'Sunrise', nameArabic: 'Sunrise', time: '06:45', type: 'event' },
        { name: 'Dhuhr', nameArabic: 'Dhuhr', time: '13:00', type: 'prayer' },
        { name: 'Asr', nameArabic: 'Asr', time: '16:30', type: 'prayer' },
        { name: 'Sunset', nameArabic: 'Sunset', time: '20:00', type: 'event' },
        { name: 'Maghrib', nameArabic: 'Maghrib', time: '20:15', type: 'prayer' },
        { name: 'Isha', nameArabic: 'Isha', time: '21:45', type: 'prayer' },
        { name: 'Midnight', nameArabic: 'Midnight', time: '00:15', type: 'event' },
      ],
      date: toLocalDateStr(new Date()),
      hijriDate: '12 Safar 1448',
      city: 'Bedford',
      country: 'United Kingdom',
      timezone: 'America/New_York',
      method: 'Shia Ithna-Ashari, Leva Institute, Qum',
      fetchedAt: new Date().toISOString(),
      source: 'cache',
    }));

    await act(async () => { renderWithProvider(<DashboardSurface />); });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Schedule timezone does not match this desktop');
    expect(within(alert).getByRole('button', { name: 'Repair prayer settings' })).toBeInTheDocument();
    for (const name of PRAYER_NAMES) {
      expect(screen.getByText(name, { selector: '.nc-prayer-name' })).toBeInTheDocument();
    }
  });

  it('keeps all five prayers visible when the current-day schedule is unavailable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fallbackFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => (
      String(input).includes('api.aladhan.com/v1/timingsByCity')
        ? Promise.resolve(new Response('{}', { status: 503 }))
        : fallbackFetch(input, init)
    )));

    try {
      await act(async () => { renderWithProvider(<DashboardSurface />); });
      await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Prayer schedule unavailable');
      expect(within(alert).getByRole('button', { name: 'Retry schedule' })).toBeInTheDocument();
      for (const name of PRAYER_NAMES) {
        const item = screen.getByText(name, { selector: '.nc-prayer-name' }).closest('.nc-prayer-item');
        expect(item).toHaveTextContent('—');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
