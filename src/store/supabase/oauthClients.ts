/**
 * One gateway for the per-domain OAuth client allowlists (Inventory,
 * Employment, Equity and Finance). Each domain approves and revokes clients
 * through its own security-definer RPCs; the table below is the only place
 * that knows their names.
 */
import { observeOperationalOperation } from '../../services/operationalTelemetry';
import { requireClient } from './client';
import { asRecord } from './json';

type OperationalDomain = Parameters<typeof observeOperationalOperation>[0];

export type OAuthClientDomain = 'inventory' | 'employment' | 'equity' | 'finance';

export const OAUTH_CLIENT_DOMAINS: readonly OAuthClientDomain[] = ['inventory', 'employment', 'equity', 'finance'];

export interface OAuthClientApproval {
  clientId: string;
  clientName: string;
  approvedAt: string;
  revokedAt: string | null;
}

interface OAuthClientDomainGateway {
  listRpc: string;
  approveRpc: string;
  revokeRpc: string;
  /**
   * Inventory was the first client-wide integration, so revoking it from
   * Settings also revokes the client's Supabase OAuth grant. Every later
   * domain revokes its own allowlist row alone so separate approvals remain
   * intact.
   */
  revokesOAuthGrant: boolean;
  /** Operational telemetry domain observed around each call, if any. */
  telemetryDomain: OperationalDomain | null;
}

const OAUTH_CLIENT_GATEWAYS: Record<OAuthClientDomain, OAuthClientDomainGateway> = {
  inventory: {
    listRpc: 'list_inventory_oauth_clients',
    approveRpc: 'approve_inventory_oauth_client',
    revokeRpc: 'revoke_inventory_oauth_client',
    revokesOAuthGrant: true,
    telemetryDomain: null,
  },
  employment: {
    listRpc: 'list_employment_oauth_clients',
    approveRpc: 'approve_employment_oauth_client',
    revokeRpc: 'revoke_employment_oauth_client',
    revokesOAuthGrant: false,
    telemetryDomain: null,
  },
  equity: {
    listRpc: 'list_equity_oauth_clients',
    approveRpc: 'approve_equity_oauth_client',
    revokeRpc: 'revoke_equity_oauth_client',
    revokesOAuthGrant: false,
    telemetryDomain: null,
  },
  finance: {
    listRpc: 'list_finance_oauth_clients',
    approveRpc: 'approve_finance_oauth_client',
    revokeRpc: 'revoke_finance_oauth_client',
    revokesOAuthGrant: false,
    telemetryDomain: 'finance',
  },
};

function mapOAuthClientApproval(value: unknown): OAuthClientApproval {
  const row = asRecord(value);
  return {
    clientId: String(row.clientId || ''),
    clientName: String(row.clientName || ''),
    approvedAt: String(row.approvedAt || ''),
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
  };
}

function observe<T>(domain: OAuthClientDomain, operation: 'read' | 'write', work: () => Promise<T>): Promise<T> {
  const telemetryDomain = OAUTH_CLIENT_GATEWAYS[domain].telemetryDomain;
  return telemetryDomain
    ? observeOperationalOperation(telemetryDomain, operation, work, { freshness: 'fresh' })
    : work();
}

export function listOAuthClientApprovals(domain: OAuthClientDomain): Promise<OAuthClientApproval[]> {
  return observe(domain, 'read', async () => {
    const { data, error } = await requireClient().rpc(OAUTH_CLIENT_GATEWAYS[domain].listRpc);
    if (error) throw error;
    return Array.isArray(data) ? data.map(mapOAuthClientApproval) : [];
  });
}

export function approveOAuthClientAccess(
  domain: OAuthClientDomain,
  clientId: string,
  clientName: string,
): Promise<OAuthClientApproval> {
  return observe(domain, 'write', async () => {
    const { data, error } = await requireClient().rpc(OAUTH_CLIENT_GATEWAYS[domain].approveRpc, {
      p_client_id: clientId,
      p_client_name: clientName,
    });
    if (error) throw error;
    return mapOAuthClientApproval(data);
  });
}

/** Block the client in this domain's database allowlist only. */
export function revokeOAuthClientAllowlist(
  domain: OAuthClientDomain,
  clientId: string,
): Promise<OAuthClientApproval> {
  return observe(domain, 'write', async () => {
    const { data, error } = await requireClient().rpc(OAUTH_CLIENT_GATEWAYS[domain].revokeRpc, {
      p_client_id: clientId,
    });
    if (error) throw error;
    return mapOAuthClientApproval(data);
  });
}

/**
 * Revoke a client's access to one domain, as Settings does, and return the
 * server's revoked approval. Inventory also revokes the Supabase OAuth grant;
 * if that second step fails the domain is already blocked and the error says so.
 */
export async function revokeOAuthClientApproval(
  domain: OAuthClientDomain,
  clientId: string,
): Promise<OAuthClientApproval> {
  const revoked = await revokeOAuthClientAllowlist(domain, clientId);
  if (!OAUTH_CLIENT_GATEWAYS[domain].revokesOAuthGrant) return revoked;
  const { error } = await requireClient().auth.oauth.revokeGrant({ clientId });
  if (error) {
    throw new Error(
      `Inventory access is blocked, but Supabase could not confirm OAuth grant revocation: ${error.message}`,
    );
  }
  return revoked;
}
