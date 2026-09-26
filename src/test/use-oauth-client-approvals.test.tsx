import { act, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOAuthClientApprovals } from '../hooks/useOAuthClientApprovals';
import { AuthSessionCtx } from '../store/AuthSessionContext';
import { provide, renderHookWithContexts } from './renderWithContexts';

const gateway = vi.hoisted(() => ({
  listOAuthClientApprovals: vi.fn(),
  revokeOAuthClientApproval: vi.fn(),
}));

vi.mock('../store/supabase/oauthClients', () => gateway);

const approval = {
  clientId: 'client-id',
  clientName: 'Codex client',
  approvedAt: '2026-09-14T12:00:00.000Z',
  revokedAt: null,
};
const otherApproval = { ...approval, clientId: 'other-client', clientName: 'Other client' };
const revoked = { ...approval, revokedAt: '2026-09-14T13:00:00.000Z' };

function session(authUser: User | null) {
  return provide(AuthSessionCtx, {
    authUser,
    bootstrapped: true,
    loading: false,
    supabaseReady: true,
    sessionKey: `${authUser?.id ?? 'signed-out'}:0`,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  });
}

const signedIn = session({ id: 'account-id' } as unknown as User);

describe('useOAuthClientApprovals', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gateway.listOAuthClientApprovals.mockResolvedValue([approval, otherApproval]);
  });

  it('lists the signed-in account\'s approvals for the requested domain', async () => {
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('equity'), [signedIn]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.approvals).toEqual([approval, otherApproval]);
    expect(result.current.error).toBeNull();
    expect(gateway.listOAuthClientApprovals).toHaveBeenCalledWith('equity');
  });

  it('does not read approvals while signed out', () => {
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('equity'), [session(null)]);
    expect(result.current).toMatchObject({ approvals: [], loading: false, error: null });
    expect(gateway.listOAuthClientApprovals).not.toHaveBeenCalled();
  });

  it('surfaces a failed list read', async () => {
    gateway.listOAuthClientApprovals.mockRejectedValue(new Error('permission denied for list'));
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('finance'), [signedIn]);
    await waitFor(() => expect(result.current.error).toBe('permission denied for list'));
    expect(result.current.approvals).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('replaces a revoked approval with the server response and leaves others alone', async () => {
    gateway.revokeOAuthClientApproval.mockResolvedValue(revoked);
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('inventory'), [signedIn]);
    await waitFor(() => expect(result.current.approvals).toHaveLength(2));
    await act(() => result.current.revoke('client-id'));
    expect(gateway.revokeOAuthClientApproval).toHaveBeenCalledWith('inventory', 'client-id');
    expect(result.current.approvals).toEqual([revoked, otherApproval]);
    expect(result.current.lastRevoked).toEqual(revoked);
    expect(result.current.revokingClientId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('marks the client as revoking while the request is in flight', async () => {
    let finish: (value: typeof revoked) => void = () => undefined;
    gateway.revokeOAuthClientApproval.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('employment'), [signedIn]);
    await waitFor(() => expect(result.current.approvals).toHaveLength(2));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.revoke('client-id'); });
    expect(result.current.revokingClientId).toBe('client-id');
    await act(async () => { finish(revoked); await pending; });
    expect(result.current.revokingClientId).toBeNull();
  });

  it('surfaces a failed revoke and re-reads what the database holds', async () => {
    gateway.revokeOAuthClientApproval.mockRejectedValue(new Error('Inventory access is blocked, but grant revocation failed'));
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('inventory'), [signedIn]);
    await waitFor(() => expect(result.current.approvals).toHaveLength(2));
    gateway.listOAuthClientApprovals.mockResolvedValue([revoked, otherApproval]);
    await act(() => result.current.revoke('client-id'));
    expect(result.current.error).toBe('Inventory access is blocked, but grant revocation failed');
    expect(result.current.approvals).toEqual([revoked, otherApproval]);
    expect(result.current.lastRevoked).toBeNull();
  });

  it('reports both failures when the list cannot be refreshed after a failed revoke', async () => {
    gateway.revokeOAuthClientApproval.mockRejectedValue(new Error('Revoke failed.'));
    const { result } = renderHookWithContexts(() => useOAuthClientApprovals('equity'), [signedIn]);
    await waitFor(() => expect(result.current.approvals).toHaveLength(2));
    gateway.listOAuthClientApprovals.mockRejectedValue(new Error('offline'));
    await act(() => result.current.revoke('client-id'));
    expect(result.current.error).toBe('Revoke failed. The approval list could not be refreshed: offline');
    expect(result.current.approvals).toEqual([approval, otherApproval]);
  });
});
