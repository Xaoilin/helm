import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthSession } from '../store/AuthSessionContext';
import {
  listOAuthClientApprovals,
  revokeOAuthClientApproval,
  type OAuthClientApproval,
  type OAuthClientDomain,
} from '../store/supabase/oauthClients';

export interface OAuthClientApprovals {
  approvals: OAuthClientApproval[];
  loading: boolean;
  /** The latest list or revoke failure, ready to show to the user. */
  error: string | null;
  revokingClientId: string | null;
  /** The server's record of the most recent successful revocation. */
  lastRevoked: OAuthClientApproval | null;
  revoke: (clientId: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The signed-in account's approved OAuth clients for one domain, with
 * revocation. Revoked rows come from the server response; after a failed
 * revoke the list is re-read so it shows what the database actually holds.
 */
export function useOAuthClientApprovals(domain: OAuthClientDomain): OAuthClientApprovals {
  const accountId = useAuthSession().authUser?.id ?? null;
  const [approvals, setApprovals] = useState<OAuthClientApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);
  const [lastRevoked, setLastRevoked] = useState<OAuthClientApproval | null>(null);
  // Results for a previous account or domain must never reach the current one.
  const scopeRef = useRef(0);

  useEffect(() => {
    const scope = ++scopeRef.current;
    setApprovals([]);
    setError(null);
    setLastRevoked(null);
    setRevokingClientId(null);
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listOAuthClientApprovals(domain).then(list => {
      if (scope === scopeRef.current) setApprovals(list);
    }, (listError: unknown) => {
      if (scope === scopeRef.current) setError(errorMessage(listError));
    }).finally(() => {
      if (scope === scopeRef.current) setLoading(false);
    });
    return () => { scopeRef.current += 1; };
  }, [accountId, domain]);

  const revoke = useCallback(async (clientId: string) => {
    const scope = scopeRef.current;
    setRevokingClientId(clientId);
    setError(null);
    setLastRevoked(null);
    try {
      const revoked = await revokeOAuthClientApproval(domain, clientId);
      if (scope !== scopeRef.current) return;
      setApprovals(current => current.map(entry => entry.clientId === clientId ? revoked : entry));
      setLastRevoked(revoked);
    } catch (revokeError) {
      if (scope !== scopeRef.current) return;
      let message = errorMessage(revokeError);
      try {
        const list = await listOAuthClientApprovals(domain);
        if (scope === scopeRef.current) setApprovals(list);
      } catch (refreshError) {
        message += ` The approval list could not be refreshed: ${errorMessage(refreshError)}`;
      }
      if (scope === scopeRef.current) setError(message);
    } finally {
      if (scope === scopeRef.current) setRevokingClientId(null);
    }
  }, [domain]);

  return { approvals, loading, error, revokingClientId, lastRevoked, revoke };
}
