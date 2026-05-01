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
  },
}));

vi.mock('../store/AuthSessionContext', () => ({
  AuthSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuthSession: () => authState.value,
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
  });

  it('does not mount app providers before auth bootstrap finishes', () => {
    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(screen.getByText('Loading HELM...')).toBeInTheDocument();
    expect(screen.queryByText('Providers mounted')).not.toBeInTheDocument();
  });

  it('mounts app providers after auth bootstrap finishes', async () => {
    authState.value = {
      ...authState.value,
      bootstrapped: true,
      loading: false,
      sessionKey: 'signed-out:0',
    };

    render(<BootstrappedApp><div>Providers mounted</div></BootstrappedApp>);

    expect(await screen.findByText('Providers mounted')).toBeInTheDocument();
  });
});
