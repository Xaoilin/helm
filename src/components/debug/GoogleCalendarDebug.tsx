import { startTransition, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { useGoogleSync } from '../../hooks/useGoogleSync';
import { GOOGLE_OAUTH_CLIENT_ID } from '../../config';
import {
  buildGoogleCalendarDiagnosticsExport,
  downloadGoogleCalendarDiagnosticsExport,
  clearGoogleCalendarDiagnosticEvents,
  getGoogleCalendarDiagnosticSummary,
  subscribeGoogleCalendarDiagnosticEvents,
  type GoogleCalendarDiagnosticEvent,
} from '../../services/googleCalendarDiagnosticEvents';
import {
  getGoogleCalendarDebugSnapshot,
  runGoogleCalendarPassiveProbe,
  type GoogleCalendarPassiveProbeResult,
  type GoogleCalendarStoredTokenState,
} from '../../services/googleCalendarDiagnostics';
import { isGoogleCalendarAccount } from '../../services/googleCalendarAuthManager';

function formatTimestamp(value?: string): string {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString();
}

function formatOptional(value?: string): string {
  return value || 'None';
}

function getTokenTone(state: GoogleCalendarStoredTokenState): string {
  switch (state) {
    case 'valid':
      return 'connected';
    case 'expired':
      return 'needs-reconnect';
    default:
      return 'disconnected';
  }
}

function getProbeTone(result?: GoogleCalendarPassiveProbeResult): string {
  switch (result?.status) {
    case 'success':
      return 'connected';
    case 'blocked':
      return 'disconnected';
    case 'revoked':
    case 'needs_reconnect':
    case 'ownership_mismatch':
      return 'needs-reconnect';
    case 'error':
      return 'error';
    default:
      return 'disconnected';
  }
}

function getDiagnosticTone(event: GoogleCalendarDiagnosticEvent | null | undefined): string {
  switch (event?.outcome) {
    case 'success':
      return 'connected';
    case 'blocked':
      return 'disconnected';
    case 'revoked':
    case 'needs_reconnect':
    case 'ownership_mismatch':
      return 'needs-reconnect';
    case 'temporary_unavailable':
    case 'failure':
      return 'error';
    default:
      return 'disconnected';
  }
}

function DebugField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: 8 }}>
      <div style={{ color: '#8b90a8' }}>{label}</div>
      <div style={{ wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function TimelineRow({ event }: { event: GoogleCalendarDiagnosticEvent }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        border: '1px solid #2a2f45',
        borderRadius: 12,
        background: '#161a28',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8b90a8' }}>{formatTimestamp(event.timestamp)}</span>
        <span className={`tag tag-${getDiagnosticTone(event)}`}>{event.operation.replaceAll('_', ' ')}</span>
        <span className={`tag tag-${getDiagnosticTone(event)}`}>{event.phase}</span>
        {event.code && <span className="tag tag-disconnected">{event.code}</span>}
        {event.requestId && <span className="tag tag-connected">request {event.requestId.slice(0, 8)}</span>}
      </div>
      <div style={{ fontSize: 13 }}>{event.message}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#8b90a8' }}>
        {event.email && <span>{event.email}</span>}
        {event.accountId && <span>Account {event.accountId}</span>}
        {event.calendarId && <span>Calendar {event.calendarId}</span>}
        {typeof event.httpStatus === 'number' && <span>HTTP {event.httpStatus}</span>}
        {typeof event.calendarCount === 'number' && <span>{event.calendarCount} calendars</span>}
        {typeof event.eventCount === 'number' && <span>{event.eventCount} events</span>}
        {typeof event.fetchedEventCount === 'number' && <span>{event.fetchedEventCount} fetched</span>}
        {typeof event.upsertedEventCount === 'number' && <span>{event.upsertedEventCount} added or updated</span>}
        {typeof event.relinkedEventCount === 'number' && event.relinkedEventCount > 0 && <span>{event.relinkedEventCount} relinked</span>}
        {typeof event.cachedEventCount === 'number' && <span>{event.cachedEventCount} cached</span>}
        {typeof event.visibleCachedEventCount === 'number' && <span>{event.visibleCachedEventCount} visible</span>}
        {event.primaryCalendarEmail && <span>Primary {event.primaryCalendarEmail}</span>}
      </div>
    </div>
  );
}

export default function GoogleCalendarDebug() {
  const app = useApp();
  const googleSync = useGoogleSync();
  const googleAccounts = useMemo(
    () => app.calendarAccounts.filter(isGoogleCalendarAccount),
    [app.calendarAccounts],
  );
  const snapshot = useMemo(
    () => getGoogleCalendarDebugSnapshot(app.calendarAccounts, googleSync.credentialStatuses),
    [app.calendarAccounts, googleSync.credentialStatuses],
  );
  const [checking, setChecking] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionState, setActionState] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, GoogleCalendarPassiveProbeResult>>({});
  const [timelineEvents, setTimelineEvents] = useState<GoogleCalendarDiagnosticEvent[]>([]);

  useEffect(() => {
    return subscribeGoogleCalendarDiagnosticEvents(setTimelineEvents);
  }, []);

  const summary = useMemo(
    () => getGoogleCalendarDiagnosticSummary(timelineEvents),
    [timelineEvents],
  );
  const diagnosticsPayload = useMemo(() => ({
    snapshot,
    syncDiagnostics: googleSync.diagnostics,
    serverRuntimeStatus: googleSync.serverRuntimeStatus,
    latestFailure: summary.latestFailure,
    latestSuccess: summary.latestSuccess,
    timelineEvents,
    probeResults,
  }), [
    googleSync.diagnostics,
    googleSync.serverRuntimeStatus,
    probeResults,
    snapshot,
    summary.latestFailure,
    summary.latestSuccess,
    timelineEvents,
  ]);

  const runProbe = async () => {
    if (googleAccounts.length === 0 || checking) return;

    setChecking(true);
    try {
      const results = await Promise.all(
        googleAccounts.map(account => runGoogleCalendarPassiveProbe(account, GOOGLE_OAUTH_CLIENT_ID.trim())),
      );

      startTransition(() => {
        setProbeResults(Object.fromEntries(results.map(result => [result.accountId, result])));
      });
    } finally {
      setChecking(false);
    }
  };

  const refreshServerStatus = async () => {
    if (refreshingStatus) return;
    setRefreshingStatus(true);
    try {
      await googleSync.refreshCredentialStatuses();
    } finally {
      setRefreshingStatus(false);
    }
  };

  const copyDiagnostics = async () => {
    const payload = buildGoogleCalendarDiagnosticsExport(diagnosticsPayload);
    await navigator.clipboard.writeText(payload);
    setActionState(`Copied diagnostics with ${timelineEvents.length} stored event${timelineEvents.length === 1 ? '' : 's'}.`);
  };

  const exportDiagnostics = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const artifact = await downloadGoogleCalendarDiagnosticsExport(diagnosticsPayload);
      if (artifact.method === 'cancelled') {
        setActionState('Export cancelled.');
        return;
      }

      const exportedVia = artifact.method === 'save_picker' ? 'Saved' : 'Started download for';
      setActionState(`${exportedVia} ${artifact.fileName}.`);
    } finally {
      setExporting(false);
    }
  };

  const clearDiagnostics = () => {
    clearGoogleCalendarDiagnosticEvents();
    setProbeResults({});
    setActionState('Cleared stored Google Calendar diagnostics.');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Google Calendar Diagnostics</h2>
            <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 6 }}>
              This panel exists for the case where a fix looked right locally but failed in live use. It keeps a redacted runtime timeline plus current hosted-auth state so we can see what actually happened.
            </div>
            <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 6 }}>
              Last sync trigger: {googleSync.diagnostics.lastTriggerSource ? `${googleSync.diagnostics.lastTriggerSource} at ${formatTimestamp(googleSync.diagnostics.lastTriggerAt)}` : 'Not recorded'}
            </div>
          </div>
          <div className="actions-row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { void refreshServerStatus(); }}
              disabled={refreshingStatus}
            >
              {refreshingStatus ? <><span className="spinner" /> Refreshing...</> : 'Refresh server status'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { void runProbe(); }}
              disabled={checking || googleAccounts.length === 0}
            >
              {checking ? <><span className="spinner" /> Checking...</> : 'Run Google Calendar auth check'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { void copyDiagnostics(); }}
            >
              Copy diagnostics
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { void exportDiagnostics(); }}
              disabled={exporting}
            >
              {exporting ? <><span className="spinner" /> Exporting...</> : 'Export diagnostics (.json)'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={clearDiagnostics}
              disabled={timelineEvents.length === 0}
            >
              Clear diagnostics
            </button>
          </div>
        </div>
        {actionState && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#8b90a8' }}>{actionState}</div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Latest Runtime Summary</h3>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 12, background: '#161a28', border: '1px solid #2a2f45' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>Latest backend or sync failure</strong>
              {summary.latestFailure && <span className={`tag tag-${getDiagnosticTone(summary.latestFailure)}`}>{summary.latestFailure.operation.replaceAll('_', ' ')}</span>}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              {summary.latestFailure ? summary.latestFailure.message : 'No recorded failure in the current local diagnostics timeline.'}
            </div>
            {summary.latestFailure && (
              <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 6 }}>
                {formatTimestamp(summary.latestFailure.timestamp)}
                {summary.latestFailure.requestId ? ` · Request ${summary.latestFailure.requestId}` : ''}
                {typeof summary.latestFailure.httpStatus === 'number' ? ` · HTTP ${summary.latestFailure.httpStatus}` : ''}
              </div>
            )}
          </div>

          <div style={{ padding: 12, borderRadius: 12, background: '#161a28', border: '1px solid #2a2f45' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>Latest successful runtime event</strong>
              {summary.latestSuccess && <span className={`tag tag-${getDiagnosticTone(summary.latestSuccess)}`}>{summary.latestSuccess.operation.replaceAll('_', ' ')}</span>}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              {summary.latestSuccess ? summary.latestSuccess.message : 'No success recorded yet in this local diagnostics timeline.'}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Hosted Backend Status</h3>
        {googleSync.serverRuntimeStatus ? (
          <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <DebugField label="Checked at" value={formatTimestamp(googleSync.serverRuntimeStatus.checkedAt)} />
            <DebugField label="Request ID" value={formatOptional(googleSync.serverRuntimeStatus.requestId)} />
            <DebugField label="Function reachable" value={googleSync.serverRuntimeStatus.readiness.functionReachable ? 'Yes' : 'No'} />
            <DebugField label="OAuth configured" value={googleSync.serverRuntimeStatus.readiness.oauthConfigured ? 'Yes' : 'No'} />
            <DebugField label="Origin allowed" value={googleSync.serverRuntimeStatus.readiness.originAllowed ? 'Yes' : 'No'} />
            <DebugField label="Signed in" value={googleSync.serverRuntimeStatus.readiness.signedIn ? 'Yes' : 'No'} />
            <DebugField label="Status rows returned" value={String(googleSync.serverRuntimeStatus.statusCount)} />
            <DebugField label="Last backend error" value={formatOptional(googleSync.serverRuntimeStatus.lastError)} />
            <DebugField label="Last backend code" value={formatOptional(googleSync.serverRuntimeStatus.lastErrorCode)} />
          </div>
        ) : (
          <div style={{ color: '#8b90a8' }}>No hosted backend status has been recorded yet.</div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Sabah One Auth Context</h3>
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <DebugField label="Supabase ready" value={snapshot.supabaseReady ? 'Yes' : 'No'} />
          <DebugField label="Auth bootstrapped" value={snapshot.authSessionBootstrapped ? 'Yes' : 'No'} />
          <DebugField label="Session email" value={formatOptional(snapshot.session.email)} />
          <DebugField label="Session provider" value={formatOptional(snapshot.session.provider)} />
          <DebugField label="Access token present" value={snapshot.session.accessTokenPresent ? 'Yes' : 'No'} />
          <DebugField label="Profile access token present" value={snapshot.session.providerTokenPresent ? 'Yes' : 'No'} />
          <DebugField label="Refresh token present" value={snapshot.session.providerRefreshTokenPresent ? 'Yes' : 'No'} />
          <DebugField label="Session expires" value={snapshot.session.expiresAt ? formatTimestamp(snapshot.session.expiresAt) : 'Not available'} />
        </div>
      </div>

      {snapshot.accounts.length === 0 ? (
        <div className="card" style={{ padding: 20, color: '#8b90a8' }}>
          No active Google Calendar accounts are connected right now.
        </div>
      ) : (
        snapshot.accounts.map(account => {
          const probeResult = probeResults[account.accountId];
          const syncDiagnostic = googleSync.diagnostics.accounts[account.accountId];
          return (
            <div key={account.accountId} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{account.email}</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <span className="tag tag-connected" role="status">{account.resolvedAuthProvider}</span>
                    <span className={`tag tag-${account.serverCredentialPresent ? 'connected' : 'disconnected'}`} role="status">
                      {account.serverCredentialPresent ? 'Server credential present' : 'No server credential'}
                    </span>
                    <span className={`tag tag-${account.credentialHealth === 'refreshable' ? 'connected' : account.credentialHealth === 'temporary_unavailable' ? 'error' : 'needs-reconnect'}`} role="status">
                      Credential {account.credentialHealth.replace('_', ' ')}
                    </span>
                    <span className={`tag tag-${account.credentialSource === 'server' ? 'connected' : account.credentialSource === 'legacy_browser_token' ? 'needs-reconnect' : 'disconnected'}`} role="status">
                      Source: {account.credentialSource.replace('_', ' ')}
                    </span>
                    <span className={`tag tag-${getTokenTone(account.storedToken.state)}`} role="status">
                      Legacy token {account.storedToken.state}
                    </span>
                    <span className={`tag tag-${account.passiveSyncEligible ? 'connected' : 'disconnected'}`} role="status">
                      {account.passiveSyncEligible ? 'Passive sync eligible' : 'Passive sync blocked'}
                    </span>
                    {probeResult && (
                      <span className={`tag tag-${getProbeTone(probeResult)}`} role="status">
                        Probe: {probeResult.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                </div>
                {probeResult && (
                  <div style={{ fontSize: 12, color: '#8b90a8', textAlign: 'right' }}>
                    Checked {formatTimestamp(probeResult.checkedAt)}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gap: 6, fontSize: 13, marginTop: 14 }}>
                <DebugField label="Account ID" value={account.accountId} />
                <DebugField label="Stored auth status" value={account.storedAuthStatus || 'Not set'} />
                <DebugField label="Resolved provider" value={account.resolvedAuthProvider} />
                <DebugField label="Credential source" value={account.credentialSource.replace('_', ' ')} />
                <DebugField label="Server credential present" value={account.serverCredentialPresent ? 'Yes' : 'No'} />
                <DebugField label="Credential health" value={account.credentialHealth.replace('_', ' ')} />
                <DebugField label="Last sync" value={formatTimestamp(account.lastSyncTime)} />
                <DebugField label="Access checked" value={formatTimestamp(account.lastAuthCheckAt)} />
                <DebugField
                  label="Current access token expires"
                  value={account.currentAccessTokenExpiresAt ? formatTimestamp(account.currentAccessTokenExpiresAt) : 'Unknown'}
                />
                <DebugField label="Last refresh at" value={formatTimestamp(account.lastRefreshAt)} />
                <DebugField label="Last refresh failure" value={formatOptional(account.lastRefreshFailureReason)} />
                <DebugField label="Last refresh failure at" value={formatTimestamp(account.lastRefreshFailureAt)} />
                <DebugField label="Upgrade required" value={account.upgradeRequired ? 'Yes' : 'No'} />
                <DebugField label="Legacy token present" value={account.storedToken.present ? 'Yes' : 'No'} />
                <DebugField label="Legacy token scope" value={formatOptional(account.storedToken.scope)} />
                <DebugField label="Legacy token expiry" value={account.storedToken.expiresAt ? formatTimestamp(account.storedToken.expiresAt) : 'Unknown'} />
                <DebugField label="Passive sync" value={account.passiveSyncEligible ? 'Eligible' : 'Blocked'} />
                <DebugField label="Blocked reason" value={account.passiveSyncBlockedReason || 'None'} />
                <DebugField label="Last sync trigger" value={syncDiagnostic ? `${syncDiagnostic.triggerSource} at ${formatTimestamp(syncDiagnostic.checkedAt)}` : 'Not recorded'} />
                <DebugField label="Last sync outcome" value={syncDiagnostic ? syncDiagnostic.outcome.replace('_', ' ') : 'Not recorded'} />
                <DebugField label="Last sync note" value={syncDiagnostic?.message || 'None'} />
                <DebugField label="Fetched events" value={typeof syncDiagnostic?.fetchedEventCount === 'number' ? String(syncDiagnostic.fetchedEventCount) : 'Not recorded'} />
                <DebugField label="Added or updated" value={typeof syncDiagnostic?.upsertedEventCount === 'number' ? String(syncDiagnostic.upsertedEventCount) : 'Not recorded'} />
                <DebugField label="Relinked cached events" value={typeof syncDiagnostic?.relinkedEventCount === 'number' ? String(syncDiagnostic.relinkedEventCount) : 'Not recorded'} />
                <DebugField label="Cached Google events" value={typeof syncDiagnostic?.cachedEventCount === 'number' ? String(syncDiagnostic.cachedEventCount) : 'Not recorded'} />
                <DebugField label="Visible Google events" value={typeof syncDiagnostic?.visibleCachedEventCount === 'number' ? String(syncDiagnostic.visibleCachedEventCount) : 'Not recorded'} />
                <DebugField label="Ownership email" value={syncDiagnostic?.primaryCalendarEmail || 'Not recorded'} />
                <DebugField label="Skipped deletes" value={syncDiagnostic?.skippedDestructiveRemovals ? 'Yes' : 'No'} />
                <DebugField label="Last auth error" value={formatOptional(account.lastAuthError)} />
                <DebugField label="Sync error" value={formatOptional(account.syncError)} />
                {probeResult && (
                  <>
                    <DebugField label="Probe result" value={probeResult.message} />
                    <DebugField label="Probe calendars" value={typeof probeResult.calendarCount === 'number' ? String(probeResult.calendarCount) : 'Not available'} />
                    <DebugField
                      label="Probe current access token expiry"
                      value={probeResult.currentAccessTokenExpiresAt ? formatTimestamp(probeResult.currentAccessTokenExpiresAt) : 'Not available'}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })
      )}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Recent Runtime Timeline</h3>
        {summary.latestEvents.length === 0 ? (
          <div style={{ color: '#8b90a8' }}>
            No Google Calendar diagnostics have been recorded yet on this device.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {summary.latestEvents.map(event => (
              <TimelineRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
