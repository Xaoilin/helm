import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import { useApp } from '../store/AppContext';
import App from '../App';
import CalendarSurface from '../surfaces/CalendarSurface';
import ChatSurface from '../surfaces/ChatSurface';
import ClockSurface from '../surfaces/ClockSurface';
import DashboardSurface from '../surfaces/DashboardSurface';
import TripsSurface from '../surfaces/TripsSurface';
import TasksSurface from '../surfaces/TasksSurface';
import ProjectsSurface from '../surfaces/ProjectsSurface';
import KnowledgeSurface from '../surfaces/KnowledgeSurface';
import ProfileSurface from '../surfaces/ProfileSurface';
import IntegrationsSurface from '../surfaces/IntegrationsSurface';
import SettingsSurface from '../surfaces/SettingsSurface';
import * as googleCalendarApi from '../services/googleCalendarApi';
import * as googleCalendarAuthManager from '../services/googleCalendarAuthManager';
import * as hostedAssistantApi from '../services/hostedAssistantApi';
import { defaultIntegrations } from '../store/contexts/SettingsContext';
import { APP_RELEASE_VERSION } from '../config/release';
import type { AssistantNavigationTarget } from '../services/assistantNavigation';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function installGoogleCalendarFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.aladhan.com/v1/timingsByCity')) {
      return new Response(JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Dhuhr: '13:00',
            Asr: '16:30',
            Maghrib: '20:15',
            Isha: '21:45',
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('localhost:11434/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/users/me/calendarList')) {
      return new Response(JSON.stringify({
        items: [
          {
            id: 'alisa@example.com',
            summary: 'Primary',
            accessRole: 'owner',
            primary: true,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/events?')) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch in surfaces test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function installGoogleAuthPopupSpy() {
  const requestCodeMock = vi.fn();
  const initCodeClientMock = vi.fn(() => ({
    requestCode: requestCodeMock,
  }));

  Object.defineProperty(window, 'google', {
    value: {
      accounts: {
        oauth2: {
          initCodeClient: initCodeClientMock,
          revoke: vi.fn(),
        },
      },
    },
    configurable: true,
  });

  return {
    initCodeClientMock,
    requestCodeMock,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'google');
});

function TasksAssistantNavigationHarness({ target }: { target: AssistantNavigationTarget }) {
  const app = useApp();

  return (
    <>
      <button onClick={() => app.requestAssistantNavigation(target)}>Trigger assistant navigation</button>
      <TasksSurface />
    </>
  );
}

function AppAssistantNavigationHarness({ target }: { target: AssistantNavigationTarget }) {
  const app = useApp();

  return (
    <>
      <button onClick={() => app.requestAssistantNavigation(target)}>Trigger assistant navigation</button>
      <App />
    </>
  );
}

describe('App shell', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render the sidebar with all nav items', async () => {
    await act(async () => { renderWithProvider(<App />); });
    expect(screen.getByText('HELM')).toBeInTheDocument();
    expect(screen.getByText('Current release')).toBeInTheDocument();
    expect(screen.getByText(APP_RELEASE_VERSION)).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Clock')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should NOT have Approvals in the sidebar', async () => {
    await act(async () => { renderWithProvider(<App />); });
    expect(screen.queryByText('Approvals')).not.toBeInTheDocument();
  });

  it('should default to Dashboard surface', async () => {
    await act(async () => { renderWithProvider(<App />); });
    expect(screen.getByText('UP NEXT')).toBeInTheDocument();
  });

  it('should navigate between surfaces', async () => {
    await act(async () => { renderWithProvider(<App />); });

    await act(async () => { fireEvent.click(screen.getByText('Trips')); });
    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Projects')); });
    expect(screen.getByText('Turn HELM into your local project hub')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Settings')); });
    expect(screen.getByText('About')).toBeInTheDocument();
  });
});

describe('ChatSurface', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('should render empty state with welcome message', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('Lina Assistant')).toBeInTheDocument();
    expect(screen.getByText('New conversation')).toBeInTheDocument();
  });

  it('should render quick prompts', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('What should I focus on today?')).toBeInTheDocument();
    expect(screen.getByText('What meetings do I have coming up?')).toBeInTheDocument();
  });

  it('should show Ollama status indicator', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    const matches = screen.getAllByText(/Checking assistant|Ollama|Hosted AI|No AI provider/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should show no conversations yet text', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('should copy the active conversation as markdown for Codex', async () => {
    localStorage.setItem('helm:conversations', JSON.stringify([
      {
        id: 'conv-export',
        title: 'Delete my Internet task.',
        createdAt: '2026-04-13T09:00:00.000Z',
        updatedAt: '2026-04-13T09:05:00.000Z',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Delete my Internet task.',
            timestamp: '2026-04-13T09:00:00.000Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'I can delete that. Do you want me to continue?',
            timestamp: '2026-04-13T09:00:05.000Z',
          },
        ],
      },
    ]));

    await act(async () => { renderWithProvider(<ChatSurface />); });

    const conversationRow = await screen.findByText('Delete my Internet task.');

    await act(async () => {
      fireEvent.click(conversationRow.closest('.chat-list-item') as HTMLElement);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy Markdown' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('# HELM Chat Export'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Delete my Internet task.'));
    expect(screen.getByText('Conversation copied as Markdown.')).toBeInTheDocument();
  });

  it('shows an estimated OpenAI conversation total and excludes other providers', async () => {
    localStorage.setItem('helm:conversations', JSON.stringify([
      {
        id: 'conv-billing',
        title: 'Hosted billing conversation',
        createdAt: '2026-04-14T09:00:00.000Z',
        updatedAt: '2026-04-14T09:05:00.000Z',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Show me my tasks.',
            timestamp: '2026-04-14T09:00:00.000Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Opening your tasks.',
            timestamp: '2026-04-14T09:00:05.000Z',
            assistantBilling: {
              provider: 'openai',
              model: 'gpt-5.4',
              requestCount: 2,
              requests: [
                {
                  kind: 'planner',
                  responseId: 'resp-plan',
                  model: 'gpt-5.4',
                  serviceTier: 'default',
                  inputTokens: 1000,
                  cachedTokens: 100,
                  outputTokens: 200,
                  reasoningTokens: 120,
                  totalTokens: 1200,
                  estimatedUsd: 0.005275,
                },
                {
                  kind: 'narration',
                  responseId: 'resp-narration',
                  model: 'gpt-5.4',
                  serviceTier: 'default',
                  inputTokens: 600,
                  cachedTokens: 50,
                  outputTokens: 120,
                  reasoningTokens: 70,
                  totalTokens: 720,
                  estimatedUsd: 0.003188,
                },
              ],
              totals: {
                inputTokens: 1600,
                cachedTokens: 150,
                outputTokens: 320,
                reasoningTokens: 190,
                totalTokens: 1920,
              },
              estimatedUsd: 0.008463,
              estimateStatus: 'estimated_from_openai_usage',
              estimateLabel: 'Estimated from OpenAI usage',
            },
          },
          {
            id: 'msg-3',
            role: 'assistant',
            content: 'Fallback reply.',
            timestamp: '2026-04-14T09:00:08.000Z',
            assistantBilling: {
              provider: 'local',
              model: 'local-fallback',
              requestCount: 0,
              requests: [],
            },
          },
        ],
      },
    ]));

    await act(async () => { renderWithProvider(<ChatSurface />); });

    const conversationRow = await screen.findByText('Hosted billing conversation');

    await act(async () => {
      fireEvent.click(conversationRow.closest('.chat-list-item') as HTMLElement);
    });

    expect(screen.getByText('Estimated OpenAI conversation total')).toBeInTheDocument();
    expect(screen.getByText('$0.0085')).toBeInTheDocument();
    expect(screen.getByText(/2 hosted OpenAI requests across 1 assistant turn/i)).toBeInTheDocument();
    expect(screen.getByText(/1,600 input/i)).toBeInTheDocument();
    expect(screen.getByText('OpenAI-hosted turns only; other turns excluded.')).toBeInTheDocument();
  });
});

describe('ProjectsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    expect(screen.getByText('Turn HELM into your local project hub')).toBeInTheDocument();
  });

  it('should describe the new project-management scope', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    expect(screen.getByText(/kanban board/i)).toBeInTheDocument();
  });

  it('should have add project button', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    const buttons = screen.getAllByText('+ Add Project');
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('SettingsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render all settings sections', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('should show HELM version', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText(APP_RELEASE_VERSION)).toBeInTheDocument();
  });

  it('should have default calendar tab selector', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Default calendar view')).toBeInTheDocument();
  });

  it('should show assistant mode controls', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Open-ended AI mode')).toBeInTheDocument();
    expect(screen.getByText('Hosted OpenAI model')).toBeInTheDocument();
    expect(screen.getByText('Runtime status')).toBeInTheDocument();
  });

  it('should let you choose a curated hosted OpenAI model', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });

    const hostedModelSelect = screen.getByLabelText('Hosted OpenAI model');
    fireEvent.change(hostedModelSelect, { target: { value: 'gpt-5.4-mini' } });

    expect(screen.getByDisplayValue('GPT-5.4 mini - Best value')).toBeInTheDocument();
    expect(screen.getByText(/Lower-cost hosted model with strong general performance/i)).toBeInTheDocument();
  });

  it('should explain that turning Lina off keeps chat available and silences wake word access', async () => {
    localStorage.setItem('helm:settings', JSON.stringify({
      assistantEnabled: false,
      wakeWordEnabled: true,
    }));

    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText(/Turn this off when you want Lina fully quiet/i)).toBeInTheDocument();
    expect(screen.getByText(/Chat in the Chat tab still works/i)).toBeInTheDocument();
    expect(screen.getByText(/Lina is off\. The floating button, keyboard shortcut, and wake word are all disabled/i)).toBeInTheDocument();
    expect(screen.getByText(/Wake-word listening is currently inactive because Lina is turned off/i)).toBeInTheDocument();
  });

});

describe('CalendarSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should label local-only calendar state truthfully', async () => {
    await act(async () => { renderWithProvider(<CalendarSurface />); });
    expect(screen.getByText('Local-only data – not synced')).toBeInTheDocument();
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

    await act(async () => { renderWithProvider(<App />); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Calendar' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Settings' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate to Calendar' })); });

    expect(initCodeClientMock).not.toHaveBeenCalled();
    expect(requestCodeMock).not.toHaveBeenCalled();
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
});

describe('ClockSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render the multi-clock workspace controls', async () => {
    await act(async () => { renderWithProvider(<ClockSurface />); });
    expect(screen.getByText('Multi-clock workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatches' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timer 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatch 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name for Timer 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Name for Stopwatch 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Timer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Stopwatch' })).toBeInTheDocument();
    expect(screen.getByLabelText('Alarm sound for Timer 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview sound for Timer 1' })).toBeInTheDocument();
  });
});

describe('IntegrationsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should explain simulated provider connections', async () => {
    localStorage.setItem('helm:integrations', JSON.stringify(
      defaultIntegrations.map(integration =>
        integration.id === 'int-github'
          ? { ...integration, status: 'mocked', configuredAt: '2026-04-06T10:00:00.000Z' }
          : integration
      )
    ));

    await act(async () => { renderWithProvider(<IntegrationsSurface />); });
    expect(screen.getByText('This connection is simulated. No real data is being exchanged with GitHub.')).toBeInTheDocument();
  });

  it('should show reconnect-needed Google accounts per row', async () => {
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
    localStorage.setItem('helm:integrations', JSON.stringify(
      defaultIntegrations.map(integration =>
        integration.id === 'int-google'
          ? { ...integration, status: 'error', lastError: 'Google access expired. Reconnect this account.' }
          : integration
      )
    ));

    await act(async () => { renderWithProvider(<IntegrationsSurface />); });
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByText(/Access checked/i)).toBeInTheDocument();
    expect(screen.getByText(/Credential status/i)).toBeInTheDocument();
    expect(screen.queryByText(/Token expires/i)).not.toBeInTheDocument();
  });
});

describe('TasksSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state with tabs', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('Nothing for today')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('All Tasks')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
  });

  it('should have add task buttons', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('+ Add Task')).toBeInTheDocument();
    expect(screen.getByText('+ Daily Habit')).toBeInTheDocument();
  });

  it('should show no tasks subtitle', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });

  it('should switch to All Tasks from assistant navigation without a task id', async () => {
    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByRole('button', { name: 'All Tasks' })).toHaveClass('active');
    expect(screen.getByDisplayValue('All types')).toBeInTheDocument();
  });

  it('should reset All Tasks filters when assistant navigation asks for it', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-1',
        title: 'Buy milk',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-2',
        title: 'Water plants',
        description: '',
        completed: true,
        completedAt: '2026-04-10T10:00:00.000Z',
        priority: 'low',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]));

    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'completed' } });
    expect(screen.getByText('1 matching item')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByDisplayValue('All statuses')).toBeInTheDocument();
    expect(screen.getByText('2 matching items')).toBeInTheDocument();
  });

  it('should group all tasks into readable sections', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-overdue',
        title: 'Pay invoice',
        description: '',
        completed: false,
        priority: 'high',
        category: 'task',
        dueDate: yesterdayStr,
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-upcoming',
        title: 'Draft notes',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        dueDate: tomorrowStr,
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'habit-1',
        title: 'Stretch',
        description: '',
        completed: false,
        priority: 'low',
        category: 'daily',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'prayer-dhuhr',
        title: 'Dhuhr Prayer',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'prayer',
        prayerName: 'Dhuhr',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-done',
        title: 'Archive receipts',
        description: '',
        completed: true,
        completedAt: '2026-04-10T10:00:00.000Z',
        priority: 'low',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TasksSurface />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Islamic' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('Pay invoice')).toBeInTheDocument();
    expect(screen.getByText('Draft notes')).toBeInTheDocument();
    expect(screen.getByText('Dhuhr Prayer')).toBeInTheDocument();
    expect(screen.getByText('Stretch')).toBeInTheDocument();
  });

  it('should let me collapse and reopen all-task sections from the title', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'habit-accordion',
        title: 'Stretch',
        description: '',
        completed: false,
        priority: 'low',
        category: 'daily',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TasksSurface />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    const routinesHeading = screen.getByRole('heading', { name: 'Routines' });
    const routinesToggle = routinesHeading.closest('button');

    expect(routinesToggle).not.toBeNull();
    expect(screen.getByText('Stretch')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(routinesToggle!);
    });

    expect(screen.queryByText('Stretch')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(routinesToggle!);
    });

    expect(screen.getByText('Stretch')).toBeInTheDocument();
  });

  it('should highlight the resolved task when assistant navigation includes a task id', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-1',
        title: 'Buy milk',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    ]));

    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
                revealTaskId: 'task-1',
                highlightTaskId: 'task-1',
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByText('Buy milk').closest('.assistant-focus')).not.toBeNull();
  });
});

describe('ProfileSurface', () => {
  beforeEach(() => { localStorage.clear(); });

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
});

describe('DashboardSurface', () => {
  beforeEach(() => { localStorage.clear(); });

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

  it('opens a recommended task into the Tasks surface with assistant reveal highlighting', async () => {
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
      renderWithProvider(<App />);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open task' }));
    });

    expect(await screen.findByText('All Tasks')).toBeInTheDocument();
    expect(screen.getByText('Send the invoice').closest('.assistant-focus')).not.toBeNull();
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

describe('TripsSurface', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the empty state CTA', async () => {
    await act(async () => { renderWithProvider(<TripsSurface />); });
    expect(screen.getByRole('heading', { name: 'Plan your first trip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
  });

  it('creates a trip from the guided wizard and derives the trip date range', async () => {
    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Plan your first trip' }));
    });

    fireEvent.change(screen.getByLabelText('Trip Name'), { target: { value: 'Euro Sprint' } });
    fireEvent.change(screen.getByLabelText('Short Summary'), { target: { value: 'Two fast city stops.' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    const countryInputs = screen.getAllByPlaceholderText('Country');
    const cityInputs = screen.getAllByPlaceholderText('City');
    const routeDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(countryInputs[0], { target: { value: 'France' } });
    fireEvent.change(cityInputs[0], { target: { value: 'Paris' } });
    fireEvent.change(routeDateInputs[0], { target: { value: '2026-07-01' } });
    fireEvent.change(routeDateInputs[1], { target: { value: '2026-07-03' } });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Add Destination'));
    });

    const nextCountryInputs = screen.getAllByPlaceholderText('Country');
    const nextCityInputs = screen.getAllByPlaceholderText('City');
    const nextRouteDateInputs = Array.from(document.querySelectorAll('.trip-wizard-modal input[type="date"]')) as HTMLInputElement[];

    fireEvent.change(nextCountryInputs[1], { target: { value: 'Italy' } });
    fireEvent.change(nextCityInputs[1], { target: { value: 'Rome' } });
    fireEvent.change(nextRouteDateInputs[2], { target: { value: '2026-07-04' } });
    fireEvent.change(nextRouteDateInputs[3], { target: { value: '2026-07-06' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Next'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Trip'));
    });

    await waitFor(() => {
      const trips = JSON.parse(localStorage.getItem('helm:trips') || '[]');
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({
        name: 'Euro Sprint',
        startDate: '2026-07-01',
        endDate: '2026-07-06',
      });
    });

    expect((await screen.findAllByText('Euro Sprint')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paris, France/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rome, Italy/).length).toBeGreaterThan(0);
  });

  it('renders all trip days in order and sorts itinerary items by time', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Summer Route',
      summary: 'Paris then Rome',
      notes: '',
      status: 'planning',
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([
      {
        id: 'leg-1',
        tripId: 'trip-1',
        country: 'France',
        city: 'Paris',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'leg-2',
        tripId: 'trip-1',
        country: 'Italy',
        city: 'Rome',
        startDate: '2026-07-03',
        endDate: '2026-07-03',
        sortOrder: 1,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([
      {
        id: 'item-2',
        tripId: 'trip-1',
        legId: 'leg-1',
        date: '2026-07-01',
        title: 'Museum visit',
        startTime: '11:00',
        notes: '',
        sortOrder: 1,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'item-1',
        tripId: 'trip-1',
        legId: 'leg-1',
        date: '2026-07-01',
        title: 'Morning coffee',
        startTime: '08:00',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    expect(screen.getAllByText('+ Add Plan')).toHaveLength(3);
    const timelineSection = screen.getByText('Morning coffee').closest('.card');
    expect(timelineSection).not.toBeNull();
    expect(timelineSection?.textContent?.indexOf('Morning coffee')).toBeLessThan(timelineSection?.textContent?.indexOf('Museum visit') ?? 0);
    expect(screen.getByText('2 days in this destination.')).toBeInTheDocument();
    expect(screen.getByText('1 day in this destination.')).toBeInTheDocument();
  });

  it('creates, edits, deletes, and sorts bookings', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Italy Week',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Italy',
      city: 'Rome',
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([{
      id: 'booking-old',
      tripId: 'trip-1',
      legId: 'leg-1',
      kind: 'transport',
      mode: 'ferry',
      title: 'Old ferry',
      fromLabel: 'Naples',
      toLabel: 'Palermo',
      departAt: '2020-07-20T09:00',
      arriveAt: '2020-07-20T13:00',
      notes: '',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Flight to Rome' } });
    fireEvent.change(screen.getByLabelText('Depart'), { target: { value: '2026-08-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Arrive'), { target: { value: '2026-08-02T11:30' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Stay'));
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Rome Hotel' } });
    fireEvent.change(screen.getByLabelText('Property'), { target: { value: 'Hotel Roma' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Rome' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Italy' } });
    fireEvent.change(screen.getByLabelText('Check In'), { target: { value: '2026-08-02' } });
    fireEvent.change(screen.getByLabelText('Check Out'), { target: { value: '2026-08-05' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    const transportCard = screen.getByText('Transport').closest('.card') as HTMLElement;
    expect(transportCard.textContent?.indexOf('Flight to Rome')).toBeLessThan(transportCard.textContent?.indexOf('Old ferry') ?? 0);

    await act(async () => {
      fireEvent.click(within(transportCard).getAllByText('Edit')[0]);
    });

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Flight to Rome - Updated' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Booking'));
    });

    expect(screen.getByText('Flight to Rome - Updated')).toBeInTheDocument();

    const stayCard = screen.getByText('Stay').closest('.card') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(stayCard as HTMLElement).getByText('Delete'));
    });

    expect(screen.queryByText('Rome Hotel')).not.toBeInTheDocument();
  });

  it('shows booking validation feedback instead of failing silently', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-booking-validation',
      name: 'Validation Trip',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('+ Transport'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Create Booking'));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Add a title, a departure time, and an arrival time before saving this booking.');
    expect(screen.getByText('Add Booking')).toBeInTheDocument();
    expect(screen.queryByText('Transport booking')).not.toBeInTheDocument();
  });

  it('cascades trip deletion to legs, itinerary items, and bookings only for that trip', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem('helm:trips', JSON.stringify([
      {
        id: 'trip-delete',
        name: 'Delete Me',
        summary: '',
        notes: '',
        status: 'planning',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'trip-keep',
        name: 'Keep Me',
        summary: '',
        notes: '',
        status: 'planning',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([
      {
        id: 'leg-delete',
        tripId: 'trip-delete',
        country: 'France',
        city: 'Paris',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'leg-keep',
        tripId: 'trip-keep',
        country: 'Italy',
        city: 'Rome',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([
      {
        id: 'item-delete',
        tripId: 'trip-delete',
        legId: 'leg-delete',
        date: '2026-07-01',
        title: 'Delete item',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'item-keep',
        tripId: 'trip-keep',
        legId: 'leg-keep',
        date: '2026-08-01',
        title: 'Keep item',
        notes: '',
        sortOrder: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([
      {
        id: 'booking-delete',
        tripId: 'trip-delete',
        legId: 'leg-delete',
        kind: 'stay',
        title: 'Delete stay',
        propertyName: 'Delete hotel',
        city: 'Paris',
        country: 'France',
        checkInDate: '2026-07-01',
        checkOutDate: '2026-07-02',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'booking-keep',
        tripId: 'trip-keep',
        legId: 'leg-keep',
        kind: 'stay',
        title: 'Keep stay',
        propertyName: 'Keep hotel',
        city: 'Rome',
        country: 'Italy',
        checkInDate: '2026-08-01',
        checkOutDate: '2026-08-02',
        notes: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('helm:trips') || '[]')).toEqual([
        expect.objectContaining({ id: 'trip-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripLegs') || '[]')).toEqual([
        expect.objectContaining({ id: 'leg-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripItineraryItems') || '[]')).toEqual([
        expect.objectContaining({ id: 'item-keep' }),
      ]);
      expect(JSON.parse(localStorage.getItem('helm:tripBookings') || '[]')).toEqual([
        expect.objectContaining({ id: 'booking-keep' }),
      ]);
    });
  });

  it('imports trip plans into calendar when a source exists', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'City Break',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Spain',
      city: 'Madrid',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-09-01',
      title: 'Museum visit',
      startTime: '10:00',
      endTime: '12:00',
      notes: 'Buy tickets first.',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
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

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Add to Calendar')[0]);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add Event'));
    });

    await waitFor(() => {
      const events = JSON.parse(localStorage.getItem('helm:calendarEvents') || '[]');
      expect(events[0]).toMatchObject({
        sourceId: 'src-1',
        title: 'Museum visit',
      });
    });
  });

  it('shows a truthful inline notice when no calendar source exists', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Solo Day',
      summary: '',
      notes: '',
      status: 'planning',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Portugal',
      city: 'Lisbon',
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-10-01',
      title: 'River walk',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Add to Calendar')[0]);
    });

    expect(screen.getByText('Add a calendar source first, then you can import trip items into Calendar.')).toBeInTheDocument();
    expect(screen.getByText('Open Calendar')).toBeInTheDocument();
  });

  it('loads persisted trips, itinerary items, and bookings from storage', async () => {
    localStorage.setItem('helm:trips', JSON.stringify([{
      id: 'trip-1',
      name: 'Loaded Trip',
      summary: 'From storage',
      notes: 'Packed and ready.',
      status: 'booked',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripLegs', JSON.stringify([{
      id: 'leg-1',
      tripId: 'trip-1',
      country: 'Germany',
      city: 'Berlin',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripBookings', JSON.stringify([{
      id: 'booking-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      kind: 'stay',
      title: 'Berlin stay',
      propertyName: 'Hotel Mitte',
      city: 'Berlin',
      country: 'Germany',
      checkInDate: '2026-11-01',
      checkOutDate: '2026-11-03',
      notes: '',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));
    localStorage.setItem('helm:tripItineraryItems', JSON.stringify([{
      id: 'item-1',
      tripId: 'trip-1',
      legId: 'leg-1',
      date: '2026-11-02',
      title: 'Gallery day',
      notes: '',
      sortOrder: 0,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }]));

    await act(async () => { renderWithProvider(<TripsSurface />); });

    expect(screen.getAllByText('Loaded Trip').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Berlin, Germany/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    });
    expect(screen.getByText('Berlin stay')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    });
    expect(screen.getByText('Gallery day')).toBeInTheDocument();
  });

  it('supports assistant navigation to the Trips surface', async () => {
    await act(async () => {
      renderWithProvider(<AppAssistantNavigationHarness target="trips" />);
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('Trigger assistant navigation'));
    });

    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
  });
});

describe('KnowledgeSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state with tabs', async () => {
    await act(async () => { renderWithProvider(<KnowledgeSurface />); });
    expect(screen.getByText('Start Your Knowledge Base')).toBeInTheDocument();
    expect(screen.getByText('Browse')).toBeInTheDocument();
    expect(screen.getByText('Add Entry')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('should have create topic button', async () => {
    await act(async () => { renderWithProvider(<KnowledgeSurface />); });
    expect(screen.getByText('+ Create First Topic')).toBeInTheDocument();
  });
});
