import { useEffect, useState, type ReactNode } from 'react';
import { useAuthSession } from '../store/AuthSessionContext';
import {
  approveEmploymentOAuthClient,
  approveEquityOAuthClient,
  approveFinanceOAuthClient,
  approveInventoryOAuthClient,
  getClient,
  revokeEmploymentOAuthClient,
  revokeEquityOAuthClient,
  revokeFinanceOAuthClient,
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
  const [access, setAccess] = useState<'Inventory' | 'Employment' | 'Equity' | 'Finance' | null>(null);
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
    if (!details || !access) return;
    const database = getClient();
    if (!database) return;
    setBusy('approve');
    setError('');
    const approveClient = {
      Inventory: approveInventoryOAuthClient,
      Employment: approveEmploymentOAuthClient,
      Equity: approveEquityOAuthClient,
      Finance: approveFinanceOAuthClient,
    }[access];
    const revokeClient = {
      Inventory: revokeInventoryOAuthClientAllowlist,
      Employment: revokeEmploymentOAuthClient,
      Equity: revokeEquityOAuthClient,
      Finance: revokeFinanceOAuthClient,
    }[access];
    try {
      await approveClient(details.client.id, details.client.name || `Sabah One ${access}`);
      const { data, error: approvalError } = await database.auth.oauth.approveAuthorization(
        details.authorization_id,
        { skipBrowserRedirect: true },
      );
      if (approvalError || !data?.redirect_url) {
        throw approvalError || new Error('OAuth approval did not return a redirect.');
      }
      window.location.assign(data.redirect_url);
    } catch (caught) {
      let message = caught instanceof Error ? caught.message : String(caught);
      try {
        await revokeClient(details.client.id);
      } catch (rollbackError) {
        const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        message += ` ${access} approval could not be rolled back: ${detail}. Revoke this client's ${access} access in Settings.`;
      }
      setError(message);
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
        <p>Authentication must finish in Sabah One before a Codex client can request access.</p>
        <button className="btn btn-primary" type="button" onClick={() => void signInWithGoogle(window.location.href)}>Continue with Google</button>
      </ConsentShell>
    );
  }
  if (error && !details) return <ConsentShell><div className="oauth-consent-error" role="alert">{error}</div></ConsentShell>;
  if (!details) return <ConsentShell><p>Loading the authorization request…</p></ConsentShell>;

  let redirectHost = details.redirect_uri;
  try { redirectHost = new URL(details.redirect_uri).host; } catch { /* show bounded Supabase value */ }
  const requestedScope = details.scope.trim() || 'Account identity';
  return (
    <ConsentShell>
      <div className="oauth-consent-client"><div aria-hidden="true">S1</div><span>wants to connect</span><strong>{details.client.name || 'Codex client'}</strong></div>
      <h1>Choose access for this client</h1>
      <p className="oauth-consent-account">Signed in as {details.user.email || auth.authUser.email}</p>
      <fieldset className="oauth-consent-domains" disabled={busy !== null}>
        <legend>Approve one area</legend>
        {(['Inventory', 'Employment', 'Equity', 'Finance'] as const).map(domain => (
          <label key={domain}>
            <input type="radio" name="client-access" value={domain} checked={access === domain} onChange={() => setAccess(domain)} />
            <span><strong>{domain}</strong><small>{{ Inventory: 'Owned items, materials and open needs', Employment: 'Jobs, applications, updates and next actions', Equity: 'Stocks, options, plans and next actions', Finance: 'Banking reviews, spending and loans' }[domain]}</small></span>
          </label>
        ))}
      </fieldset>
      {access && (
      <div className="oauth-consent-boundary">
        <h2>With {access} access, this client can</h2>
        {access === 'Finance' ? (
          <ul>
            <li>Read your dated banking review, monthly spending, budget assumptions and loan records.</li>
            <li>Maintain that review and its sources when you ask or through an automation you authorize.</li>
          </ul>
        ) : access === 'Equity' ? (
          <ul>
            <li>Read your stock holdings, option grants, plans, scenarios and supporting sources.</li>
            <li>Maintain equity records and next actions when you ask or through an automation you authorize.</li>
          </ul>
        ) : access === 'Employment' ? (
          <ul>
            <li>Read job opportunities, applications, status history and next actions.</li>
            <li>Add opportunities and update application status, evidence and follow-ups when you ask or through an automation you authorize.</li>
          </ul>
        ) : (
        <ul>
          <li>Search owned tools, equipment, materials, and open needs.</li>
          <li>Resolve project names and catalogue keys.</li>
          <li>Create or change Inventory records only when you explicitly ask.</li>
        </ul>
        )}
        <h2>This approval does not allow</h2>
        <ul>
          <li>Access to {access === 'Finance' ? 'Inventory, Employment, Equity and other finance records' : access === 'Equity' ? 'Inventory, Employment, banking and other finance data' : `${access === 'Employment' ? 'Inventory' : 'Employment'}, Equity and other finance data`}, chats, calendars, secrets, settings, or account snapshots.</li>
          <li>Access to another Sabah One account.</li>
          <li>{access === 'Finance' ? 'Accessing banks directly, moving money, taking loans or making repayments.' : access === 'Equity' ? 'Trading shares, exercising options, moving money or contacting your employer.' : access === 'Employment' ? 'Reading your email, sending messages or submitting job applications.' : 'Automatic purchases.'}</li>
        </ul>
      </div>
      )}
      <div className="oauth-consent-meta"><span>Requested OAuth scope</span><strong>{requestedScope}</strong></div>
      <div className="oauth-consent-meta"><span>Return to</span><strong>{redirectHost}</strong></div>
      {error && <div className="oauth-consent-error" role="alert">{error}</div>}
      <div className="oauth-consent-actions"><button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => void deny()}>{busy === 'deny' ? 'Denying…' : 'Deny'}</button><button className="btn btn-primary" type="button" disabled={busy !== null || !access} onClick={() => void approve()}>{busy === 'approve' ? 'Allowing…' : access ? `Allow ${access}` : 'Choose an area'}</button></div>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <main className="oauth-consent-page" tabIndex={0} aria-label="Client access approval">
      <section className="oauth-consent-card">
        <div className="oauth-consent-brand"><span aria-hidden="true">S1</span><strong>SABAH ONE</strong></div>
        {children}
      </section>
    </main>
  );
}
