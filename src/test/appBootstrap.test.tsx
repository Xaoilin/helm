import { render, screen } from '@testing-library/react';
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
  value: {
    status: 'blocked',
    userId: null,
    accountVersion: 0,
    lastReadyAt: null,
    lastProbeAt: null,
    error: 'Sign in to load HELM data.',
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
  getPersistenceHealthSnapshot: vi.fn(() => ({ lastRemoteWriteAt: null, lastRemoteWriteKey: null })),
  getSyncSessionSnapshot: () => persistenceState.value,
  refreshDatabasePersistence: vi.fn(async () => undefined),
  resetDatabasePersistence: vi.fn(),
  subscribeStoreChanges: vi.fn(() => () => {}),
  subscribeSyncSession: vi.fn((listener: (value: typeof persistenceState.value) => void) => {
    listener(persistenceState.value);
    return () => {};
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
      lastReadyAt: null,
      lastProbeAt: null,
      error: 'Sign in to load HELM data.',
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
      lastReadyAt: '2026-07-31T12:00:00.000Z',
      error: null,
    };

    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(await screen.findByText('Providers mounted')).toBeInTheDocument();
  });
});
