import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, within } from '@testing-library/react';
import { renderWithProvider, installGoogleCalendarFetchMock } from './surfaceTestHarness';
import ProfileSurface from '../surfaces/ProfileSurface';

describe('ProfileSurface', () => {
  beforeEach(() => {
    localStorage.clear();
    installGoogleCalendarFetchMock();
  });

  it('should render profile with level and sections', async () => {
    await act(async () => { renderWithProvider(<ProfileSurface />); });
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Streak')).toBeInTheDocument();
    expect(screen.getByText(/Badges/)).toBeInTheDocument();
    expect(screen.getByText('Stats')).toBeInTheDocument();
  });

  it('should show all 9 badges', async () => {
    await act(async () => { renderWithProvider(<ProfileSurface />); });
    // All badges should be listed (locked state)
    expect(screen.getByText('First Blood')).toBeInTheDocument();
    expect(screen.getByText('Hat Trick')).toBeInTheDocument();
    expect(screen.getByText('Unstoppable')).toBeInTheDocument();
  });

  it('should show zero stats when fresh', async () => {
    await act(async () => { renderWithProvider(<ProfileSurface />); });
    expect(screen.getByText('0 XP')).toBeInTheDocument();
    expect(screen.getByText('No active streak')).toBeInTheDocument();
  });

  it('shows month-by-month prayer rate history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));

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
        createdAt: '2026-03-31T08:00:00.000Z',
        updatedAt: '2026-04-02T08:00:00.000Z',
      },
      {
        id: 'prayer-dhuhr',
        title: 'Dhuhr Prayer',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'prayer',
        prayerName: 'Dhuhr',
        recurring: { frequency: 'daily' },
        createdAt: '2026-03-31T08:00:00.000Z',
        updatedAt: '2026-04-02T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:prayerTracking', JSON.stringify({
      schemaVersion: 1,
      trackingStartedAt: '2026-03-31T00:00:00.000Z',
      reminderReceipts: {},
      records: {
        '2026-03-31::Fajr': {
          date: '2026-03-31',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: '2026-03-31T05:20:00.000Z',
        },
        '2026-04-01::Fajr': {
          date: '2026-04-01',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: '2026-04-01T05:20:00.000Z',
        },
        '2026-04-01::Dhuhr': {
          date: '2026-04-01',
          prayerName: 'Dhuhr',
          status: 'late',
          recordedAt: '2026-04-01T21:00:00.000Z',
        },
      },
    }));

    try {
      await act(async () => { renderWithProvider(<ProfileSurface />); });

      expect(screen.getByText('Month history')).toBeInTheDocument();
      const history = screen.getByLabelText('Prayer outcome history by month');
      expect(within(history).getByText('April 2026')).toBeInTheDocument();
      expect(within(history).getByText('March 2026')).toBeInTheDocument();
      expect(within(history).getAllByText('classified').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
