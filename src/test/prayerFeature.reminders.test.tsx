import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  installPrayerFeatureHarness,
  renderPrayerFeatureApp,
} from './prayerFeatureHarness';

installPrayerFeatureHarness();

describe('prayer completion reminders', () => {
  it('shows a global non-Dashboard deadline warning, completes from it, and persists stats after reload', async () => {
    sessionStorage.setItem('helm:shell-surface', 'settings');
    const firstRender = renderPrayerFeatureApp();
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    const warningTitle = await screen.findByText('Pray Fajr before it is too late');
    const warning = warningTitle.closest('[role="alert"]');
    expect(warning).not.toBeNull();
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
      renderPrayerFeatureApp();
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
    renderPrayerFeatureApp();
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
    renderPrayerFeatureApp();

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

    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Settings' });
    await waitFor(() => expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"unclassified"'));

    expect(screen.queryByText('Pray Fajr before it is too late')).not.toBeInTheDocument();
  });
});
