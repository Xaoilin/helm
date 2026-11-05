/**
 * One gateway for the per-domain OAuth client allowlists (Inventory,
 * Employment, Equity and Finance). Each domain approves and revokes clients
 * through its own Spring access-service endpoint.
 */
import { observeOperationalOperation } from '../../services/operationalTelemetry';
import { accessRequest } from './client';
import { asRecord } from './json';

export type OAuthClientDomain = 'inventory' | 'employment' | 'equity' | 'finance';

export const OAUTH_CLIENT_DOMAINS: readonly OAuthClientDomain[] = ['inventory', 'employment', 'equity', 'finance'];

export interface OAuthClientApproval {
  clientId: string;
  clientName: string;
  approvedAt: string;
  revokedAt: string | null;
}

function observe<T>(domain: OAuthClientDomain, operation: 'read' | 'write', work: () => Promise<T>): Promise<T> {
  return domain === 'finance' ? observeOperationalOperation('finance', operation, work, { freshness: 'fresh' }) : work();
}

function mapOAuthClientApproval(value: unknown): OAuthClientApproval {
  const row = asRecord(value);
  return {
    clientId: String(row.clientId || ''),
    clientName: String(row.clientName || ''),
    approvedAt: String(row.approvedAt || ''),
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
  };
}

export function listOAuthClientApprovals(domain: OAuthClientDomain): Promise<OAuthClientApproval[]> {
  return observe(domain, 'read', async () => {
    const data = await accessRequest<unknown[]>(`/agents/${domain}/clients`);
    return data.map(mapOAuthClientApproval);
  });
}
export function approveOAuthClientAccess(domain: OAuthClientDomain, clientId: string, clientName: string): Promise<OAuthClientApproval> {
  return observe(domain, 'write', async () => mapOAuthClientApproval(await accessRequest(`/agents/${domain}/clients`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, clientName }),
  })));
}
export function revokeOAuthClientAllowlist(domain: OAuthClientDomain, clientId: string): Promise<OAuthClientApproval> {
  return observe(domain, 'write', async () => mapOAuthClientApproval(await accessRequest(
    `/agents/${domain}/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' },
  )));
}
export const revokeOAuthClientApproval = revokeOAuthClientAllowlist;
