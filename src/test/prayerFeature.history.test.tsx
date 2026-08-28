import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  flushPrayerFeatureUpdates,
  installPrayerFeatureHarness,
  renderPrayerFeatureApp,
} from './prayerFeatureHarness';

installPrayerFeatureHarness();

describe('prayer completion history', () => {
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

    renderPrayerFeatureApp();
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset All Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Reset Everything' }));
    await flushPrayerFeatureUpdates();

    const stored = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{}');
    expect(stored.records).toEqual({});
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

    renderPrayerFeatureApp();
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Night Compass' });
    const fajrCard = screen.getByText('Fajr', { selector: '.nc-prayer-name' })
      .closest('.nc-prayer-item');
    expect(fajrCard).toHaveTextContent('Before tracking');
    expect(fajrCard).not.toHaveTextContent('Missed');

    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const fajrCorrection = screen.getByLabelText('Fajr outcome on Today');
    expect(fajrCorrection).toBeDisabled();
    expect(fajrCorrection).toHaveValue('not_tracked');
    expect(fajrCorrection).toHaveAttribute('title', expect.stringContaining('before classified tracking began'));
  });

  it('corrects a recorded status without awarding XP again', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    renderPrayerFeatureApp();
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Tasks' });

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(screen.getByRole('button', { name: /On time/ }));
    await flushPrayerFeatureUpdates();
    expect(localStorage.getItem('helm:gamification')).toContain('"totalXp":15');
    const xpBefore = JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp;

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Dashboard' }));
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Night Compass' });
    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const fajrCorrection = screen.getByLabelText('Fajr outcome on Today');
    const dhuhrCorrection = screen.getByLabelText('Dhuhr outcome on Today');
    expect(fajrCorrection).toBeEnabled();
    expect(dhuhrCorrection).toBeDisabled();
    expect(dhuhrCorrection).toHaveAttribute('aria-describedby', 'prayer-history-help');
    expect(dhuhrCorrection).toHaveAttribute('title', expect.stringContaining('Pending prayers cannot be corrected'));

    fireEvent.change(fajrCorrection, { target: { value: 'missed' } });
    await flushPrayerFeatureUpdates();

    expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"missed"');
    expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}').totalXp).toBe(xpBefore);

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to Tasks' }));
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Tasks' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(screen.getByRole('button', { name: /Late/ }));
    await flushPrayerFeatureUpdates();

    expect(localStorage.getItem('helm:prayerTracking')).toContain('"status":"late"');
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

    renderPrayerFeatureApp();
    await flushPrayerFeatureUpdates();
    screen.getByRole('heading', { name: 'Night Compass' });
    fireEvent.click(screen.getByRole('button', { name: 'Correct history' }));
    const correction = screen.getByLabelText('Fajr outcome on Today');

    fireEvent.change(correction, { target: { value: 'missed' } });
    await flushPrayerFeatureUpdates();
    expect(JSON.parse(localStorage.getItem('helm:gamification') || '{}')
      .dailyLog['2026-07-28']).toBeUndefined();

    fireEvent.change(correction, { target: { value: 'late' } });
    await flushPrayerFeatureUpdates();
    const profile = JSON.parse(localStorage.getItem('helm:gamification') || '{}');
    expect(profile.totalXp).toBe(15);
    expect(profile.dailyLog['2026-07-28']).toEqual(['new-fajr']);
  });
});
