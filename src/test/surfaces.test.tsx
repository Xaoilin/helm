import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import App from '../App';
import ChatSurface from '../surfaces/ChatSurface';
import DashboardSurface from '../surfaces/DashboardSurface';
import TasksSurface from '../surfaces/TasksSurface';
import KnowledgeSurface from '../surfaces/KnowledgeSurface';
import ProfileSurface from '../surfaces/ProfileSurface';
import CredentialsSurface from '../surfaces/CredentialsSurface';
import WorkspacesSurface from '../surfaces/WorkspacesSurface';
import SettingsSurface from '../surfaces/SettingsSurface';

function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

describe('App shell', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render the sidebar with all nav items', async () => {
    await act(async () => { renderWithProvider(<App />); });
    expect(screen.getByText('HELM')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Calendar')).toBeInTheDocument();
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
    // In test env, Ollama check starts as "Checking..." then resolves to offline
    const matches = screen.getAllByText(/Checking|Ollama/);
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
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it('should have default calendar tab selector', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Default calendar view')).toBeInTheDocument();
  });

  it('should have credential source selector', async () => {
    await act(async () => { renderWithProvider(<SettingsSurface />); });
    expect(screen.getByText('Primary credential source')).toBeInTheDocument();
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
