import { useCallback, useEffect, useState } from 'react';
import { calendarErrorMessage, useCalendar } from "../store/contexts/CalendarContext";
import { defaultIntegrations, useSettingsContext } from "../store/contexts/SettingsContext";
import type { CalendarAccount } from '../types/domain';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';
import { loadGisScript, requestGoogleAuthorizationCode } from '../services/googleAuth';
import { getAuthSessionSnapshot } from '../store/supabase/client';
import { getAppDate } from '../services/appTimeZone';
import { LIFE_HERO_ENABLED } from '../config/deprecatedFeatures';
import {
  beginGithubLifeHeroAuthorization,
  completeGithubLifeHeroAuthorization,
  completeGithubLifeHeroInstallation,
  disconnectGithubLifeHero,
  githubConnectionNeedsReconnect,
  githubInstalledAppId,
  getGithubLifeHeroStatus,
  listGithubLifeHeroRepositories,
  saveGithubLifeHeroSelection,
  syncGithubLifeHeroEvidence,
  type GithubLifeHeroRepository,
  type GithubLifeHeroStatus,
} from '../services/githubLifeHero';
const GOOGLE_SIGN_IN_REQUIRED_MESSAGE = 'Sign in to Sabah One before connecting Google Calendar.';

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
  const [githubStatus, setGithubStatus] = useState<GithubLifeHeroStatus | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<GithubLifeHeroRepository[]>([]);
  const [githubBusy, setGithubBusy] = useState<'status' | 'authorize' | 'repositories' | 'save' | 'sync' | 'disconnect' | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // One supported card per provider; never persist this display projection.
  // The GitHub App only feeds Life Hero evidence, so it is hidden with Life Hero.
  const integrations = defaultIntegrations.filter(provider => LIFE_HERO_ENABLED || provider.provider !== 'github').map(provider => ({
    ...provider,
    ...settings.integrations.find(record => record.provider === provider.provider),
    name: provider.name,
    description: provider.description,
  }));
  const googleAccounts = calendar.calendarAccounts.filter(account => account.provider === 'google');
  const clientId = GOOGLE_OAUTH_CLIENT_ID;
  const authSnapshot = getAuthSessionSnapshot();
  const isSignedIn = Boolean(authSnapshot?.userId);
  const githubIntegration = integrations.find(integration => integration.provider === 'github');
  const githubIntegrationId = githubIntegration?.id;
  const githubConfiguredAt = githubIntegration?.configuredAt;
  const updateIntegration = settings.updateIntegration;
  const githubConnection = githubStatus?.connection ?? null;
  const githubNeedsReconnect = githubConnectionNeedsReconnect(githubStatus);

  const setGithubConnectionStatus = useCallback((status: GithubLifeHeroStatus | null, error?: string) => {
    setGithubStatus(status);
    if (githubIntegrationId) {
      const integrationStatus = status?.status === 'connected'
        ? 'connected'
        : status?.status === 'revoked' ? 'error' : 'disconnected';
      updateIntegration(githubIntegrationId, {
        status: integrationStatus,
        lastError: error || status?.connection?.lastSyncErrorMessage,
        configuredAt: integrationStatus === 'connected'
          ? (githubConfiguredAt || new Date().toISOString())
          : githubConfiguredAt,
      });
    }
  }, [githubConfiguredAt, githubIntegrationId, updateIntegration]);

  const loadGithubStatus = useCallback(async () => {
    if (!isSignedIn) {
      setGithubConnectionStatus(null);
      return;
    }
    setGithubBusy('status');
    setGithubError(null);
    try {
      setGithubConnectionStatus(await getGithubLifeHeroStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GitHub status is unavailable.';
      setGithubError(message);
      setGithubConnectionStatus(null, message);
    } finally {
      setGithubBusy(null);
    }
  }, [isSignedIn, setGithubConnectionStatus]);

  useEffect(() => {
    if (!LIFE_HERO_ENABLED) return;
    void loadGithubStatus();
  }, [loadGithubStatus]);

  useEffect(() => {
    if (!LIFE_HERO_ENABLED || !isSignedIn) return;
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state');
    const code = params.get('code');
    const installationId = Number(params.get('installation_id'));
    if (!state || (!code && !Number.isSafeInteger(installationId))) return;

    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
    setGithubBusy('authorize');
    setGithubError(null);
    void (async () => {
      try {
        if (code) {
          await completeGithubLifeHeroAuthorization(code, state);
          await loadGithubStatus();
        } else {
          const result = await completeGithubLifeHeroInstallation(state, installationId);
          window.location.assign(result.authorizationUrl);
          return;
        }
      } catch (error) {
        setGithubError(error instanceof Error ? error.message : 'GitHub authorization failed.');
      } finally {
        setGithubBusy(null);
      }
    })();
  }, [isSignedIn, loadGithubStatus]);

  const handleGithubAuthorize = async () => {
    setGithubBusy('authorize');
    setGithubError(null);
    try {
      const installationId = githubInstalledAppId(window.location.search);
      const result = await beginGithubLifeHeroAuthorization(window.location.href.split('?')[0]);
      if (installationId) {
        const completion = await completeGithubLifeHeroInstallation(result.state, installationId);
        window.location.assign(completion.authorizationUrl);
        return;
      }
      window.location.assign(result.installationUrl);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub authorization could not start.');
      setGithubBusy(null);
    }
  };

  const handleGithubRepositories = async () => {
    setGithubBusy('repositories');
    setGithubError(null);
    try {
      setGithubRepositories(await listGithubLifeHeroRepositories());
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub repositories are unavailable.');
    } finally {
      setGithubBusy(null);
    }
  };

  const handleGithubSaveSelection = async (repositoryIds: number[]) => {
    setGithubBusy('save');
    setGithubError(null);
    try {
      const result = await saveGithubLifeHeroSelection(repositoryIds);
      setGithubRepositories(result.repositories);
      setGithubConnectionStatus({ status: 'connected', connection: result.connection });
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub repository selection could not be saved.');
    } finally {
      setGithubBusy(null);
    }
  };

  const handleGithubSync = async () => {
    const localDate = getAppDate(new Date(), settings.appTimeZone.effectiveTimeZone);
    if (!localDate) {
      setGithubError('The app time zone is unavailable, so GitHub evidence cannot be dated safely.');
      return;
    }
    setGithubBusy('sync');
    setGithubError(null);
    try {
      const result = await syncGithubLifeHeroEvidence(localDate, settings.appTimeZone.effectiveTimeZone);
      await loadGithubStatus();
      if (result.status === 'empty') setGithubError('No authored merged pull requests were found in the selected repositories.');
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub evidence sync failed. Existing progress is unchanged.');
    } finally {
      setGithubBusy(null);
    }
  };

  const handleGithubDisconnect = async () => {
    setGithubBusy('disconnect');
    setGithubError(null);
    try {
      await disconnectGithubLifeHero();
      setGithubRepositories([]);
      setGithubConnectionStatus(null);
      setConfirmDisconnect(null);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub disconnect failed.');
    } finally {
      setGithubBusy(null);
    }
  };

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
          {LIFE_HERO_ENABLED ? 'Connect Google Calendar or the read-only GitHub App while signed into Sabah One.' : 'Connect Google Calendar while signed into Sabah One.'}
          Slack and Linear connections are unavailable.
        </div>

        {calendar.syncProblem && (
          <div className="info-box warning" style={{ marginTop: 8 }} role="status">
            Google Calendar sync needs attention: {calendar.syncProblem}
          </div>
        )}

        {integrations.map(integration => {
          const status = integration.status === 'mocked' ? 'disconnected' : integration.status;
          const isGoogle = integration.provider === 'google';
          const isGithub = integration.provider === 'github';

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

              {isGithub && (
                <div style={{ marginTop: 8 }}>
                  <div className="info-box" style={{ marginBottom: 8 }}>
                    GitHub evidence uses a hosted GitHub App with exactly <strong>Metadata: read</strong> and <strong>Pull requests: read</strong> on repositories you select. Personal access tokens, repository contents, commits, comments, and source code are not accepted or retained.
                  </div>
                  {!isSignedIn && (
                    <div className="info-box warning" role="status">Sign in to Sabah One before connecting the read-only GitHub App. No GitHub data is available while signed out.</div>
                  )}
                  {isSignedIn && githubBusy === 'status' && <div role="status" aria-live="polite">Checking hosted GitHub App status...</div>}
                  {githubError && <div className="info-box warning" role="alert">{githubError}</div>}
                  {githubNeedsReconnect && (
                    <div className="info-box warning" role="status" style={{ marginBottom: 8 }}>
                      GitHub access was revoked or expired. Reconnect the GitHub App before syncing evidence or changing repository selection.
                    </div>
                  )}
                  {githubConnection && (
                    <div className="info-box" style={{ marginBottom: 8 }}>
                      <strong>Selected repositories: {githubConnection.selectedRepositoryIds.length}</strong>
                      <div style={{ fontSize: 11, color: '#8b90a8', marginTop: 4 }}>
                        {githubConnection.lastSyncAt ? `Last checked ${new Date(githubConnection.lastSyncAt).toLocaleString()}` : 'No evidence sync has run yet.'}
                        {githubConnection.lastSyncErrorMessage && ` · ${githubConnection.lastSyncErrorMessage}`}
                      </div>
                    </div>
                  )}
                  {configuring === integration.id && isSignedIn && githubConnection && !githubNeedsReconnect && (
                    <div className="info-box" style={{ marginBottom: 8 }}>
                      <div style={{ marginBottom: 8 }}>Choose the repositories whose merged pull requests may contribute one fixed Craft award per authored merge.</div>
                      {githubRepositories.length === 0 ? (
                        <button className="btn btn-secondary btn-sm" onClick={handleGithubRepositories} disabled={githubBusy === 'repositories'}>
                          {githubBusy === 'repositories' ? <><span className="spinner" /> Loading repositories...</> : 'Load selectable repositories'}
                        </button>
                      ) : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {githubRepositories.map(repository => {
                            const selected = githubConnection.selectedRepositoryIds.includes(repository.id);
                            return (
                              <label key={repository.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={githubBusy === 'save'}
                                  onChange={() => handleGithubSaveSelection(
                                    selected
                                      ? githubConnection.selectedRepositoryIds.filter(id => id !== repository.id)
                                      : [...githubConnection.selectedRepositoryIds, repository.id],
                                  )}
                                />
                                <span>{repository.fullName}{repository.private ? ' · private' : ''}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
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
                ) : isGithub ? (
                  <>
                    {!isSignedIn ? null : !githubConnection || githubNeedsReconnect ? (
                      <button className="btn btn-primary btn-sm" onClick={handleGithubAuthorize} disabled={githubBusy === 'authorize'}>
                        {githubBusy === 'authorize' ? <><span className="spinner" /> Opening GitHub...</> : githubNeedsReconnect ? 'Reconnect GitHub App' : 'Install and authorize GitHub App'}
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(configuring === integration.id ? null : integration.id); setGithubError(null); }}>
                          {configuring === integration.id ? 'Close repository selection' : 'Choose repositories'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={handleGithubSync} disabled={githubBusy === 'sync' || githubConnection.selectedRepositoryIds.length === 0}>
                          {githubBusy === 'sync' ? <><span className="spinner" /> Syncing...</> : 'Sync GitHub evidence'}
                        </button>
                        {confirmDisconnect === integration.id ? (
                          <div className="confirm-bar" style={{ margin: 0 }} role="alert">
                            Disconnect GitHub App and remove its server credential?
                            <button className="btn btn-danger btn-sm" onClick={handleGithubDisconnect} disabled={githubBusy === 'disconnect'}>Disconnect</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDisconnect(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDisconnect(integration.id)}>Disconnect</button>
                        )}
                      </>
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
