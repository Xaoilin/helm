import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCalendar } from "../store/contexts/CalendarContext";
import { defaultIntegrations, useSettingsContext } from "../store/contexts/SettingsContext";
import type { CalendarAccount } from '../types/domain';
import { useGoogleSync } from '../hooks/useGoogleSync';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';
import { appendGoogleCalendarDiagnosticEvent } from '../services/googleCalendarDiagnosticEvents';
import { getAuthSessionSnapshot } from '../store/supabase';
import { getAppDate } from '../services/appTimeZone';
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
import {
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  connectGoogleCalendarOAuthAccount,
  connectProfileGoogleCalendar,
  clearGoogleCalendarAuth,
  GoogleCalendarReconnectRequiredError,
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
  const calendar = useCalendar();
  const settings = useSettingsContext();
  const googleSync = useGoogleSync();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [googleBusyAction, setGoogleBusyAction] = useState<'profile' | 'oauth' | `reconnect:${string}` | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubLifeHeroStatus | null>(null);
  const [githubRepositories, setGithubRepositories] = useState<GithubLifeHeroRepository[]>([]);
  const [githubBusy, setGithubBusy] = useState<'status' | 'authorize' | 'repositories' | 'save' | 'sync' | 'disconnect' | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);

  // One supported card per provider; never persist this display projection.
  const integrations = defaultIntegrations.map(provider => ({
    ...provider,
    ...settings.integrations.find(record => record.provider === provider.provider),
    name: provider.name,
    description: provider.description,
  }));
  const googleAccounts = calendar.calendarAccounts.filter(isGoogleCalendarAccount);
  const clientId = GOOGLE_OAUTH_CLIENT_ID;
  const authSnapshot = getAuthSessionSnapshot();
  const isSignedIn = Boolean(authSnapshot?.userId);
  const googleIntegrationId = integrations.find(integration => integration.provider === 'google')?.id ?? 'int-google';
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
    void loadGithubStatus();
  }, [loadGithubStatus]);

  useEffect(() => {
    if (!isSignedIn) return;
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
  const hostedGoogleIssue = googleSync.serverRuntimeStatus?.lastError ?? null;
  const linkedProfileAccount = useMemo(() => (
    profileEmail
      ? googleAccounts.find(account => normalizeEmail(account.email) === normalizeEmail(profileEmail))
      : undefined
  ), [googleAccounts, profileEmail]);
  const canLinkSignedInGoogle = Boolean(profileEmail && authSnapshot?.provider === 'google' && !linkedProfileAccount);
  const needsProfileReconnect = Boolean(profileEmail && authSnapshot?.provider === 'google' && !authSnapshot?.providerRefreshToken);

  const isLinkedProfileAccount = (account: CalendarAccount): boolean => {
    if (account.authProvider === 'profile-google') return true;
    return Boolean(
      profileEmail
      && authSnapshot?.provider === 'google'
      && normalizeEmail(account.email) === normalizeEmail(profileEmail),
    );
  };

  const addSourcesIfMissing = (accountId: string, calendars: Awaited<ReturnType<typeof connectProfileGoogleCalendar>>['calendars']) => {
    const existingGoogleIds = new Set(
      calendar.calendarSources
        .filter(source => source.accountId === accountId && source.googleCalendarId)
        .map(source => source.googleCalendarId!),
    );
    const foreignGoogleIds = new Set(
      calendar.calendarSources
        .filter(source => source.accountId !== accountId && source.googleCalendarId)
        .map(source => source.googleCalendarId!),
    );

    for (const calendarEntry of calendars) {
      if (existingGoogleIds.has(calendarEntry.id) || foreignGoogleIds.has(calendarEntry.id)) continue;
      calendar.addCalendarSource({
        accountId,
        name: calendarEntry.summary,
        color: calendarEntry.backgroundColor || '#4f5bff',
        visible: true,
        googleCalendarId: calendarEntry.id,
        accessRole: calendarEntry.accessRole,
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
        calendar.updateCalendarAccount(existing.id, {
          name: result.accountName,
          connected: true,
          mocked: false,
          ...getGoogleCalendarAuthPatch({ ...existing, name: result.accountName, connected: true, mocked: false }),
        });
        addSourcesIfMissing(existing.id, result.calendars);
      } else {
        const accountId = calendar.addCalendarAccount({
          name: result.accountName,
          email: result.email,
          provider: 'google',
          isPrimary: calendar.calendarAccounts.length === 0,
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

      settings.updateIntegration(googleIntegrationId, {
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
      setGoogleError('Google Calendar setup is unavailable. Ask the site operator to configure Google Calendar, then try again.');
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

      const accountId = calendar.addCalendarAccount({
        name: result.accountName,
        email: result.email,
        provider: 'google',
        isPrimary: calendar.calendarAccounts.length === 0,
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
      settings.updateIntegration(googleIntegrationId, {
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

      if (!clientId?.trim()) {
        setGoogleError('Google Calendar setup is unavailable. Ask the site operator to configure Google Calendar, then try again.');
        return;
      }

      const result = await reconnectGoogleCalendarOAuthAccount(account, clientId.trim());
      calendar.updateCalendarAccount(account.id, {
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
      settings.updateIntegration(googleIntegrationId, {
        status: 'connected',
        configuredAt: new Date().toISOString(),
        lastError: undefined,
      });
      await googleSync.refreshCredentialStatuses();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reconnect failed';
      setGoogleError(message);
      calendar.updateCalendarAccount(account.id, {
        authProvider: error instanceof GoogleCalendarReconnectRequiredError ? error.authProvider : account.authProvider,
        authStatus: error instanceof GoogleCalendarReconnectRequiredError
          ? error.authStatus
          : isLinkedProfileAccount(account) ? 'needs_reconnect' : account.authStatus,
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

    let revokeFailureMessage: string | null = null;
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
        revokeFailureMessage = error instanceof Error ? error.message : 'Disconnect failed';
      }
    }

    clearGoogleCalendarAuth(accountId);

    calendar.removeCalendarAccount(accountId);

    const remaining = googleAccounts.filter(account => account.id !== accountId);
    if (remaining.length === 0) {
      settings.updateIntegration(googleIntegrationId, {
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
      message: revokeFailureMessage
        ? `Disconnected Google Calendar account ${account.email} locally, but hosted credential cleanup failed: ${revokeFailureMessage}`
        : `Disconnected Google Calendar account ${account.email}.`,
    });
    setConfirmDisconnect(null);
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
          Connect Google Calendar or the read-only GitHub App while signed into Sabah One.
          Slack and Linear connections are unavailable.
        </div>

        {hostedGoogleIssue && (
          <div className="info-box warning" style={{ marginTop: 8 }}>
            Hosted Google Calendar status is degraded right now: {hostedGoogleIssue}
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
                            {getGoogleCalendarStatusLabel(account)}
                          </span>
                          {account.authProvider === 'profile-google' && (
                            <span style={{ fontSize: 11, color: '#8b90a8' }}>Linked to your Sabah One Google sign-in</span>
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
                          <div className="info-box warning" style={{ marginBottom: 8 }}>
                            {googleError}
                          </div>
                        )}

                        {canLinkSignedInGoogle && (
                          <div className="info-box" style={{ marginBottom: 8 }}>
                            {needsProfileReconnect
                              ? `You are signed into Sabah One as ${profileEmail}. Reconnect that Google sign-in once so Sabah One can store a durable Calendar credential.`
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
                            Adding another Google account is unavailable because this website has no Google Calendar client configured.
                            Ask the site operator to configure Google Calendar, then try again.
                          </div>
                        )}

                        <div className="info-box" style={{ marginBottom: 8 }}>
                          Sabah One keeps refreshable Google Calendar credentials on the server for browser sync. The one-hour Google access token lifetime shown in Debug is transport metadata, not your account connection lifetime.
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
                          <button className="btn btn-secondary btn-sm" onClick={() => { setConfiguring(null); setGoogleError(null); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfiguring(integration.id); setGoogleError(null); }}>
                        {googleAccounts.length > 0 || canLinkSignedInGoogle ? '+ Add Account' : 'Configure'}
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
