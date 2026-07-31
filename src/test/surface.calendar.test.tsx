import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvider, installGoogleCalendarFetchMock, installGoogleAuthPopupSpy } from './surfaceTestHarness';
import CalendarSurface from '../surfaces/CalendarSurface';
import * as googleCalendarApi from '../services/googleCalendarApi';
import * as googleCalendarAuthManager from '../services/googleCalendarAuthManager';

describe('CalendarSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should label a manual calendar without implying shared data is local-only', async () => {
    await act(async () => { renderWithProvider(<CalendarSurface />); });
    expect(screen.getByText('Manual calendar – no external provider sync')).toBeInTheDocument();
  });

  it('labels the header count as visible calendar events', async () => {
    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-local',
      name: 'Local',
      email: 'local@example.com',
      provider: 'local',
      isPrimary: true,
      connected: false,
      mocked: true,
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-visible',
      accountId: 'acc-local',
      name: 'Visible',
      color: '#4f5bff',
      visible: true,
    }, {
      id: 'src-hidden',
      accountId: 'acc-local',
      name: 'Hidden',
      color: '#22c55e',
      visible: false,
    }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([{
      id: 'evt-visible',
      sourceId: 'src-visible',
      title: 'Visible meeting',
      description: '',
      start: '2026-05-07T09:00:00.000Z',
      end: '2026-05-07T10:00:00.000Z',
      allDay: false,
    }, {
      id: 'evt-hidden',
      sourceId: 'src-hidden',
      title: 'Hidden meeting',
      description: '',
      start: '2026-05-07T11:00:00.000Z',
      end: '2026-05-07T12:00:00.000Z',
      allDay: false,
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });

    expect(screen.getByText(/1 account · 1 visible event/i)).toBeInTheDocument();
  });

  it('should surface reconnect-required Google accounts without prompting', async () => {
    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastAuthError: 'Google access expired. Reconnect this account.',
      lastAuthCheckAt: '2026-04-07T10:00:00.000Z',
      authExpiresAt: '2026-04-07T09:45:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });
    expect(screen.getByText('1 account need reconnect')).toBeInTheDocument();
  });

  it('shows Google access checks separately from credential status in the accounts view', async () => {
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
      lastSyncTime: '2026-04-07T10:15:00.000Z',
      lastAuthCheckAt: '2026-04-07T10:00:00.000Z',
      authExpiresAt: '2026-04-07T09:45:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accounts & Sources' })); });

    expect(screen.getByText(/Access checked/i)).toBeInTheDocument();
    expect(screen.getByText(/Credential status/i)).toBeInTheDocument();
    expect(screen.queryByText(/Token expires/i)).not.toBeInTheDocument();
  });

  it('keeps the Sync button non-interactive even when the cached Google token is stale', async () => {
    installGoogleCalendarFetchMock();
    const { initCodeClientMock, requestCodeMock } = installGoogleAuthPopupSpy();

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
      lastAuthCheckAt: new Date().toISOString(),
      lastSyncTime: new Date().toISOString(),
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

    await act(async () => { renderWithProvider(<CalendarSurface />); });

    fireEvent.click(screen.getByRole('button', { name: /sync/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument();
    });

    expect(initCodeClientMock).not.toHaveBeenCalled();
    expect(requestCodeMock).not.toHaveBeenCalled();
  });

  it('still deletes a Google event locally and remotely when I explicitly confirm delete', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const deleteEventSpy = vi.spyOn(googleCalendarApi, 'deleteEvent').mockResolvedValue(undefined);
    vi.spyOn(googleCalendarAuthManager, 'getGoogleCalendarPassiveAccessTokenWithRefresh').mockResolvedValue({
      accessToken: 'stored-token',
      authProvider: 'calendar-oauth',
      authExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });

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
      lastAuthCheckAt: now.toISOString(),
      lastSyncTime: now.toISOString(),
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-google',
      accountId: 'acc-google',
      name: 'Primary',
      color: '#4f5bff',
      visible: true,
      googleCalendarId: 'alisa@example.com',
    }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([{
      id: 'evt-google',
      sourceId: 'src-google',
      title: 'Delete me from Google',
      description: '',
      start,
      end,
      allDay: false,
      googleEventId: 'google-event-1',
      googleCalendarId: 'alisa@example.com',
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agenda' })); });
    await act(async () => { fireEvent.click(screen.getByText('Delete me from Google')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' })); });

    await waitFor(() => {
      expect(deleteEventSpy).toHaveBeenCalledWith('stored-token', 'alisa@example.com', 'google-event-1');
      expect(screen.queryByText('Delete me from Google')).not.toBeInTheDocument();
    });
  });

  it('keeps the cached Google event when a provider delete fails', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    vi.spyOn(googleCalendarApi, 'deleteEvent').mockRejectedValue(new Error('provider unavailable'));
    vi.spyOn(googleCalendarAuthManager, 'getGoogleCalendarPassiveAccessTokenWithRefresh').mockResolvedValue({
      accessToken: 'stored-token',
      authProvider: 'calendar-oauth',
      authExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });

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
      lastAuthCheckAt: now.toISOString(),
      lastSyncTime: now.toISOString(),
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-google',
      accountId: 'acc-google',
      name: 'Primary',
      color: '#4f5bff',
      visible: true,
      googleCalendarId: 'alisa@example.com',
    }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([{
      id: 'evt-google',
      sourceId: 'src-google',
      title: 'Do not delete locally',
      description: '',
      start,
      end,
      allDay: false,
      googleEventId: 'google-event-1',
      googleCalendarId: 'alisa@example.com',
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agenda' })); });
    await act(async () => { fireEvent.click(screen.getByText('Do not delete locally')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Google Calendar was not changed/i);
    const events = JSON.parse(localStorage.getItem('helm:calendarEvents') || '[]');
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('pendingSync');
  });
});
