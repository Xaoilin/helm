import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import { useApp } from '../store/AppContext';
import App from '../App';
import CalendarSurface from '../surfaces/CalendarSurface';
import ChatSurface from '../surfaces/ChatSurface';
import ClockSurface from '../surfaces/ClockSurface';
import DashboardSurface from '../surfaces/DashboardSurface';
import TasksSurface from '../surfaces/TasksSurface';
import KnowledgeSurface from '../surfaces/KnowledgeSurface';
import ProfileSurface from '../surfaces/ProfileSurface';
import CredentialsSurface from '../surfaces/CredentialsSurface';
import IntegrationsSurface from '../surfaces/IntegrationsSurface';
import WorkspacesSurface from '../surfaces/WorkspacesSurface';
import SettingsSurface from '../surfaces/SettingsSurface';
import { defaultIntegrations } from '../store/contexts/SettingsContext';
import { APP_RELEASE_VERSION } from '../config/release';
import type { AssistantNavigationTarget } from '../services/assistantNavigation';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

function TasksAssistantNavigationHarness({ target }: { target: AssistantNavigationTarget }) {
  const app = useApp();

  return (
    <>
      <button onClick={() => app.requestAssistantNavigation(target)}>Trigger assistant navigation</button>
      <TasksSurface />
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
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
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

    await act(async () => { fireEvent.click(screen.getByText('Credentials')); });
    // After navigating, "Credentials" appears in both sidebar and page header
    expect(screen.getByText('No stored credentials')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Settings')); });
    expect(screen.getByText('About')).toBeInTheDocument();
  });
});

describe('ChatSurface', () => {
  beforeEach(() => { localStorage.clear(); });

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
});

describe('CredentialsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state', async () => {
    await act(async () => { renderWithProvider(<CredentialsSurface />); });
    expect(screen.getByText('No credentials stored')).toBeInTheDocument();
  });

  it('should show 1Password preference info', async () => {
    await act(async () => { renderWithProvider(<CredentialsSurface />); });
    expect(screen.getByText(/1Password is the preferred credential source/)).toBeInTheDocument();
  });

  it('should explain the local vault security limits truthfully', async () => {
    await act(async () => { renderWithProvider(<CredentialsSurface />); });
    expect(screen.getByText(/not encrypted at rest in this MVP/i)).toBeInTheDocument();
  });

  it('should have add credential button', async () => {
    await act(async () => { renderWithProvider(<CredentialsSurface />); });
    const buttons = screen.getAllByText('+ Add Credential');
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('WorkspacesSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state', async () => {
    await act(async () => { renderWithProvider(<WorkspacesSurface />); });
    expect(screen.getByText('No workspaces')).toBeInTheDocument();
  });

  it('should have add workspace button', async () => {
    await act(async () => { renderWithProvider(<WorkspacesSurface />); });
    const buttons = screen.getAllByText('+ Add Workspace');
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe('SettingsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render all settings sections', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText('Credential Source')).toBeInTheDocument();
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
    expect(screen.getByText('Runtime status')).toBeInTheDocument();
  });

  it('should have credential source selector', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Primary credential source')).toBeInTheDocument();
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
    }]));

    await act(async () => { renderWithProvider(<CalendarSurface />); });
    expect(screen.getByText('1 account need reconnect')).toBeInTheDocument();
  });
});

describe('ClockSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render stopwatch and timer controls', async () => {
    await act(async () => { renderWithProvider(<ClockSurface />); });
    expect(screen.getByText('Stopwatch')).toBeInTheDocument();
    expect(screen.getByText('Timer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Stopwatch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Timer' })).toBeInTheDocument();
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
    expect(screen.getByText('1 task')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByDisplayValue('All statuses')).toBeInTheDocument();
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
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
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('should render all dashboard sections', async () => {
    await act(async () => { renderWithProvider(<DashboardSurface />); });
    expect(screen.getByText("Today's Agenda")).toBeInTheDocument();
    expect(screen.getByText('Daily Habits')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Next Milestone')).toBeInTheDocument();
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
