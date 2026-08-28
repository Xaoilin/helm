import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  installPrayerFeatureHarness,
  renderPrayerFeatureApp,
} from './prayerFeatureHarness';

installPrayerFeatureHarness();

describe('prayer completion rewards', () => {
  it('awards canonical one-time XP when no prayer task exists', async () => {
    localStorage.setItem('helm:tasks', '[]');
    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
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

    const first = renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });
    await waitFor(() => {
      const profile = JSON.parse(localStorage.getItem('helm:gamification') || '{}');
      expect(profile.totalXp).toBe(15);
      expect(profile.prayerCompletionLedger['2026-07-28::Fajr'].rewarded).toBe(true);
    });
    first.unmount();

    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(15);
    });
  });

  it('persists the activation-day eligibility from the matching schedule once', async () => {
    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{}');
      expect(stored.activationDayEligibility).toEqual({
        date: '2026-07-28',
        prayerNames: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
      });
    });
  });
});
