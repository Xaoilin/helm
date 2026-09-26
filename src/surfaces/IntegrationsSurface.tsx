import { useState } from 'react';
import { calendarErrorMessage, useCalendar } from "../store/contexts/CalendarContext";
import { defaultIntegrations, useSettingsContext } from "../store/contexts/SettingsContext";
import type { CalendarAccount } from '../types/domain';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';
import { loadGisScript, requestGoogleAuthorizationCode } from '../services/googleAuth';
import { getAuthSessionSnapshot } from '../store/supabase/client';
const GOOGLE_SIGN_IN_REQUIRED_MESSAGE = 'Sign in to Sabah One before connecting Google Calendar.';

function googleIntegrationStatus(accounts: CalendarAccount[]): 'connected' | 'error' | 'disconnected' {
  if (accounts.length === 0) return 'disconnected';
  return accounts.some(account => account.authStatus && account.authStatus !== 'connected') ? 'error' : 'connected';
}

function googleStatusLabel(account: CalendarAccount): string {
  switch (account.authStatus) {
    case 'needs_reconnect':
      return 'Needs reconnect';
    case 'revoked':
      return 'Access revoked';
    case 'error':
      return 'Error';
    default:
      return 'Connected';
  }
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
  const calendar = useCalendar();
  const settings = useSettingsContext();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [googleBusyAction, setGoogleBusyAction] = useState<'oauth' | `reconnect:${string}` | `disconnect:${string}` | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // One supported card per provider; never persist this display projection.
  const integrations = defaultIntegrations.map(provider => ({
    ...provider,
    ...settings.integrations.find(record => record.provider === provider.provider),
    name: provider.name,
    description: provider.description,
  }));
  const googleAccounts = calendar.calendarAccounts.filter(account => account.provider === 'google');
  const clientId = GOOGLE_OAUTH_CLIENT_ID;
  const authSnapshot = getAuthSessionSnapshot();
  const isSignedIn = Boolean(authSnapshot?.userId);

  const profileEmail = authSnapshot?.email ?? null;
  const profileAccountConnected = Boolean(profileEmail && googleAccounts.some(
    account => account.email.toLowerCase() === profileEmail.toLowerCase(),
  ));

  /**
   * Google's consent popup returns a one-time code, which the calendar service exchanges and keeps.
   * This never replaces the Sabah One session, whichever Google account the user picks.
   */
  const connectWithGooglePopup = async (options: { loginHint?: string; expectedEmail?: string }) => {
    if (!isSignedIn) throw new Error(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
    if (!clientId?.trim()) {
      throw new Error('Google Calendar setup is unavailable. Ask the site operator to configure Google Calendar, then try again.');
    }
    await loadGisScript();
    const { code } = await requestGoogleAuthorizationCode(clientId.trim(), {
      loginHint: options.loginHint,
      selectAccount: true,
    });
    return calendar.connectGoogleAccount(code, window.location.origin, options.expectedEmail);
  };

  const handleGoogleConnect = async (loginHint?: string) => {
    setGoogleBusyAction('oauth');
    setGoogleError(null);
    try {
      await connectWithGooglePopup({ loginHint });
      setConfiguring(null);
    } catch (error) {
      setGoogleError(calendarErrorMessage(error));
    } finally {
      setGoogleBusyAction(null);
    }
  };

  const handleGoogleReconnect = async (account: CalendarAccount) => {
    setGoogleBusyAction(`reconnect:${account.id}`);
    setGoogleError(null);
    try {
      await connectWithGooglePopup({ loginHint: account.email, expectedEmail: account.email });
    } catch (error) {
      setGoogleError(calendarErrorMessage(error));
    } finally {
      setGoogleBusyAction(null);
    }
  };

  /** The service revokes the stored Google credential and removes the account's calendars. */
  const handleGoogleDisconnect = async (accountId: string) => {
    setGoogleBusyAction(`disconnect:${accountId}`);
    setGoogleError(null);
    try {
      await calendar.removeCalendarAccount(accountId);
      setConfirmDisconnect(null);
    } catch (error) {
      setGoogleError(calendarErrorMessage(error));
    } finally {
      setGoogleBusyAction(null);
    }
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
          Connect Google Calendar while signed into Sabah One.
          Slack and Linear connections are unavailable.
        </div>

        {calendar.syncProblem && (
          <div className="info-box warning" style={{ marginTop: 8 }} role="status">
            Google Calendar sync needs attention: {calendar.syncProblem}
          </div>
        )}

        {integrations.map(integration => {
          const isGoogle = integration.provider === 'google';
          // Google's status comes from the calendar service's accounts; it is never saved, so open
          // tabs holding different copies of the calendar cannot overwrite each other.
          const status = isGoogle
            ? googleIntegrationStatus(googleAccounts)
            : integration.status === 'mocked' ? 'disconnected' : integration.status;

          return (
            <div key={integration.id} className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {integration.name}
                    <span className={`tag tag-${status}`} role="status">{status}</span>
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
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong>{account.email}</strong>
                          <span className={`tag tag-${getStatusTone(account)}`} role="status">
                            {googleStatusLabel(account)}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 4 }}>
                          {account.lastSyncTime
                            ? `Synced ${new Date(account.lastSyncTime).toLocaleString()}`
                            : 'Not yet synced'}
                        </div>
                        {(account.lastAuthError || account.syncError) && (
                          <div style={{ color: account.authStatus === 'error' ? '#f0c040' : '#ff6b6b', marginTop: 4, fontSize: 11 }}>
                            {account.lastAuthError || account.syncError}
                          </div>
                        )}
                      </div>
                      <div className="actions-row" style={{ flexShrink: 0 }}>
                        {(account.authStatus === 'needs_reconnect' || account.authStatus === 'revoked' || account.authStatus === 'error') && (
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
                            <button className="btn btn-danger btn-sm" onClick={() => handleGoogleDisconnect(account.id)} disabled={googleBusyAction === `disconnect:${account.id}`}>Yes</button>
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

              {isGoogle && googleError && configuring !== integration.id && (
                <div className="info-box warning" style={{ marginTop: 8 }} role="alert">{googleError}</div>
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
                          <div className="info-box warning" style={{ marginBottom: 8 }} role="alert">
                            {googleError}
                          </div>
                        )}

                        {!isSignedIn && (
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            {GOOGLE_SIGN_IN_REQUIRED_MESSAGE}
                          </div>
                        )}

                        {!clientId?.trim() && (
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            Adding another Google account is unavailable because this website has no Google Calendar client configured.
                            Ask the site operator to configure Google Calendar, then try again.
                          </div>
                        )}

                        <div className="info-box" style={{ marginBottom: 8 }}>
                          Google shows a consent popup; Sabah One's calendar service keeps the Google credential and syncs for you. Connecting or reconnecting Google never signs you out of Sabah One.
                        </div>

                        <div className="actions-row" style={{ flexWrap: 'wrap' }}>
                          {profileEmail && !profileAccountConnected && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleGoogleConnect(profileEmail)}
                              disabled={!clientId?.trim() || !isSignedIn || googleBusyAction === 'oauth'}
                            >
                              Connect {profileEmail}
                            </button>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleGoogleConnect()}
                            disabled={!clientId?.trim() || !isSignedIn || googleBusyAction === 'oauth'}
                          >
                            {googleBusyAction === 'oauth'
                              ? <><span className="spinner" /> Connecting...</>
                              : googleAccounts.length > 0 ? 'Add Another Google Account' : 'Connect Google Calendar'}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setConfiguring(null); setGoogleError(null); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(integration.id); setGoogleError(null); }}>
                        {googleAccounts.length > 0 ? '+ Add Account' : 'Configure'}
                      </button>
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
