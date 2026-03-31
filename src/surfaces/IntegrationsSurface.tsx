import { useState } from 'react';
import { useApp } from '../store/AppContext';
import type { IntegrationStatus } from '../types/domain';
import { loadGisScript, initiateOAuthFlow, saveGoogleTokens, revokeAccess, loadGoogleTokens, clearGoogleTokens } from '../services/googleAuth';
import { fetchCalendarList } from '../services/googleCalendarApi';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';

const PROVIDER_INFO: Record<string, { setupHint: string; mockable: boolean }> = {
  google: { setupHint: 'Requires a Google Cloud OAuth Client ID. Set it in Settings first.', mockable: false },
  github: { setupHint: 'Requires a GitHub personal access token or OAuth App.', mockable: true },
  '1password': { setupHint: 'Requires 1Password CLI (op) to be installed and signed in.', mockable: false },
  slack: { setupHint: 'Requires a Slack app with bot token.', mockable: true },
  linear: { setupHint: 'Requires a Linear API key or OAuth flow.', mockable: true },
};

export default function IntegrationsSurface() {
  const app = useApp();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<string | null>(null);

  const getInfo = (provider: string) => PROVIDER_INFO[provider] || { setupHint: 'No setup instructions available.', mockable: false };
  const googleAccounts = app.calendarAccounts.filter(a => a.provider === 'google' && a.connected && !a.mocked);
  const clientId = GOOGLE_OAUTH_CLIENT_ID;

  const handleGoogleConnect = async () => {
    if (!clientId?.trim()) {
      setGoogleError('Please set your Google OAuth Client ID in Settings first.');
      return;
    }

    setConnectingGoogle(true);
    setGoogleError(null);

    try {
      await loadGisScript();
      const tokens = await initiateOAuthFlow(clientId.trim());
      const calendars = await fetchCalendarList(tokens.accessToken);
      const primaryCal = calendars.find(c => c.primary);
      const email = primaryCal?.id || 'google-user';
      const accountName = primaryCal?.summary || 'Google Calendar';

      // Check if this email is already connected
      const existing = googleAccounts.find(a => a.email === email);
      if (existing) {
        setGoogleError(`Account ${email} is already connected. Sign in with a different Google account to add another.`);
        return;
      }

      const accountId = app.addCalendarAccount({
        name: accountName,
        email,
        provider: 'google',
        isPrimary: app.calendarAccounts.length === 0,
        connected: true,
        mocked: false,
      });

      saveGoogleTokens(accountId, tokens);

      for (const cal of calendars) {
        app.addCalendarSource({
          accountId,
          name: cal.summary,
          color: cal.backgroundColor || '#4f5bff',
          visible: true,
          googleCalendarId: cal.id,
          accessRole: cal.accessRole,
        });
      }

      app.updateIntegration('int-google', {
        status: 'connected',
        configuredAt: new Date().toISOString(),
        lastError: undefined,
      });

      setConfiguring(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setGoogleError(message);
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleGoogleDisconnect = async (accountId: string) => {
    const tokens = loadGoogleTokens(accountId);
    if (tokens) {
      await revokeAccess(tokens.accessToken);
    }
    clearGoogleTokens(accountId);
    app.removeCalendarAccount(accountId);

    // If no more Google accounts, set integration to disconnected
    const remaining = googleAccounts.filter(a => a.id !== accountId);
    if (remaining.length === 0) {
      app.updateIntegration('int-google', {
        status: 'disconnected',
        configuredAt: undefined,
        lastError: undefined,
      });
    }

    setDisconnectingAccountId(null);
    setConfirmDisconnect(null);
  };

  const handleMockConnect = (id: string, provider: string) => {
    const info = getInfo(provider);
    if (info.mockable) {
      app.updateIntegration(id, { status: 'mocked' as IntegrationStatus, configuredAt: new Date().toISOString() });
    }
    setConfiguring(null);
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Integrations</h1>
          <div className="subtitle">Manage connected services and providers</div>
        </div>
      </div>
      <div className="surface-body">
        <div className="info-box">
          Integrations connect HELM to external services. Google Calendar supports real OAuth connections with multiple accounts.
          Other integrations can be simulated for development.
        </div>

        {app.integrations.map(integration => {
          const info = getInfo(integration.provider);
          const isActive = integration.status === 'connected' || integration.status === 'mocked';
          const isGoogle = integration.provider === 'google';

          return (
            <div key={integration.id} className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {integration.name}
                    <span className={`tag tag-${integration.status}`} role="status">{integration.status}</span>
                    {isGoogle && googleAccounts.length > 0 && (
                      <span style={{ fontSize: 11, color: '#6b6f85' }}>({googleAccounts.length} account{googleAccounts.length !== 1 ? 's' : ''})</span>
                    )}
                  </h3>
                  <div className="card-subtitle">{integration.description}</div>
                </div>
              </div>

              {/* Show connected Google accounts */}
              {isGoogle && googleAccounts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {googleAccounts.map(acc => (
                    <div key={acc.id} className="info-box" style={{ marginBottom: 6, background: '#152d1a', borderColor: '#1e4d28', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{acc.email}</strong>
                        {acc.lastSyncTime && (
                          <span style={{ color: '#6b6f85', marginLeft: 8, fontSize: 11 }}>
                            Synced: {new Date(acc.lastSyncTime).toLocaleString()}
                          </span>
                        )}
                        {acc.syncError && (
                          <span style={{ color: '#ff6b6b', marginLeft: 8, fontSize: 11 }}>
                            Error: {acc.syncError}
                          </span>
                        )}
                      </div>
                      {disconnectingAccountId === acc.id ? (
                        <div className="actions-row">
                          <span style={{ fontSize: 11, color: '#ff6b6b' }}>Remove this account?</span>
                          <button className="btn btn-danger btn-sm" onClick={() => handleGoogleDisconnect(acc.id)}>Yes</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDisconnectingAccountId(null)}>No</button>
                        </div>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => setDisconnectingAccountId(acc.id)}>Disconnect</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {integration.status === 'mocked' && (
                <div className="info-box warning" style={{ marginTop: 8 }}>
                  This connection is simulated. No real data is being exchanged with {integration.name}.
                </div>
              )}

              {integration.status === 'error' && (
                <div className="info-box warning" style={{ marginTop: 8 }}>
                  Error: {integration.lastError || 'Connection error'}
                </div>
              )}

              <div className="actions-row" style={{ marginTop: 10 }}>
                {isGoogle ? (
                  /* Google: always show Add Account option when client ID exists */
                  <>
                    {configuring === integration.id ? (
                      <div style={{ flex: 1 }}>
                        {!clientId?.trim() ? (
                          <>
                            <div className="info-box warning" style={{ marginBottom: 8 }}>
                              You need to set a Google OAuth Client ID in Settings before connecting.
                              <br /><br />
                              <strong>Setup steps:</strong>
                              <ol style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                                <li>Go to <strong>Google Cloud Console</strong> &rarr; APIs &amp; Services &rarr; Credentials</li>
                                <li>Create an OAuth 2.0 Client ID (Web application type)</li>
                                <li>Add <code>http://localhost:5174</code> as an Authorized JavaScript Origin</li>
                                <li>Enable the <strong>Google Calendar API</strong> in your project</li>
                                <li>Copy the Client ID and paste it in HELM Settings</li>
                              </ol>
                            </div>
                            <div className="actions-row">
                              <button className="btn btn-primary btn-sm" onClick={() => app.navigate('settings')}>Go to Settings</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setConfiguring(null)}>Cancel</button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="info-box" style={{ marginBottom: 8 }}>
                              {googleAccounts.length > 0
                                ? 'Sign in with a different Google account to add it.'
                                : 'Clicking Connect will open a Google sign-in popup.'}
                            </div>
                            {googleError && (
                              <div className="info-box warning" style={{ marginBottom: 8 }}>
                                {googleError}
                              </div>
                            )}
                            <div className="actions-row">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={handleGoogleConnect}
                                disabled={connectingGoogle}
                              >
                                {connectingGoogle ? (
                                  <><span className="spinner" /> Connecting...</>
                                ) : googleAccounts.length > 0 ? (
                                  'Add Another Google Account'
                                ) : (
                                  'Connect Google Calendar'
                                )}
                              </button>
                              <button className="btn btn-secondary btn-sm" onClick={() => { setConfiguring(null); setGoogleError(null); }}>Cancel</button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(integration.id); setGoogleError(null); }}>
                        {googleAccounts.length > 0 ? '+ Add Account' : 'Configure'}
                      </button>
                    )}
                  </>
                ) : !isActive && integration.status !== 'error' ? (
                  <>
                    {configuring === integration.id ? (
                      <div style={{ flex: 1 }}>
                        <div className="info-box" style={{ marginBottom: 8 }}>{info.setupHint}</div>
                        <div className="actions-row">
                          {info.mockable && (
                            <button className="btn btn-primary btn-sm" onClick={() => handleMockConnect(integration.id, integration.provider)}>
                              Simulate Connection
                            </button>
                          )}
                          {!info.mockable && (
                            <span style={{ fontSize: 12, color: '#6b6f85' }}>Live connection required. Not available in MVP.</span>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => setConfiguring(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(integration.id); setGoogleError(null); }}>Configure</button>
                    )}
                  </>
                ) : !isGoogle ? (
                  <>
                    {confirmDisconnect === integration.id ? (
                      <div className="confirm-bar" style={{ margin: 0 }} role="alert">
                        Disconnect {integration.name}?
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          app.updateIntegration(integration.id, { status: 'disconnected', configuredAt: undefined, lastError: undefined });
                          setConfirmDisconnect(null);
                        }}>
                          Disconnect
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDisconnect(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmDisconnect(integration.id)}>Disconnect</button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
