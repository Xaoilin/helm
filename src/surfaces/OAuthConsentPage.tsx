import { useEffect, useState, type ReactNode } from 'react';
import { useAuthSession } from '../store/AuthSessionContext';
import {
  approveInventoryOAuthClient,
  getClient,
  revokeInventoryOAuthClientAllowlist,
  signInWithGoogle,
} from '../store/supabase';

interface AuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
}

export default function OAuthConsentPage() {
  const auth = useAuthSession();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id') || '';

  useEffect(() => {
    if (!auth.bootstrapped || !auth.authUser || !authorizationId) return;
    const database = getClient();
    if (!database) {
      setError('Sabah One database configuration is unavailable.');
      return;
    }
    let cancelled = false;
    void database.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: requestError }) => {
      if (cancelled) return;
      if (requestError || !data) {
        setError(requestError?.message || 'This authorization request is unavailable or expired.');
        return;
      }
      if ('redirect_url' in data) {
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails(data as AuthorizationDetails);
    });
    return () => { cancelled = true; };
  }, [auth.authUser, auth.bootstrapped, authorizationId]);

  const approve = async () => {
    if (!details) return;
    const database = getClient();
    if (!database) return;
    setBusy('approve');
    setError('');
    try {
      await approveInventoryOAuthClient(details.client.id, details.client.name || 'Sabah One Inventory');
      const { data, error: approvalError } = await database.auth.oauth.approveAuthorization(
        details.authorization_id,
        { skipBrowserRedirect: true },
      );
      if (approvalError || !data?.redirect_url) {
        try { await revokeInventoryOAuthClientAllowlist(details.client.id); } catch { /* fail closed */ }
        throw approvalError || new Error('OAuth approval did not return a redirect.');
      }
      window.location.assign(data.redirect_url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(null);
    }
  };

  const deny = async () => {
    if (!details) return;
    const database = getClient();
    if (!database) return;
    setBusy('deny');
    setError('');
    const { data, error: denialError } = await database.auth.oauth.denyAuthorization(
      details.authorization_id,
      { skipBrowserRedirect: true },
    );
    if (denialError || !data?.redirect_url) {
      setError(denialError?.message || 'The authorization request could not be denied.');
      setBusy(null);
      return;
    }
    window.location.assign(data.redirect_url);
  };

  if (!authorizationId) {
    return <ConsentShell><div className="oauth-consent-error" role="alert">Authorization request ID is missing.</div></ConsentShell>;
  }
  if (!auth.bootstrapped) return <ConsentShell><p>Checking your Sabah One session…</p></ConsentShell>;
  if (!auth.authUser) {
    return (
      <ConsentShell>
        <h1>Sign in to review access</h1>
        <p>Authentication must finish in Sabah One before a Codex client can request Inventory access.</p>
        <button className="btn btn-primary" type="button" onClick={() => void signInWithGoogle(window.location.href)}>Continue with Google</button>
      </ConsentShell>
    );
  }
  if (error && !details) return <ConsentShell><div className="oauth-consent-error" role="alert">{error}</div></ConsentShell>;
  if (!details) return <ConsentShell><p>Loading the authorization request…</p></ConsentShell>;

  let redirectHost = details.redirect_uri;
  try { redirectHost = new URL(details.redirect_uri).host; } catch { /* show bounded Supabase value */ }
  const requestedScope = details.scope.trim() || 'Inventory access';
  return (
    <ConsentShell>
      <div className="oauth-consent-client"><div aria-hidden="true">S1</div><span>wants to connect</span><strong>{details.client.name || 'Codex Inventory client'}</strong></div>
      <h1>Allow Inventory access?</h1>
      <p className="oauth-consent-account">Signed in as {details.user.email || auth.authUser.email}</p>
      <div className="oauth-consent-boundary">
        <h2>This client can</h2>
        <ul>
          <li>Search owned tools, equipment, materials, and open needs.</li>
          <li>Resolve project names and catalogue keys.</li>
          <li>Create or change Inventory records only when you explicitly ask.</li>
        </ul>
        <h2>This client cannot</h2>
        <ul>
          <li>Read chats, calendars, finance, secrets, settings, or account snapshots.</li>
          <li>Access another Sabah One account or use a service-role credential.</li>
          <li>Purchase anything automatically.</li>
        </ul>
      </div>
      <div className="oauth-consent-meta"><span>Requested OAuth scope</span><strong>{requestedScope}</strong></div>
      <div className="oauth-consent-meta"><span>Return to</span><strong>{redirectHost}</strong></div>
      {error && <div className="oauth-consent-error" role="alert">{error}</div>}
      <div className="oauth-consent-actions"><button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => void deny()}>{busy === 'deny' ? 'Denying…' : 'Deny'}</button><button className="btn btn-primary" type="button" disabled={busy !== null} onClick={() => void approve()}>{busy === 'approve' ? 'Allowing…' : 'Allow Inventory'}</button></div>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="oauth-consent-page">
      <section className="oauth-consent-card">
        <div className="oauth-consent-brand"><span aria-hidden="true">S1</span><strong>SABAH ONE</strong></div>
        {children}
      </section>
    </main>
  );
}
