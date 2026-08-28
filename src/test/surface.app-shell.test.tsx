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
    expect(screen.getByText('SABAH ONE')).toBeInTheDocument();
    expect(screen.getByText('Current release')).toBeInTheDocument();
    expect(screen.getByText(APP_RELEASE_VERSION)).toBeInTheDocument();
    [
      'Dashboard',
      'Chat',
      'Calendar',
      'Clock',
      'Trips',
      'Projects',
      'Inventory',
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
    expect(screen.getByRole('heading', { name: 'Night Compass' })).toBeInTheDocument();
  });

  it('should navigate between surfaces', async () => {
    await act(async () => { renderWithProvider(<App />); });

    await act(async () => { fireEvent.click(screen.getByText('Trips')); });
    expect(await screen.findByRole('button', { name: 'Plan your first trip' })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Inventory')); });
    expect(await screen.findByRole('heading', { name: 'Know what you have before you buy.' })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Projects')); });
    expect(await screen.findByText('Build your project reference catalogue')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Health')); });
    expect(await screen.findByText('Fast food journal')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Activity')); });
    expect(await screen.findByText('No Lina actions logged yet')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText('Settings')); });
    expect(await screen.findByText('About')).toBeInTheDocument();
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

  it('falls back to Dashboard for a retired Inbox navigation value', async () => {
    sessionStorage.setItem('helm:shell-surface', 'inbox');
    await act(async () => { renderWithProvider(<App />); });
    expect(screen.getByRole('heading', { name: 'Night Compass' })).toBeInTheDocument();
    expect(screen.queryByText('Inbox')).not.toBeInTheDocument();
  });
});
