import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import {
  installGoogleAuthPopupSpy,
  installGoogleCalendarFetchMock,
  renderWithProvider,
} from './surfaceTestHarness';
import { useApp } from '../store/AppContext';
import CalendarSurface from '../surfaces/CalendarSurface';
import DashboardSurface from '../surfaces/DashboardSurface';
import SettingsSurface from '../surfaces/SettingsSurface';
import TasksSurface from '../surfaces/TasksSurface';
import TripsSurface from '../surfaces/TripsSurface';

vi.mock('../hooks/useGoogleSync', () => {
  const value = {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
    triggerSync: vi.fn().mockResolvedValue(undefined),
    accountSyncStates: {},
    diagnostics: { accounts: {} },
    credentialStatuses: {},
    refreshCredentialStatuses: vi.fn().mockResolvedValue(undefined),
    serverRuntimeStatus: null,
  };

  return {
    GoogleSyncProvider: ({ children }: { children: unknown }) => children,
    useGoogleSync: () => value,
  };
});

function AppSurfaceNavigationHarness() {
  const app = useApp();
  const surface = (() => {
    switch (app.surface) {
      case 'calendar': return <CalendarSurface />;
      case 'settings': return <SettingsSurface />;
      case 'tasks': return <TasksSurface />;
      case 'trips': return <TripsSurface />;
      default: return <DashboardSurface />;
    }
  })();

  return (
    <>
      <button onClick={() => app.navigate('calendar')} aria-label="Navigate to Calendar">Calendar</button>
      <button onClick={() => app.navigate('settings')} aria-label="Navigate to Settings">Settings</button>
      <button onClick={() => app.requestAssistantNavigation('trips')}>Trigger assistant navigation</button>
      {surface}
    </>
  );
}

describe('App surface navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does not reopen Google auth when I switch back to Calendar with stale cached tokens', async () => {
    installGoogleCalendarFetchMock();
    const { initCodeClientMock, requestCodeMock } = installGoogleAuthPopupSpy();
    const staleIso = new Date(Date.now() - (20 * 60 * 1000)).toISOString();

    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'connected',
      lastAuthCheckAt: staleIso,
      lastSyncTime: staleIso,
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-google',
      accountId: 'acc-google',
      name: 'Primary',
      color: '#4f5bff',
      visible: true,
      googleCalendarId: 'alisa@example.com',
    }]));
    localStorage.setItem('helm:google-tokens:acc-google', JSON.stringify({
      accessToken: 'expired-stored-token',
      expiresAt: Date.now() - 60000,
      scope: 'https://www.googleapis.com/auth/calendar',
    }));

    await act(async () => { renderWithProvider(<AppSurfaceNavigationHarness />); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Calendar' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Settings' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Calendar' })); });

    expect(initCodeClientMock).not.toHaveBeenCalled();
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it('opens the compact second-order task queue without restoring generic ranking', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-open-me',
        title: 'Send the invoice',
        description: '',
        completed: false,
        priority: 'high',
        category: 'task',
        dueDate: '2026-04-15',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => {
      renderWithProvider(<AppSurfaceNavigationHarness />);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open tasks' }));
    });

    expect(await screen.findByText('All Tasks')).toBeInTheDocument();
    expect(screen.getByText('Send the invoice')).toBeInTheDocument();
    expect(screen.getByText('Send the invoice').closest('.assistant-focus')).toBeNull();
  });

  it('supports assistant navigation to the Trips surface', async () => {
    await act(async () => {
      renderWithProvider(<AppSurfaceNavigationHarness />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
  });
});
