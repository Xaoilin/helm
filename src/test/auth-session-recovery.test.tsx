import { act, cleanup, renderHook } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  callback: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: (callback: typeof auth.callback) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

import { AuthSessionProvider, useAuthSession } from '../store/AuthSessionContext';
import { getAuthSessionSnapshot, getCurrentUserId, initSupabase } from '../store/supabase';

function session(id: string): Session {
  return {
    access_token: `synthetic-${id}`,
    refresh_token: 'synthetic-refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  };
}

describe('authentication recovery ordering', () => {
  beforeEach(() => {
    auth.getSession.mockReset();
    auth.callback = null;
    initSupabase('https://project.supabase.test', 'public-key');
  });

  afterEach(() => {
    cleanup();
    initSupabase('', '');
  });

  it.each([
    { event: 'SIGNED_OUT' as const, next: null, error: null },
    { event: 'SIGNED_IN' as const, next: session('new-account'), error: null },
    { event: 'SIGNED_IN' as const, next: session('new-account'), error: new Error('Synthetic bootstrap failure') },
  ])('keeps newer $event when an older bootstrap completes (error=$error)', async ({ event, next, error }) => {
    let complete!: (value: { data: { session: Session | null }; error: Error | null }) => void;
    auth.getSession.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(useAuthSession, { wrapper: AuthSessionProvider });

    act(() => { auth.callback?.(event, next); });
    const sessionKey = result.current.sessionKey;
    await act(async () => {
      complete({ data: { session: error ? null : session('old-account') }, error });
    });

    expect(result.current.authUser?.id ?? null).toBe(next?.user.id ?? null);
    expect(result.current.sessionKey).toBe(sessionKey);
    expect(result.current.bootstrapped).toBe(true);
    expect(getCurrentUserId()).toBe(next?.user.id ?? null);
    expect(getAuthSessionSnapshot()?.userId ?? null).toBe(next?.user.id ?? null);
    expect(auth.getSession).toHaveBeenCalledOnce();
  });

  it('keeps sign-out delivered between the bootstrap read and provider publication', async () => {
    let complete!: (value: { data: { session: Session }; error: null }) => void;
    auth.getSession.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(useAuthSession, { wrapper: AuthSessionProvider });

    await act(async () => {
      complete({ data: { session: session('old-account') }, error: null });
      await Promise.resolve();
      auth.callback?.('SIGNED_OUT', null);
    });

    expect(result.current.authUser).toBeNull();
    expect(getCurrentUserId()).toBeNull();
    expect(getAuthSessionSnapshot()).toBeNull();
  });
});
