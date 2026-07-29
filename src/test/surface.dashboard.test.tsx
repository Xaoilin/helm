import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvider, installGoogleCalendarFetchMock } from './surfaceTestHarness';
import DashboardSurface from '../surfaces/DashboardSurface';
import * as hostedAssistantApi from '../services/hostedAssistantApi';

describe('DashboardSurface', () => {
  beforeEach(() => {
    localStorage.clear();
    installGoogleCalendarFetchMock();
  });

  it('should render greeting and up next section', async () => {
    await act(async () => { renderWithProvider(<DashboardSurface />); });
    expect(screen.getByText('UP NEXT')).toBeInTheDocument();
    expect(screen.getAllByText("You're all caught up").length).toBeGreaterThan(0);
  });

  it('should render all dashboard sections', async () => {
    await act(async () => { renderWithProvider(<DashboardSurface />); });
    expect(screen.getByText('Task Snapshot')).toBeInTheDocument();
    expect(screen.getByText("Today's Agenda")).toBeInTheDocument();
    expect(screen.getByText('Daily Habits')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Next Milestone')).toBeInTheDocument();
  });

  it('scopes the prayer rate card to the current month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));

    localStorage.setItem('helm:settings', JSON.stringify({
      prayerEnabled: true,
      prayerReminderEnabled: false,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
    }));
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
      await act(async () => { renderWithProvider(<DashboardSurface />); });

      const prayerCard = screen.getByText(/Prayer outcomes/).closest('.dash-card');
      expect(prayerCard).not.toBeNull();
      expect(prayerCard).toHaveTextContent('On time');
      expect(prayerCard).toHaveTextContent('Late');
      expect(prayerCard).toHaveTextContent('Missed');
      expect(prayerCard).toHaveTextContent('20 tracked days');
      expect(prayerCard).not.toHaveTextContent('March 2026');
    } finally {
      vi.useRealTimers();
    }
  });

  it('separates prayer tasks into an Islamic dashboard section', async () => {
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
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'habit-water',
        title: 'Drink 1L Water',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'daily',
        recurring: { frequency: 'daily' },
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<DashboardSurface />); });

    const islamicCard = screen.getByText('Islamic').closest('.dash-card');
    const habitsCard = screen.getByText('Daily Habits').closest('.dash-card');

    expect(islamicCard).not.toBeNull();
    expect(habitsCard).not.toBeNull();
    expect(islamicCard).toHaveTextContent('Fajr Prayer');
    expect(islamicCard).not.toHaveTextContent('Drink 1L Water');
    expect(habitsCard).toHaveTextContent('Drink 1L Water');
    expect(habitsCard).not.toHaveTextContent('Fajr Prayer');
  });

  it('should show gamification stats in header', async () => {
    await act(async () => { renderWithProvider(<DashboardSurface />); });
    expect(screen.getByText(/Lv\.1/)).toBeInTheDocument();
    expect(screen.getByText('0 XP')).toBeInTheDocument();
  });

  it('should show timed meetings in chronological order', async () => {
    const today = new Date();
    const morningStart = new Date(today);
    morningStart.setHours(10, 15, 0, 0);
    const morningEnd = new Date(today);
    morningEnd.setHours(11, 15, 0, 0);
    const afternoonStart = new Date(today);
    afternoonStart.setHours(13, 0, 0, 0);
    const afternoonEnd = new Date(today);
    afternoonEnd.setHours(13, 20, 0, 0);

    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-1',
      name: 'Personal',
      email: 'alisa@example.com',
      provider: 'local',
      isPrimary: true,
      connected: true,
      mocked: false,
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-1',
      accountId: 'acc-1',
      name: 'Personal',
      color: '#4285f4',
      visible: true,
    }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([
      {
        id: 'evt-afternoon',
        sourceId: 'src-1',
        title: 'Afternoon meeting',
        description: '',
        start: afternoonStart.toISOString(),
        end: afternoonEnd.toISOString(),
        allDay: false,
      },
      {
        id: 'evt-morning',
        sourceId: 'src-1',
        title: 'Morning meeting',
        description: '',
        start: morningStart.toISOString(),
        end: morningEnd.toISOString(),
        allDay: false,
      },
    ]));

    await act(async () => { renderWithProvider(<DashboardSurface />); });

    const agendaCard = screen.getByText("Today's Agenda").closest('.dash-card');
    expect(agendaCard).not.toBeNull();

    const agendaTitles = Array.from(agendaCard!.querySelectorAll('.dash-agenda-title'))
      .map(node => node.textContent);
    expect(agendaTitles).toEqual(['Morning meeting', 'Afternoon meeting']);
  });

  it('quick completes a recommended task from the dashboard snapshot', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-quick-complete',
        title: 'Review launch copy',
        description: '',
        completed: false,
        priority: 'high',
        category: 'task',
        dueDate: '2026-04-15',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<DashboardSurface />); });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Complete now' }));
    });

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('helm:tasks') || '[]');
      expect(persisted[0]?.completed).toBe(true);
    });
  });

  it('shows a truthful GPT unavailable state when dashboard focus falls back locally', async () => {
    vi.spyOn(hostedAssistantApi, 'testHostedAssistantConnection').mockResolvedValue({
      status: 'unavailable',
      message: 'Hosted AI could not be reached.',
    });
    localStorage.setItem('helm:settings', JSON.stringify({
      assistantProvider: 'hosted',
      prayerEnabled: false,
    }));
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'habit-walk-hour',
        title: 'Walk 1 hour',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'daily',
        recurring: { frequency: 'daily' },
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<DashboardSurface />); });

    expect(await screen.findByText('GPT unavailable')).toBeInTheDocument();
    expect(screen.getByText('Hosted AI could not be reached.')).toBeInTheDocument();
    expect(screen.getAllByText('60 min').length).toBeGreaterThan(0);
  });

  it('hides heuristic dashboard durations instead of showing made-up minutes', async () => {
    localStorage.setItem('helm:settings', JSON.stringify({
      assistantProvider: 'ollama',
      prayerEnabled: false,
    }));
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'habit-pushups',
        title: '25 Push Ups',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'daily',
        recurring: { frequency: 'daily' },
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<DashboardSurface />); });

    expect((await screen.findAllByText('25 Push Ups')).length).toBeGreaterThan(0);
    expect(screen.queryByText('10 min')).not.toBeInTheDocument();
  });
});
