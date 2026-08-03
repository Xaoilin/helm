import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({
  value: {
    authUser: null,
    bootstrapped: false,
    loading: true,
    supabaseReady: true,
    sessionKey: 'pending',
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  } as Record<string, unknown>,
}));

const persistenceState = vi.hoisted(() => ({
  listener: null as ((value: never) => void) | null,
  value: {
    status: 'blocked',
    userId: null,
    accountVersion: 0,
    hasUsableSnapshot: false,
    readOnly: true,
    reason: 'signed_out',
    lastReadyAt: null,
    lastProbeAt: null,
    error: 'Sign in to load Sabah One data.',
  },
}));

vi.mock('../store/AuthSessionContext', () => ({
  AuthSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuthSession: () => authState.value,
}));

vi.mock('../store/AppContext', () => ({
  AppProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../store/persistence', () => ({
  bootstrapDatabasePersistence: vi.fn(async () => undefined),
  getSyncSessionSnapshot: () => persistenceState.value,
  refreshDatabasePersistence: vi.fn(async () => undefined),
  resetDatabasePersistence: vi.fn(),
  subscribeSyncSession: vi.fn((listener: (value: typeof persistenceState.value) => void) => {
    persistenceState.listener = listener as never;
    listener(persistenceState.value);
    return () => { persistenceState.listener = null; };
  }),
}));

import { BootstrappedApp } from '../AppRoot';

describe('BootstrappedApp', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.value = {
      authUser: null,
      bootstrapped: false,
      loading: true,
      supabaseReady: true,
      sessionKey: 'pending',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    };
    persistenceState.value = {
      status: 'blocked',
      userId: null,
      accountVersion: 0,
      hasUsableSnapshot: false,
      readOnly: true,
      reason: 'signed_out',
      lastReadyAt: null,
      lastProbeAt: null,
      error: 'Sign in to load Sabah One data.',
    };
  });

  it('does not mount app providers before auth bootstrap finishes', () => {
    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(screen.getByText('Loading your account')).toBeInTheDocument();
    expect(screen.queryByText('Providers mounted')).not.toBeInTheDocument();
  });

  it('requires sign-in after auth bootstrap finishes', () => {
    authState.value = {
      ...authState.value,
      bootstrapped: true,
      loading: false,
      sessionKey: 'signed-out:0',
    };

    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.queryByText('Providers mounted')).not.toBeInTheDocument();
  });

  it('mounts providers only after authenticated database bootstrap is ready', async () => {
    authState.value = {
      ...authState.value,
      authUser: { id: '11111111-1111-4111-8111-111111111111' },
      bootstrapped: true,
      loading: false,
      sessionKey: 'signed-in:0',
    };
    persistenceState.value = {
      ...persistenceState.value,
      status: 'ready',
      userId: '11111111-1111-4111-8111-111111111111',
      accountVersion: 4,
      hasUsableSnapshot: true,
      readOnly: false,
      reason: null,
      lastReadyAt: '2026-07-31T12:00:00.000Z',
      error: null,
    };

    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(await screen.findByText('Providers mounted')).toBeInTheDocument();
  });

  it('keeps the mounted screen and local component state during read-only recovery', async () => {
    authState.value = {
      ...authState.value,
      authUser: { id: '11111111-1111-4111-8111-111111111111' },
      bootstrapped: true,
      loading: false,
      sessionKey: 'signed-in:0',
    };
    persistenceState.value = {
      ...persistenceState.value,
      status: 'ready',
      userId: '11111111-1111-4111-8111-111111111111',
      accountVersion: 4,
      hasUsableSnapshot: true,
      readOnly: false,
      reason: null,
      error: null,
    };

    render(
      <BootstrappedApp>
        <label>Current screen<input aria-label="Current screen state" defaultValue="Projects" /></label>
      </BootstrappedApp>,
    );
    const input = await screen.findByLabelText('Current screen state');
    fireEvent.change(input, { target: { value: 'Projects drawer open' } });

    persistenceState.value = {
      ...persistenceState.value,
      status: 'reconnecting',
      readOnly: true,
      reason: 'offline',
      error: 'raw network error that must stay diagnostic-only',
    };
    act(() => persistenceState.listener?.(persistenceState.value as never));

    expect(screen.getByLabelText('Current screen state')).toHaveValue('Projects drawer open');
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText('Sabah One is reconnecting')).not.toBeInTheDocument();
    expect(screen.queryByText(/raw network error/i)).not.toBeInTheDocument();
  });
});
