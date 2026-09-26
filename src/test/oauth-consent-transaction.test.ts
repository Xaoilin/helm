import { describe, expect, it, vi } from 'vitest';
import { approveOAuthConsent, type OAuthConsentDependencies } from '../services/oauthConsent';

const request = {
  authorizationId: 'authorization-id',
  clientId: 'client-id',
  clientName: 'Codex client',
  areaLabel: 'Employment',
};

function dependencies(overrides: Partial<OAuthConsentDependencies> = {}) {
  return {
    approveClientAccess: vi.fn().mockResolvedValue({}),
    approveAuthorization: vi.fn().mockResolvedValue('https://client.example.test/callback?code=1'),
    revokeClientAccess: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('OAuth consent approval transaction', () => {
  it('approves the domain first, then the authorization, and returns the redirect', async () => {
    const deps = dependencies();
    await expect(approveOAuthConsent(deps, request)).resolves.toEqual({
      ok: true,
      redirectUrl: 'https://client.example.test/callback?code=1',
    });
    expect(deps.approveClientAccess).toHaveBeenCalledWith('client-id', 'Codex client');
    expect(deps.approveAuthorization).toHaveBeenCalledWith('authorization-id');
    expect(deps.approveClientAccess.mock.invocationCallOrder[0])
      .toBeLessThan(deps.approveAuthorization.mock.invocationCallOrder[0]);
    expect(deps.revokeClientAccess).not.toHaveBeenCalled();
  });

  it('never approves the authorization when the domain allowlist write fails', async () => {
    const failure = new Error('Allowlist unavailable');
    const deps = dependencies({ approveClientAccess: vi.fn().mockRejectedValue(failure) });
    await expect(approveOAuthConsent(deps, request)).resolves.toEqual({
      ok: false,
      message: 'Allowlist unavailable',
      error: failure,
    });
    expect(deps.approveAuthorization).not.toHaveBeenCalled();
    expect(deps.revokeClientAccess).toHaveBeenCalledWith('client-id');
  });

  it('revokes the domain approval when the authorization step fails', async () => {
    const failure = new Error('Authorization expired');
    const deps = dependencies({ approveAuthorization: vi.fn().mockRejectedValue(failure) });
    await expect(approveOAuthConsent(deps, request)).resolves.toEqual({
      ok: false,
      message: 'Authorization expired',
      error: failure,
    });
    expect(deps.revokeClientAccess).toHaveBeenCalledTimes(1);
    expect(deps.revokeClientAccess).toHaveBeenCalledWith('client-id');
  });

  it('reports a failed rollback together with the original failure and a recovery path', async () => {
    const failure = new Error('Authorization expired');
    const rollbackFailure = new Error('Database unavailable');
    const deps = dependencies({
      approveAuthorization: vi.fn().mockRejectedValue(failure),
      revokeClientAccess: vi.fn().mockRejectedValue(rollbackFailure),
    });
    await expect(approveOAuthConsent(deps, request)).resolves.toEqual({
      ok: false,
      message: 'Authorization expired Employment approval could not be rolled back: Database unavailable. '
        + "Revoke this client's Employment access in Settings.",
      error: failure,
      rollbackError: rollbackFailure,
    });
  });

  it('describes non-Error failures as text', async () => {
    const deps = dependencies({
      approveAuthorization: vi.fn().mockRejectedValue('timeout'),
      revokeClientAccess: vi.fn().mockRejectedValue({ toString: () => 'offline' }),
    });
    const outcome = await approveOAuthConsent(deps, request);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toBe(
      "timeout Employment approval could not be rolled back: offline. Revoke this client's Employment access in Settings.",
    );
  });
});
