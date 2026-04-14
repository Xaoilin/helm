import { startTransition, useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { useGoogleSync } from '../../hooks/useGoogleSync';
import { GOOGLE_OAUTH_CLIENT_ID } from '../../config';
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

function DebugField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: 8 }}>
      <div style={{ color: '#8b90a8' }}>{label}</div>
      <div style={{ wordBreak: 'break-word' }}>{value}</div>
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
    () => getGoogleCalendarDebugSnapshot(app.calendarAccounts),
    [app.calendarAccounts],
  );
  const [checking, setChecking] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, GoogleCalendarPassiveProbeResult>>({});

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

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Google Calendar Diagnostics</h2>
            <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 6 }}>
              Auth-state visibility for Calendar accounts. Tokens stay redacted; this panel only shows presence, expiry, scope, and passive auth outcomes.
            </div>
            <div style={{ fontSize: 12, color: '#8b90a8', marginTop: 6 }}>
              Last sync trigger: {googleSync.diagnostics.lastTriggerSource ? `${googleSync.diagnostics.lastTriggerSource} at ${formatTimestamp(googleSync.diagnostics.lastTriggerAt)}` : 'Not recorded'}
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { void runProbe(); }}
            disabled={checking || googleAccounts.length === 0}
          >
            {checking ? <><span className="spinner" /> Checking...</> : 'Run Google Calendar auth check'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>HELM Auth Context</h3>
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <DebugField label="Supabase ready" value={snapshot.supabaseReady ? 'Yes' : 'No'} />
          <DebugField label="Auth bootstrapped" value={snapshot.authSessionBootstrapped ? 'Yes' : 'No'} />
          <DebugField label="Session email" value={formatOptional(snapshot.session.email)} />
          <DebugField label="Session provider" value={formatOptional(snapshot.session.provider)} />
          <DebugField label="Access token present" value={snapshot.session.accessTokenPresent ? 'Yes' : 'No'} />
          <DebugField label="Profile token present" value={snapshot.session.providerTokenPresent ? 'Yes' : 'No'} />
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
                    <span className={`tag tag-${getTokenTone(account.storedToken.state)}`} role="status">
                      Stored token {account.storedToken.state}
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
                <DebugField label="Last sync" value={formatTimestamp(account.lastSyncTime)} />
                <DebugField label="Access checked" value={formatTimestamp(account.lastAuthCheckAt)} />
                <DebugField label="Token expires" value={account.authExpiresAt ? formatTimestamp(account.authExpiresAt) : 'Unknown'} />
                <DebugField label="Stored token present" value={account.storedToken.present ? 'Yes' : 'No'} />
                <DebugField label="Stored token scope" value={formatOptional(account.storedToken.scope)} />
                <DebugField label="Stored token expiry" value={account.storedToken.expiresAt ? formatTimestamp(account.storedToken.expiresAt) : 'Unknown'} />
                <DebugField label="Passive sync" value={account.passiveSyncEligible ? 'Eligible' : 'Blocked'} />
                <DebugField label="Blocked reason" value={account.passiveSyncBlockedReason || 'None'} />
                <DebugField label="Last sync trigger" value={syncDiagnostic ? `${syncDiagnostic.triggerSource} at ${formatTimestamp(syncDiagnostic.checkedAt)}` : 'Not recorded'} />
                <DebugField label="Last sync outcome" value={syncDiagnostic ? syncDiagnostic.outcome.replace('_', ' ') : 'Not recorded'} />
                <DebugField label="Last sync note" value={syncDiagnostic?.message || 'None'} />
                <DebugField label="Ownership email" value={syncDiagnostic?.primaryCalendarEmail || 'Not recorded'} />
                <DebugField
                  label="Skipped deletes"
                  value={syncDiagnostic?.skippedDestructiveRemovals ? 'Yes' : 'No'}
                />
                <DebugField label="Last auth error" value={formatOptional(account.lastAuthError)} />
                <DebugField label="Sync error" value={formatOptional(account.syncError)} />
                {probeResult && (
                  <>
                    <DebugField label="Probe result" value={probeResult.message} />
                    <DebugField label="Probe calendars" value={typeof probeResult.calendarCount === 'number' ? String(probeResult.calendarCount) : 'Not available'} />
                    <DebugField
                      label="Probe token expiry"
                      value={probeResult.authExpiresAt ? formatTimestamp(probeResult.authExpiresAt) : 'Not available'}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
