import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import App from '../App';
import { APP_RELEASE_VERSION } from '../config/release';

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

vi.mock('../components/VoiceAssistant', () => ({ default: () => null }));
vi.mock('../components/prayer/PrayerGlobalOverlays', () => ({ default: () => null }));

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should render the sidebar with all nav items', async () => {
    await act(async () => { renderWithProvider(<App />); });
    const sidebar = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(screen.getByText('HELM')).toBeInTheDocument();
    expect(screen.getByText('Current release')).toBeInTheDocument();
    expect(screen.getByText(APP_RELEASE_VERSION)).toBeInTheDocument();
    [
      'Dashboard',
      'Chat',
      'Inbox',
      'Calendar',
      'Clock',
      'Trips',
      'Projects',
      'Tasks',
      'Finance',
      'Health',
      'Knowledge',
      'Profile',
      'Integrations',
      'Activity',
      'Settings',
      'Debug',
    ].forEach(label => {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    });
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

    await act(async () => { fireEvent.click(screen.getByText('Inbox')); });
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Projects')); });
    expect(screen.getByText('Turn HELM into your local project hub')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Health')); });
    expect(screen.getByText('Fast food journal')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Activity')); });
    expect(screen.getByText('No Lina actions logged yet')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Settings')); });
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('restores the active surface after the shell remounts', async () => {
    let firstRender: ReturnType<typeof renderWithProvider>;

    await act(async () => {
      firstRender = renderWithProvider(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trips'));
    });

    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
    expect(sessionStorage.getItem('helm:shell-surface')).toBe('trips');

    firstRender!.unmount();

    await act(async () => { renderWithProvider(<App />); });

    expect(screen.getByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();
  });
});
