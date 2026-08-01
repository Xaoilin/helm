import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemStatusPanel from '../components/dashboard/SystemStatusPanel';

const {
  appState,
  authState,
  getPersistenceHealthSnapshotMock,
  googleSyncState,
  persistenceSnapshot,
  signInWithGoogleMock,
  subscribePersistenceHealthMock,
  testHostedAssistantConnectionMock,
  testOllamaConnectionMock,
} = vi.hoisted(() => ({
  appState: {
    loaded: true,
    calendarAccounts: [] as Array<Record<string, unknown>>,
    settings: {
      assistantEnabled: true,
      wakeWordEnabled: false,
      hostedModel: 'gpt-5.4',
      ollamaEndpoint: 'http://localhost:11434',
    },
    navigate: vi.fn(),
  },
  authState: {
    ready: true,
    authenticated: false,
    bootstrapped: true,
  },
  googleSyncState: {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
  },
  persistenceSnapshot: {
    mode: 'blocked',
    syncSession: {
      status: 'blocked',
      userId: null,
      accountVersion: 0,
      hasUsableSnapshot: false,
      readOnly: true,
      reason: 'signed_out',
      lastReadyAt: null,
      lastProbeAt: null,
      error: 'Sign in to load HELM data.',
    },
    lastLocalWriteAt: '2026-04-24T09:00:00.000Z',
    lastLocalWriteKey: 'tasks',
    lastLocalWriteError: null,
    dirtyKeys: [] as string[],
    lastRemoteReadError: null,
    lastRemoteWriteError: null,
    remoteReadFailedKeys: [] as string[],
    supabaseRealtime: {
      state: 'unavailable',
      lastEventAt: null,
      lastStatusAt: null,
      lastError: null,
    },
    supabaseQueue: {
      queuedCount: 0,
      queuedKeys: [] as string[],
      lastQueuedAt: null,
      lastFlushStartedAt: null,
      lastFlushSuccessAt: null,
      lastFlushFailureAt: null,
      lastFlushError: null,
      lastFlushKeys: [] as string[],
      lastFailureKeys: [] as string[],
    },
  },
  getPersistenceHealthSnapshotMock: vi.fn(),
  signInWithGoogleMock: vi.fn(),
  subscribePersistenceHealthMock: vi.fn(),
  testHostedAssistantConnectionMock: vi.fn(),
  testOllamaConnectionMock: vi.fn(),
}));

vi.mock('../store/AppContext', () => ({
  useApp: () => appState,
}));

vi.mock('../hooks/useGoogleSync', () => ({
  useGoogleSync: () => googleSyncState,
}));

vi.mock('../store/persistence', () => ({
  getPersistenceHealthSnapshot: getPersistenceHealthSnapshotMock,
  subscribePersistenceHealth: subscribePersistenceHealthMock,
}));

vi.mock('../store/supabase', () => ({
  isAuthSessionBootstrapped: () => authState.bootstrapped,
  isAuthenticated: () => authState.authenticated,
  isSupabaseReady: () => authState.ready,
  signInWithGoogle: signInWithGoogleMock,
}));

vi.mock('../services/hostedAssistantApi', () => ({
  testHostedAssistantConnection: testHostedAssistantConnectionMock,
}));

vi.mock('../services/ollamaApi', () => ({
  testOllamaConnection: testOllamaConnectionMock,
}));

describe('SystemStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.loaded = true;
    appState.calendarAccounts = [];
    appState.settings = {
      assistantEnabled: true,
      wakeWordEnabled: false,
      hostedModel: 'gpt-5.4',
      ollamaEndpoint: 'http://localhost:11434',
    };
    authState.ready = true;
    authState.authenticated = false;
    authState.bootstrapped = true;
    googleSyncState.syncState = 'idle';
    googleSyncState.lastSyncTime = null;
    googleSyncState.syncError = null;
    persistenceSnapshot.lastLocalWriteAt = '2026-04-24T09:00:00.000Z';
    persistenceSnapshot.lastLocalWriteError = null;
    persistenceSnapshot.dirtyKeys = [];
    persistenceSnapshot.supabaseQueue.queuedCount = 0;
    persistenceSnapshot.supabaseQueue.lastFlushError = null;
    getPersistenceHealthSnapshotMock.mockReturnValue(persistenceSnapshot);
    subscribePersistenceHealthMock.mockImplementation((listener: (snapshot: typeof persistenceSnapshot) => void) => {
      listener(persistenceSnapshot);
      return vi.fn();
    });
    signInWithGoogleMock.mockResolvedValue(undefined);
    testHostedAssistantConnectionMock.mockResolvedValue({ status: 'available', model: 'gpt-5.4' });
    testOllamaConnectionMock.mockResolvedValue(false);
  });

  it('renders the six user-facing labels and status headlines', async () => {
    await act(async () => {
      render(<SystemStatusPanel />);
    });

    expect(screen.getByText('System status')).toBeInTheDocument();
    expect(screen.getByText('Account data')).toBeInTheDocument();
    expect(screen.getByText('Supabase')).toBeInTheDocument();
    expect(screen.getByText('Google Calendar')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Database connection required')).toBeInTheDocument();
    expect(screen.getByText('Sign in required')).toBeInTheDocument();
    expect(screen.getByText('No external calendar')).toBeInTheDocument();
    expect(await screen.findByText('OpenAI available')).toBeInTheDocument();
    expect(await screen.findByText('Ollama offline')).toBeInTheDocument();
    expect(screen.getByText('Voice unavailable')).toBeInTheDocument();
  });

  it('runs refresh probes and uses gentle navigation or sign-in actions', async () => {
    await act(async () => {
      render(<SystemStatusPanel />);
    });

    await waitFor(() => {
      expect(testHostedAssistantConnectionMock).toHaveBeenCalledTimes(1);
      expect(testOllamaConnectionMock).toHaveBeenCalledTimes(1);
    });

    testHostedAssistantConnectionMock.mockClear();
    testOllamaConnectionMock.mockClear();

    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh status' })[0]);

    await waitFor(() => {
      expect(testHostedAssistantConnectionMock).toHaveBeenCalledTimes(1);
      expect(testOllamaConnectionMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signInWithGoogleMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open Integrations' }));
    expect(appState.navigate).toHaveBeenCalledWith('integrations');

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Settings' })[0]);
    expect(appState.navigate).toHaveBeenCalledWith('settings');
  });

  it('does not expose raw token-like error details', async () => {
    const secret = 'sk-proj_abcdefghijklmnopqrstuvwxyz123456';
    testHostedAssistantConnectionMock.mockResolvedValue({
      status: 'unavailable',
      message: `HTTP 500: ${secret}`,
    });

    await act(async () => {
      render(<SystemStatusPanel />);
    });

    expect(await screen.findByText('OpenAI unavailable')).toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });
});
