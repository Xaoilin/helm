import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import type { CalendarAccount, IntegrationStatus } from '../types/domain';
import { useGoogleSync } from '../hooks/useGoogleSync';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';
import { appendGoogleCalendarDiagnosticEvent } from '../services/googleCalendarDiagnosticEvents';
import { getAuthSessionSnapshot } from '../store/supabase';
import {
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  connectGoogleCalendarOAuthAccount,
  connectProfileGoogleCalendar,
  clearGoogleCalendarAuth,
  getGoogleCalendarCredentialStatusLabel,
  getGoogleCalendarAuthPatch,
  getGoogleCalendarStatusLabel,
  isGoogleCalendarAccount,
  reconnectGoogleCalendarOAuthAccount,
  triggerProfileGoogleReconnect,
} from '../services/googleCalendarAuthManager';
import {
  GoogleCalendarOAuthFunctionError,
  revokeGoogleCalendarCredential,
} from '../services/googleCalendarServerAuth';

const PROVIDER_INFO: Record<string, { setupHint: string; mockable: boolean }> = {
  google: { setupHint: 'Requires a Google Cloud OAuth Client ID. Set it in Settings first.', mockable: false },
  github: { setupHint: 'Requires a GitHub personal access token or OAuth App.', mockable: true },
  '1password': { setupHint: 'Requires 1Password CLI (op) to be installed and signed in.', mockable: false },
  slack: { setupHint: 'Requires a Slack app with bot token.', mockable: true },
  linear: { setupHint: 'Requires a Linear API key or OAuth flow.', mockable: true },
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getStatusTone(account: CalendarAccount): string {
  switch (account.authStatus) {
    case 'needs_reconnect':
      return 'needs-reconnect';
    case 'revoked':
      return 'revoked';
    case 'error':
      return 'error';
    default:
      return account.connected ? 'connected' : 'disconnected';
  }
}

export default function IntegrationsSurface() {
  const app = useApp();
  const googleSync = useGoogleSync();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [googleBusyAction, setGoogleBusyAction] = useState<'profile' | 'oauth' | `reconnect:${string}` | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const getInfo = (provider: string) => PROVIDER_INFO[provider] || { setupHint: 'No setup instructions available.', mockable: false };
  const googleAccounts = app.calendarAccounts.filter(isGoogleCalendarAccount);
  const clientId = GOOGLE_OAUTH_CLIENT_ID;
  const authSnapshot = getAuthSessionSnapshot();
  const isSignedIn = Boolean(authSnapshot?.userId);

  const profileEmail = authSnapshot?.email ?? null;
  const hostedGoogleIssue = googleSync.serverRuntimeStatus?.lastError ?? null;
  const linkedProfileAccount = useMemo(() => (
    profileEmail
      ? googleAccounts.find(account => normalizeEmail(account.email) === normalizeEmail(profileEmail))
      : undefined
  ), [googleAccounts, profileEmail]);
  const canLinkSignedInGoogle = Boolean(profileEmail && authSnapshot?.provider === 'google' && !linkedProfileAccount);
  const needsProfileReconnect = Boolean(profileEmail && authSnapshot?.provider === 'google' && !authSnapshot?.providerRefreshToken);

  const addSourcesIfMissing = (accountId: string, calendars: Awaited<ReturnType<typeof connectProfileGoogleCalendar>>['calendars']) => {
    const existingGoogleIds = new Set(
      app.calendarSources
        .filter(source => source.accountId === accountId && source.googleCalendarId)
        .map(source => source.googleCalendarId!),
    );
    const foreignGoogleIds = new Set(
      app.calendarSources
        .filter(source => source.accountId !== accountId && source.googleCalendarId)
        .map(source => source.googleCalendarId!),
    );

    for (const calendar of calendars) {
      if (existingGoogleIds.has(calendar.id) || foreignGoogleIds.has(calendar.id)) continue;
      app.addCalendarSource({
        accountId,
        name: calendar.summary,
        color: calendar.backgroundColor || '#4f5bff',
        visible: true,
        googleCalendarId: calendar.id,
        accessRole: calendar.accessRole,
      });
    }
  };

  const handleProfileGoogleConnect = async () => {
    setGoogleBusyAction('profile');
    setGoogleError(null);

    try {
      if (!isSignedIn) {
        setGoogleError(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
        return;
      }

      if (needsProfileReconnect) {
        await triggerProfileGoogleReconnect();
        return;
      }

      const result = await connectProfileGoogleCalendar();
      const existing = googleAccounts.find(account => normalizeEmail(account.email) === normalizeEmail(result.email));

      if (existing) {
        app.updateCalendarAccount(existing.id, {
          name: result.accountName,
          connected: true,
          mocked: false,
          ...getGoogleCalendarAuthPatch({ ...existing, name: result.accountName, connected: true, mocked: false }),
        });
        addSourcesIfMissing(existing.id, result.calendars);
      } else {
        const accountId = app.addCalendarAccount({
          name: result.accountName,
          email: result.email,
          provider: 'google',
          isPrimary: app.calendarAccounts.length === 0,
          connected: true,
          mocked: false,
          authProvider: result.authProvider,
          authStatus: 'connected',
          authEmail: result.email,
          authExpiresAt: result.authExpiresAt,
          lastAuthError: undefined,
          lastAuthCheckAt: new Date().toISOString(),
          syncError: undefined,
        });
        addSourcesIfMissing(accountId, result.calendars);
      }

      app.updateIntegration('int-google', {
        status: 'connected',
        configuredAt: new Date().toISOString(),
        lastError: undefined,
      });
      await googleSync.refreshCredentialStatuses();
      setConfiguring(null);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setGoogleBusyAction(null);
    }
  };

  const handleGoogleConnect = async () => {
    if (!isSignedIn) {
      setGoogleError(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
      return;
    }

    if (!clientId?.trim()) {
      setGoogleError('Please set your Google OAuth Client ID in Settings first.');
      return;
    }

    setGoogleBusyAction('oauth');
    setGoogleError(null);

    try {
      const result = await connectGoogleCalendarOAuthAccount(clientId.trim());
      const existing = googleAccounts.find(account => normalizeEmail(account.email) === normalizeEmail(result.email));
      if (existing) {
        setGoogleError(`Account ${result.email} is already connected. Reconnect it from the account row below or sign in with a different Google account.`);
        return;
      }

      const accountId = app.addCalendarAccount({
        name: result.accountName,
        email: result.email,
        provider: 'google',
        isPrimary: app.calendarAccounts.length === 0,
        connected: true,
        mocked: false,
        authProvider: result.authProvider,
        authStatus: 'connected',
        authEmail: result.email,
        authExpiresAt: result.authExpiresAt,
        lastAuthError: undefined,
        lastAuthCheckAt: new Date().toISOString(),
        syncError: undefined,
      });

      addSourcesIfMissing(accountId, result.calendars);
      app.updateIntegration('int-google', {
        status: 'connected',
        configuredAt: new Date().toISOString(),
        lastError: undefined,
      });
      await googleSync.refreshCredentialStatuses();
      setConfiguring(null);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'Connection failed');
    } finally {
      setGoogleBusyAction(null);
    }
  };

  const handleGoogleReconnect = async (account: CalendarAccount) => {
    const reconnectKey = `reconnect:${account.id}` as const;
    setGoogleBusyAction(reconnectKey);
    setGoogleError(null);

    try {
      if (!isSignedIn) {
        setGoogleError(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
        return;
      }

      if (account.authProvider === 'profile-google') {
        await triggerProfileGoogleReconnect();
        return;
      }

      if (!clientId?.trim()) {
        setGoogleError('Please set your Google OAuth Client ID in Settings first.');
        return;
      }

      const result = await reconnectGoogleCalendarOAuthAccount(account, clientId.trim());
      app.updateCalendarAccount(account.id, {
        name: result.accountName,
        authProvider: result.authProvider,
        authStatus: 'connected',
        authEmail: result.email,
        authExpiresAt: result.authExpiresAt,
        lastAuthError: undefined,
        lastAuthCheckAt: new Date().toISOString(),
        syncError: undefined,
      });
      addSourcesIfMissing(account.id, result.calendars);
      await googleSync.refreshCredentialStatuses();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconnect failed';
      setGoogleError(message);
      app.updateCalendarAccount(account.id, {
        authStatus: account.authProvider === 'profile-google' ? 'needs_reconnect' : account.authStatus,
        lastAuthError: message,
      });
    } finally {
      setGoogleBusyAction(null);
    }
  };

  const handleGoogleDisconnect = async (accountId: string) => {
    const account = googleAccounts.find(candidate => candidate.id === accountId);
    if (!account) return;

    appendGoogleCalendarDiagnosticEvent({
      operation: 'disconnect',
      phase: 'start',
      outcome: 'info',
      triggerSource: 'user_action',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: account.authProvider,
      message: `Starting an explicit Google Calendar disconnect for ${account.email}.`,
    });

    try {
      if (isSignedIn) {
        await revokeGoogleCalendarCredential(account.email);
      }
    } catch (error) {
      if (!(error instanceof GoogleCalendarOAuthFunctionError) || error.code !== 'missing_credential') {
        appendGoogleCalendarDiagnosticEvent({
          operation: 'disconnect',
          phase: 'failure',
          outcome: 'failure',
          triggerSource: 'user_action',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: account.authProvider,
          message: error instanceof Error ? error.message : 'Disconnect failed',
          code: error instanceof GoogleCalendarOAuthFunctionError ? error.code : undefined,
          requestId: error instanceof GoogleCalendarOAuthFunctionError ? error.requestId : undefined,
          readiness: error instanceof GoogleCalendarOAuthFunctionError ? error.readiness : undefined,
          httpStatus: error instanceof GoogleCalendarOAuthFunctionError ? error.httpStatus : undefined,
        });
        setGoogleError(error instanceof Error ? error.message : 'Disconnect failed');
        return;
      }
    }

    clearGoogleCalendarAuth(accountId);

    app.removeCalendarAccount(accountId);

    const remaining = googleAccounts.filter(account => account.id !== accountId);
    if (remaining.length === 0) {
      app.updateIntegration('int-google', {
        status: 'disconnected',
        configuredAt: undefined,
        lastError: undefined,
      });
    }

    await googleSync.refreshCredentialStatuses();
    appendGoogleCalendarDiagnosticEvent({
      operation: 'disconnect',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'user_action',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: account.authProvider,
      message: `Disconnected Google Calendar account ${account.email}.`,
    });
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
          Integrations connect HELM to external services. Google Calendar now uses server-backed browser credentials, so durable sync requires you to be signed into HELM.
          Other integrations can be simulated for development.
        </div>

        {hostedGoogleIssue && (
          <div className="info-box warning" style={{ marginTop: 8 }}>
            Hosted Google Calendar status is degraded right now: {hostedGoogleIssue}
          </div>
        )}

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

              {isGoogle && googleAccounts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {googleAccounts.map(account => (
                    <div
                      key={account.id}
                      className="info-box"
                      style={{
                        marginBottom: 8,
                        background: account.authStatus === 'connected' ? '#152d1a' : '#1a1d2e',
                        borderColor: account.authStatus === 'connected' ? '#1e4d28' : '#30364d',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong>{account.email}</strong>
                          <span className={`tag tag-${getStatusTone(account)}`} role="status">
                            {getGoogleCalendarStatusLabel(account)}
                          </span>
                          {account.authProvider === 'profile-google' && (
                            <span style={{ fontSize: 11, color: '#8b90a8' }}>Linked to your HELM Google sign-in</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 4 }}>
                          {account.lastSyncTime
                            ? `Synced ${new Date(account.lastSyncTime).toLocaleString()}`
                            : 'Not yet synced'}
                          {account.lastAuthCheckAt && ` · Access checked ${new Date(account.lastAuthCheckAt).toLocaleString()}`}
                          {` · Credential status ${getGoogleCalendarCredentialStatusLabel(account)}`}
                        </div>
                        {(account.lastAuthError || account.syncError) && (
                          <div style={{ color: account.authStatus === 'error' ? '#f0c040' : '#ff6b6b', marginTop: 4, fontSize: 11 }}>
                            {account.lastAuthError || account.syncError}
                          </div>
                        )}
                      </div>
                      <div className="actions-row" style={{ flexShrink: 0 }}>
                        {(account.authStatus === 'needs_reconnect' || account.authStatus === 'revoked') && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleGoogleReconnect(account)}
                            disabled={googleBusyAction === `reconnect:${account.id}`}
                          >
                            {googleBusyAction === `reconnect:${account.id}` ? <><span className="spinner" /> Reconnecting...</> : 'Reconnect'}
                          </button>
                        )}
                        {confirmDisconnect === account.id ? (
                          <>
                            <span style={{ fontSize: 11, color: '#ff6b6b' }}>Remove this account?</span>
                            <button className="btn btn-danger btn-sm" onClick={() => handleGoogleDisconnect(account.id)}>Yes</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDisconnect(null)}>No</button>
                          </>
                        ) : (
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDisconnect(account.id)}>Disconnect</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {integration.status === 'mocked' && (
                <div className="info-box warning" style={{ marginTop: 8 }}>
                  This connection is simulated. No real data is being exchanged with {integration.name}.
                </div>
              )}

              {integration.status === 'error' && !isGoogle && (
                <div className="info-box warning" style={{ marginTop: 8 }}>
                  Error: {integration.lastError || 'Connection error'}
                </div>
              )}

              <div className="actions-row" style={{ marginTop: 10 }}>
                {isGoogle ? (
                  <>
                    {configuring === integration.id ? (
                      <div style={{ flex: 1 }}>
                        {googleError && (
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            {googleError}
                          </div>
                        )}

                        {canLinkSignedInGoogle && (
                          <div className="info-box" style={{ marginBottom: 8 }}>
                            {needsProfileReconnect
                              ? `You are signed into HELM as ${profileEmail}. Reconnect that Google sign-in once so HELM can store a durable Calendar credential.`
                              : `Link your signed-in Google profile (${profileEmail}) without adding a duplicate account.`}
                          </div>
                        )}

                        {!isSignedIn && (
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            {GOOGLE_SIGN_IN_REQUIRED_MESSAGE}
                          </div>
                        )}

                        {!clientId?.trim() && (
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            You need to set a Google OAuth Client ID in Settings before adding extra Google Calendar accounts.
                            <br /><br />
                            <strong>Setup steps:</strong>
                            <ol style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                              <li>Go to <strong>Google Cloud Console</strong> &rarr; APIs &amp; Services &rarr; Credentials</li>
                              <li>Create an OAuth 2.0 Client ID (Web application type)</li>
                              <li>Add <code>http://localhost:5174</code> as an Authorized JavaScript Origin</li>
                              <li>Add <code>http://localhost:5174</code> as an Authorized redirect URI because the browser code flow exchanges against the app origin</li>
                              <li>Enable the <strong>Google Calendar API</strong> in your project</li>
                              <li>Copy the Client ID and paste it in HELM Settings</li>
                              <li>Set the same Client ID plus the matching client secret as Supabase Edge Function secrets for <code>google-calendar-oauth</code></li>
                            </ol>
                          </div>
                        )}

                        <div className="info-box" style={{ marginBottom: 8 }}>
                          HELM keeps refreshable Google Calendar credentials on the server for browser sync. The one-hour Google access token lifetime shown in Debug is now just transport metadata, not your account connection lifetime.
                        </div>

                        <div className="actions-row" style={{ flexWrap: 'wrap' }}>
                          {canLinkSignedInGoogle && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={handleProfileGoogleConnect}
                              disabled={googleBusyAction === 'profile'}
                            >
                              {googleBusyAction === 'profile'
                                ? <><span className="spinner" /> Working...</>
                                : needsProfileReconnect ? 'Reconnect Signed-In Google Account' : 'Link Signed-In Google Account'}
                            </button>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={handleGoogleConnect}
                            disabled={!clientId?.trim() || !isSignedIn || googleBusyAction === 'oauth'}
                          >
                            {googleBusyAction === 'oauth'
                              ? <><span className="spinner" /> Connecting...</>
                              : googleAccounts.length > 0 ? 'Add Another Google Account' : 'Connect Google Calendar'}
                          </button>
                          {!clientId?.trim() && (
                            <button className="btn btn-secondary btn-sm" onClick={() => app.navigate('settings')}>Go to Settings</button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => { setConfiguring(null); setGoogleError(null); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(integration.id); setGoogleError(null); }}>
                        {googleAccounts.length > 0 || canLinkSignedInGoogle ? '+ Add Account' : 'Configure'}
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
