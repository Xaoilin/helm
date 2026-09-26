import { useOAuthClientApprovals } from '../../hooks/useOAuthClientApprovals';
import type { OAuthClientApproval, OAuthClientDomain } from '../../store/supabase/oauthClients';

interface OAuthClientSectionCopy {
  area: string;
  description: string;
  boundary: string;
  revokedMessage: (clientName: string) => string;
}

const SECTION_COPY: Record<OAuthClientDomain, OAuthClientSectionCopy> = {
  inventory: {
    area: 'Inventory',
    description: 'Each client is individually revocable. Access is limited in the database to Inventory records and minimal project name resolution.',
    boundary: 'Chats, calendars, finance, secrets, generic snapshots, and every non-Inventory RPC stay blocked.',
    revokedMessage: clientName => `${clientName} can no longer access Inventory.`,
  },
  employment: {
    area: 'Employment',
    description: 'These clients can read and update your jobs, application history and next actions. Employment access is approved separately from Inventory.',
    boundary: 'This connection does not grant email access or permission to send messages or submit applications.',
    revokedMessage: clientName => `${clientName} can no longer access Employment. Other approvals are unchanged.`,
  },
  equity: {
    area: 'Equity',
    description: 'These clients can read and maintain your stock holdings, option grants, plans and next actions. Equity access is approved separately from Inventory and Employment.',
    boundary: 'This connection does not grant banking access or permission to trade shares, exercise options, move money or contact your employer.',
    revokedMessage: clientName => `${clientName} can no longer access Equity. Other approvals are unchanged.`,
  },
  finance: {
    area: 'Finance',
    description: 'These clients can read and maintain your dated banking review, monthly spending, budget assumptions and loans. Finance access is approved separately from Inventory, Employment and Equity.',
    boundary: 'This connection cannot access banks directly, move money, take loans or make repayments.',
    revokedMessage: clientName => `${clientName} can no longer access Finance. Other approvals are unchanged.`,
  },
};

function approvalTimestamp(client: OAuthClientApproval): string {
  return client.revokedAt
    ? `Revoked ${new Date(client.revokedAt).toLocaleString()}`
    : `Approved ${new Date(client.approvedAt).toLocaleString()}`;
}

/** Settings panel listing one domain's approved Codex OAuth clients, each individually revocable. */
export function OAuthClientApprovalsSection({ domain }: { domain: OAuthClientDomain }) {
  const copy = SECTION_COPY[domain];
  const { approvals, error, revokingClientId, lastRevoked, revoke } = useOAuthClientApprovals(domain);
  const headingId = `${domain}-client-heading`;
  const revokingClient = approvals.find(client => client.clientId === revokingClientId);
  const status = revokingClientId
    ? `Revoking ${revokingClient?.clientName ?? revokingClientId}…`
    : error ?? (lastRevoked ? copy.revokedMessage(lastRevoked.clientName) : '');

  return (
    <>
      <h3 id={headingId} style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Codex {copy.area} Access</h3>
      <section className="card inventory-client-settings" aria-labelledby={headingId}>
        <div className="inventory-client-settings-intro">
          <div>
            <strong>Approved {copy.area} clients</strong>
            <p>{copy.description}</p>
          </div>
          <span className="tag tag-primary">OAuth 2.1 beta</span>
        </div>
        <div className="inventory-client-boundary">{copy.boundary}</div>
        <div className="inventory-client-list">
          {approvals.length === 0 && <div className="inventory-empty-inline">No Codex {copy.area} client has been approved.</div>}
          {approvals.map(client => (
            <div key={client.clientId} className="inventory-client-row">
              <div><strong>{client.clientName}</strong><span>{client.clientId}</span><small>{approvalTimestamp(client)}</small></div>
              <button
                className="btn btn-danger btn-sm"
                type="button"
                aria-label={`Revoke ${copy.area} access for ${client.clientName}`}
                disabled={Boolean(client.revokedAt) || revokingClientId !== null}
                onClick={() => void revoke(client.clientId)}
              >
                {client.revokedAt ? 'Revoked' : revokingClientId === client.clientId ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
        {status && <div className="inventory-client-status" role="status">{status}</div>}
      </section>
    </>
  );
}
