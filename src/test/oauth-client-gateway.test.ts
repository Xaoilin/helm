import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveOAuthClientAccess,
  listOAuthClientApprovals,
  OAUTH_CLIENT_DOMAINS,
  revokeOAuthClientAllowlist,
  revokeOAuthClientApproval,
} from '../store/supabase/oauthClients';

const database = vi.hoisted(() => ({ request: vi.fn() }));
const telemetry = vi.hoisted(() => ({
  observeOperationalOperation: vi.fn((_domain: string, _operation: string, work: () => Promise<unknown>) => work()),
}));

vi.mock('../store/supabase/client', () => ({ accessRequest: database.request }));
vi.mock('../services/operationalTelemetry', () => telemetry);

const approvedRow = {
  clientId: 'client-id',
  clientName: 'Codex client',
  approvedAt: '2026-09-14T12:00:00.000Z',
  revokedAt: null,
};
const revokedRow = { ...approvedRow, revokedAt: '2026-09-14T13:00:00.000Z' };

describe('native OAuth client approval gateway', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(OAUTH_CLIENT_DOMAINS)('reads %s through the account-scoped native endpoint', async domain => {
    database.request.mockResolvedValue([approvedRow]);
    await expect(listOAuthClientApprovals(domain)).resolves.toEqual([approvedRow]);
    expect(database.request).toHaveBeenCalledWith(`/agents/${domain}/clients`);
  });
  it.each(OAUTH_CLIENT_DOMAINS)('approves only the selected %s domain', async domain => {
    database.request.mockResolvedValue(approvedRow);
    await expect(approveOAuthClientAccess(domain, 'client-id', 'Codex client')).resolves.toEqual(approvedRow);
    expect(database.request).toHaveBeenCalledWith(`/agents/${domain}/clients`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-id', clientName: 'Codex client' }),
    });
  });
  it.each(OAUTH_CLIENT_DOMAINS)('revokes %s through one native transaction and returns the confirmed row', async domain => {
    database.request.mockResolvedValue(revokedRow);
    await expect(revokeOAuthClientApproval(domain, 'client/id')).resolves.toEqual(revokedRow);
    expect(database.request).toHaveBeenCalledExactlyOnceWith(`/agents/${domain}/clients/client%2Fid`, { method: 'DELETE' });
  });
  it('surfaces an unconfirmed revocation as an error', async () => {
    const error = new Error('unavailable');
    database.request.mockRejectedValue(error);
    await expect(revokeOAuthClientAllowlist('inventory', 'client-id')).rejects.toBe(error);
  });
  it('observes Finance calls with fresh operational telemetry', async () => {
    database.request.mockResolvedValue([]);
    await listOAuthClientApprovals('finance');
    expect(telemetry.observeOperationalOperation).toHaveBeenCalledWith('finance', 'read', expect.any(Function), { freshness: 'fresh' });
    telemetry.observeOperationalOperation.mockClear();
    await listOAuthClientApprovals('inventory');
    expect(telemetry.observeOperationalOperation).not.toHaveBeenCalled();
  });
});
