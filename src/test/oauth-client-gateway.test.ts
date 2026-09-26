import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approveOAuthClientAccess,
  listOAuthClientApprovals,
  OAUTH_CLIENT_DOMAINS,
  revokeOAuthClientAllowlist,
  revokeOAuthClientApproval,
} from '../store/supabase/oauthClients';

const database = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { oauth: { revokeGrant: vi.fn() } },
}));
const telemetry = vi.hoisted(() => ({
  observeOperationalOperation: vi.fn((_domain: string, _operation: string, work: () => Promise<unknown>) => work()),
}));

vi.mock('../store/supabase/client', () => ({ requireClient: () => database }));
vi.mock('../services/operationalTelemetry', () => telemetry);

const approvedRow = {
  clientId: 'client-id',
  clientName: 'Codex client',
  approvedAt: '2026-09-14T12:00:00.000Z',
  revokedAt: null,
};
const revokedRow = { ...approvedRow, revokedAt: '2026-09-14T13:00:00.000Z' };

describe('OAuth client approval gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.auth.oauth.revokeGrant.mockResolvedValue({ error: null });
  });

  it.each(OAUTH_CLIENT_DOMAINS)('reads %s approvals through that domain\'s list RPC', async domain => {
    database.rpc.mockResolvedValue({ data: [approvedRow, { clientId: 'bare' }], error: null });
    await expect(listOAuthClientApprovals(domain)).resolves.toEqual([
      approvedRow,
      { clientId: 'bare', clientName: '', approvedAt: '', revokedAt: null },
    ]);
    expect(database.rpc).toHaveBeenCalledWith(`list_${domain}_oauth_clients`);
  });

  it('treats a non-array list response as no approvals', async () => {
    database.rpc.mockResolvedValue({ data: null, error: null });
    await expect(listOAuthClientApprovals('employment')).resolves.toEqual([]);
  });

  it.each(OAUTH_CLIENT_DOMAINS)('approves %s access with the client id and name', async domain => {
    database.rpc.mockResolvedValue({ data: approvedRow, error: null });
    await expect(approveOAuthClientAccess(domain, 'client-id', 'Codex client')).resolves.toEqual(approvedRow);
    expect(database.rpc).toHaveBeenCalledWith(`approve_${domain}_oauth_client`, {
      p_client_id: 'client-id',
      p_client_name: 'Codex client',
    });
  });

  it.each(OAUTH_CLIENT_DOMAINS)('blocks %s in its allowlist without touching the OAuth grant', async domain => {
    database.rpc.mockResolvedValue({ data: revokedRow, error: null });
    await expect(revokeOAuthClientAllowlist(domain, 'client-id')).resolves.toEqual(revokedRow);
    expect(database.rpc).toHaveBeenCalledWith(`revoke_${domain}_oauth_client`, { p_client_id: 'client-id' });
    expect(database.auth.oauth.revokeGrant).not.toHaveBeenCalled();
  });

  it.each(['employment', 'equity', 'finance'] as const)('revokes %s alone and returns the server row', async domain => {
    database.rpc.mockResolvedValue({ data: revokedRow, error: null });
    await expect(revokeOAuthClientApproval(domain, 'client-id')).resolves.toEqual(revokedRow);
    expect(database.auth.oauth.revokeGrant).not.toHaveBeenCalled();
  });

  it('revokes Inventory, then its OAuth grant, and returns the server row', async () => {
    database.rpc.mockResolvedValue({ data: revokedRow, error: null });
    await expect(revokeOAuthClientApproval('inventory', 'client-id')).resolves.toEqual(revokedRow);
    expect(database.rpc).toHaveBeenCalledWith('revoke_inventory_oauth_client', { p_client_id: 'client-id' });
    expect(database.auth.oauth.revokeGrant).toHaveBeenCalledWith({ clientId: 'client-id' });
  });

  it('says Inventory is blocked when the OAuth grant revocation fails', async () => {
    database.rpc.mockResolvedValue({ data: revokedRow, error: null });
    database.auth.oauth.revokeGrant.mockResolvedValue({ error: new Error('grant service down') });
    await expect(revokeOAuthClientApproval('inventory', 'client-id')).rejects.toThrow(
      'Inventory access is blocked, but Supabase could not confirm OAuth grant revocation: grant service down',
    );
  });

  it('does not revoke the grant when the Inventory allowlist revoke fails', async () => {
    const failure = { message: 'permission denied', code: '42501' };
    database.rpc.mockResolvedValue({ data: null, error: failure });
    await expect(revokeOAuthClientApproval('inventory', 'client-id')).rejects.toBe(failure);
    expect(database.auth.oauth.revokeGrant).not.toHaveBeenCalled();
  });

  it.each([
    ['list', () => listOAuthClientApprovals('equity')],
    ['approve', () => approveOAuthClientAccess('equity', 'client-id', 'Codex client')],
    ['revoke', () => revokeOAuthClientAllowlist('equity', 'client-id')],
  ])('rethrows the database error from %s unchanged', async (_name, call) => {
    const failure = { message: 'network unavailable' };
    database.rpc.mockResolvedValue({ data: null, error: failure });
    await expect(call()).rejects.toBe(failure);
  });

  it('observes Finance calls with fresh operational telemetry and leaves other domains unobserved', async () => {
    database.rpc.mockResolvedValue({ data: [], error: null });
    await listOAuthClientApprovals('finance');
    await revokeOAuthClientAllowlist('finance', 'client-id');
    expect(telemetry.observeOperationalOperation).toHaveBeenNthCalledWith(1, 'finance', 'read', expect.any(Function), { freshness: 'fresh' });
    expect(telemetry.observeOperationalOperation).toHaveBeenNthCalledWith(2, 'finance', 'write', expect.any(Function), { freshness: 'fresh' });
    telemetry.observeOperationalOperation.mockClear();
    await listOAuthClientApprovals('inventory');
    expect(telemetry.observeOperationalOperation).not.toHaveBeenCalled();
  });
});
