import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { HOSTED_ASSISTANT_FUNCTION, HOSTED_ASSISTANT_MODEL, OLLAMA_ENDPOINT } from '../../config';
import { useApp } from '../../store/AppContext';
import {
  getAssistantProviderSetting,
  getAssistantRuntimeStatus,
  type AssistantRuntimeStatus,
} from '../../services/assistantAvailability';
import {
  chatWithHostedAssistant,
  getHostedAssistantDiagnostics,
  resetHostedAssistantDiagnostics,
  testHostedAssistantConnection,
  type HostedAssistantConnectionStatus,
} from '../../services/hostedAssistantApi';
import { formatHostedAssistantAccessMode } from '../../services/hostedAssistantAccess';
import { listOllamaModels, testOllamaConnection } from '../../services/ollamaApi';
import { ollamaBreaker } from '../../services/serviceBreakers';
import {
  getAuthSessionSnapshot,
  getCurrentUserId,
  isAuthenticated,
  isSupabaseReady,
} from '../../store/supabase';

type DiagnosticState = 'idle' | 'running' | 'success' | 'warning' | 'error';

interface DiagnosticResult {
  state: DiagnosticState;
  headline: string;
  detail: string;
  checkedAt: string | null;
  payload?: string;
}

const DEFAULT_HOSTED_RESULT: DiagnosticResult = {
  state: 'idle',
  headline: 'Hosted assistant not tested yet',
  detail: 'Run a hosted check to verify the Supabase Edge Function and the current hosted access path.',
  checkedAt: null,
};

const DEFAULT_HOSTED_SMOKE_RESULT: DiagnosticResult = {
  state: 'idle',
  headline: 'Hosted smoke test not run',
  detail: 'Run the smoke test to send a real chat request through the hosted assistant.',
  checkedAt: null,
};

const DEFAULT_OLLAMA_RESULT: DiagnosticResult = {
  state: 'idle',
  headline: 'Ollama not tested yet',
  detail: 'Run an Ollama check to verify the local endpoint and see which models are available.',
  checkedAt: null,
};

const SMOKE_TEST_MESSAGES = [
  {
    role: 'system' as const,
    content: 'You are a HELM hosted assistant smoke test. Return JSON with reply set to READY.',
  },
  {
    role: 'user' as const,
    content: 'Return JSON with reply set to READY.',
  },
];

const SMOKE_TEST_FORMAT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: {
      type: 'string',
    },
  },
  required: ['reply'],
} as const;

export default function AiDebug() {
  const app = useApp();
  const [runtimeStatus, setRuntimeStatus] = useState<AssistantRuntimeStatus | null>(null);
  const [runtimeCheckedAt, setRuntimeCheckedAt] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [refreshingRuntime, setRefreshingRuntime] = useState(false);
  const [hostedResult, setHostedResult] = useState<DiagnosticResult>(DEFAULT_HOSTED_RESULT);
  const [smokeResult, setSmokeResult] = useState<DiagnosticResult>(DEFAULT_HOSTED_SMOKE_RESULT);
  const [ollamaResult, setOllamaResult] = useState<DiagnosticResult>(DEFAULT_OLLAMA_RESULT);
  const [copyState, setCopyState] = useState<DiagnosticState>('idle');

  const providerSetting = getAssistantProviderSetting(app.settings);
  const ollamaEndpoint = app.settings.ollamaEndpoint || OLLAMA_ENDPOINT;
  const ollamaModel = app.settings.ollamaModel || 'qwen3';
  const sessionSnapshot = getAuthSessionSnapshot();
  const supabaseReady = isSupabaseReady();
  const authenticated = isAuthenticated();
  const currentUserId = getCurrentUserId();
  const hostedDiagnostics = getHostedAssistantDiagnostics();
  const hostedAccessMode = formatHostedAssistantAccessMode(hostedDiagnostics.lastAccessMode);

  const refreshRuntime = useCallback(async () => {
    setRefreshingRuntime(true);
    setRuntimeError(null);
    try {
      const nextStatus = await getAssistantRuntimeStatus(app.settings);
      setRuntimeStatus(nextStatus);
      setRuntimeCheckedAt(new Date().toISOString());
    } catch (error) {
      const message = getErrorMessage(error);
      setRuntimeStatus(null);
      setRuntimeError(message);
      setRuntimeCheckedAt(new Date().toISOString());
    } finally {
      setRefreshingRuntime(false);
    }
  }, [app.settings]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  async function runHostedCheck() {
    setHostedResult({
      state: 'running',
      headline: 'Testing hosted assistant...',
      detail: 'Checking the Supabase Edge Function health path with your current session.',
      checkedAt: null,
    });

    const checkedAt = new Date().toISOString();

    try {
      const status = await testHostedAssistantConnection();
      setHostedResult(mapHostedStatus(status, checkedAt));
    } catch (error) {
      setHostedResult({
        state: 'error',
        headline: 'Hosted assistant check failed',
        detail: getErrorMessage(error),
        checkedAt,
      });
    }
  }

  async function runHostedSmokeTest() {
    setSmokeResult({
      state: 'running',
      headline: 'Running hosted smoke test...',
      detail: 'Sending a real chat request through the same hosted path Lina uses for open-ended replies.',
      checkedAt: null,
    });

    const checkedAt = new Date().toISOString();

    try {
      const text = await chatWithHostedAssistant(SMOKE_TEST_MESSAGES, SMOKE_TEST_FORMAT);
      setSmokeResult({
        state: 'success',
        headline: 'Hosted smoke test passed',
        detail: 'The hosted assistant returned a live reply through Supabase.',
        checkedAt,
        payload: text,
      });
    } catch (error) {
      setSmokeResult({
        state: 'error',
        headline: 'Hosted smoke test failed',
        detail: getErrorMessage(error),
        checkedAt,
      });
    }
  }

  async function runOllamaCheck() {
    setOllamaResult({
      state: 'running',
      headline: 'Testing Ollama...',
      detail: `Checking ${ollamaEndpoint} and listing local models if the endpoint responds.`,
      checkedAt: null,
    });

    const checkedAt = new Date().toISOString();

    try {
      const connected = await testOllamaConnection(ollamaEndpoint);
      if (!connected) {
        setOllamaResult({
          state: 'warning',
          headline: 'Ollama offline',
          detail: `HELM could not reach ${ollamaEndpoint}. Start Ollama locally or update the configured endpoint.`,
          checkedAt,
        });
        return;
      }

      const models = await listOllamaModels(ollamaEndpoint);
      setOllamaResult({
        state: 'success',
        headline: 'Ollama reachable',
        detail: models.length > 0
          ? `Connected to ${ollamaEndpoint} and found ${models.length} local model${models.length === 1 ? '' : 's'}.`
          : `Connected to ${ollamaEndpoint}, but the model list came back empty.`,
        checkedAt,
        payload: models.length > 0 ? models.join(', ') : 'No models reported',
      });
    } catch (error) {
      setOllamaResult({
        state: 'error',
        headline: 'Ollama check failed',
        detail: getErrorMessage(error),
        checkedAt,
      });
    }
  }

  function resetHostedBreaker() {
    resetHostedAssistantDiagnostics();
    setHostedResult(previous => ({
      ...previous,
      state: previous.state === 'error' ? 'warning' : previous.state,
      detail: `${previous.detail} Circuit breaker reset. You can retry the hosted checks immediately.`,
      checkedAt: new Date().toISOString(),
    }));
  }

  function resetOllamaBreaker() {
    ollamaBreaker.reset();
    setOllamaResult(previous => ({
      ...previous,
      state: previous.state === 'error' ? 'warning' : previous.state,
      detail: `${previous.detail} Circuit breaker reset. You can retry the Ollama check immediately.`,
      checkedAt: new Date().toISOString(),
    }));
  }

  async function copySnapshot() {
    const snapshot = buildSnapshotText({
      providerSetting,
      runtimeStatus,
      runtimeCheckedAt,
      runtimeError,
      supabaseReady,
      authenticated,
      currentUserId,
      sessionSnapshot,
      hostedResult,
      smokeResult,
      ollamaResult,
      ollamaEndpoint,
      ollamaModel,
    });

    try {
      await navigator.clipboard.writeText(snapshot);
      setCopyState('success');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  const runtimeState = runtimeError
    ? 'error'
    : runtimeStatus ? mapRuntimeState(runtimeStatus.state) : 'idle';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f5f7ff', marginBottom: 6 }}>AI Assistant Diagnostics</div>
            <div style={{ fontSize: 13, color: '#8b8fa3', maxWidth: 780 }}>
              Use these checks when Lina says hosted AI is unavailable. This panel shows the selected provider, runtime decision,
              Supabase sign-in state, hosted health checks, Ollama connectivity, and the exact failure text returned by the app.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={copySnapshot}>
              {copyState === 'success' ? 'Copied Snapshot' : copyState === 'error' ? 'Copy Failed' : 'Copy Snapshot'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void refreshRuntime()} disabled={refreshingRuntime}>
              {refreshingRuntime ? 'Refreshing...' : 'Refresh Runtime'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <MetaCard label="Build Mode" value={import.meta.env.MODE || 'unknown'} />
          <MetaCard label="Origin" value={window.location.origin} />
          <MetaCard label="Configured Mode" value={providerSetting.toUpperCase()} />
          <MetaCard label="Hosted Function" value={HOSTED_ASSISTANT_FUNCTION} />
          <MetaCard label="Hosted Model" value={HOSTED_ASSISTANT_MODEL} />
          <MetaCard label="Ollama Endpoint" value={ollamaEndpoint} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <StatusCard
          title="Runtime Status"
          state={runtimeState}
          headline={runtimeError ? 'Runtime status check failed' : runtimeStatus?.headline || 'No runtime check yet'}
          detail={runtimeError || runtimeStatus?.detail || 'Refresh runtime to see which provider Lina will choose right now.'}
          checkedAt={runtimeCheckedAt}
          actions={(
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => void refreshRuntime()} disabled={refreshingRuntime}>
                {refreshingRuntime ? 'Refreshing...' : 'Refresh Runtime'}
              </button>
            </>
          )}
        >
          <DataRow label="Configured mode" value={providerSetting} />
          <DataRow label="Resolved provider" value={runtimeStatus?.activeProvider || 'none'} />
          <DataRow label="Runtime state" value={runtimeStatus?.state || (runtimeError ? 'error' : 'not checked')} />
          <DataRow label="Recommended next step" value={getRuntimeSuggestion(runtimeStatus, runtimeError)} />
        </StatusCard>

        <StatusCard
          title="Supabase Session"
          state={supabaseReady ? authenticated ? 'success' : 'warning' : 'warning'}
          headline={supabaseReady
            ? authenticated
              ? 'Supabase ready and signed in'
              : hostedDiagnostics.localProjectAccessAvailable
                ? 'Supabase ready with local hosted access'
                : 'Supabase ready but not signed in'
            : 'Supabase not configured'}
          detail={supabaseReady
            ? authenticated
              ? 'Hosted GPT-5.4-mini can use the current HELM session.'
              : hostedDiagnostics.localProjectAccessAvailable
                ? 'Localhost can use the configured project access to test the hosted GPT-5.4-mini assistant without signing in.'
                : 'The browser build can reach Supabase, but hosted AI still needs a signed-in Google session.'
            : 'This build does not have Supabase configuration available, so hosted AI cannot run.'}
          checkedAt={runtimeCheckedAt}
        >
          <DataRow label="Supabase configured" value={formatBoolean(supabaseReady)} />
          <DataRow label="Authenticated" value={formatBoolean(authenticated)} />
          <DataRow label="User ID" value={currentUserId || 'none'} />
          <DataRow label="Email" value={sessionSnapshot?.email || 'none'} />
          <DataRow label="Provider" value={sessionSnapshot?.provider || 'none'} />
          <DataRow label="Session expires" value={formatExpiry(sessionSnapshot?.expiresAt)} />
          <DataRow label="Access token present" value={formatBoolean(Boolean(sessionSnapshot?.accessTokenPresent))} />
          <DataRow label="Local project access" value={formatBoolean(hostedDiagnostics.localProjectAccessAvailable)} />
          <DataRow label="Provider token present" value={formatBoolean(Boolean(sessionSnapshot?.providerToken))} />
          <DataRow label="Refresh token present" value={formatBoolean(Boolean(sessionSnapshot?.providerRefreshToken))} />
        </StatusCard>

        <StatusCard
          title="Hosted Assistant"
          state={hostedResult.state}
          headline={hostedResult.headline}
          detail={hostedResult.detail}
          checkedAt={hostedResult.checkedAt}
          actions={(
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => void runHostedCheck()} disabled={hostedResult.state === 'running'}>
                {hostedResult.state === 'running' ? 'Testing...' : 'Test Hosted AI'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => void runHostedSmokeTest()} disabled={smokeResult.state === 'running'}>
                {smokeResult.state === 'running' ? 'Running...' : 'Run Hosted Smoke Test'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={resetHostedBreaker}>
                Reset Hosted Breaker
              </button>
            </>
          )}
        >
          <DataRow label="Function" value={HOSTED_ASSISTANT_FUNCTION} />
          <DataRow label="Model" value={HOSTED_ASSISTANT_MODEL} />
          <DataRow label="Last access mode" value={hostedAccessMode} />
          <DataRow label="Circuit allowing requests" value={formatBoolean(hostedDiagnostics.circuitAllowingRequests)} />
          <DataRow label="Last health result" value={hostedResult.headline} />
          <DataRow label="Last real failure source" value={formatHostedFailureSource(hostedDiagnostics.lastFailureSource)} />
          <DataRow label="Last real failure" value={hostedDiagnostics.lastFailureMessage || 'none'} />
          <DataRow label="Last failure at" value={formatCheckedAt(hostedDiagnostics.lastFailureAt)} />
          {hostedResult.payload && <PayloadBlock label="Hosted payload">{hostedResult.payload}</PayloadBlock>}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e2030' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#cfd3e6', marginBottom: 6 }}>Hosted smoke test</div>
            <StatusBadge state={smokeResult.state}>{smokeResult.headline}</StatusBadge>
            <div style={{ fontSize: 12, color: '#9ea4c5', marginTop: 8 }}>{smokeResult.detail}</div>
            <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 6 }}>
              Last checked: {formatCheckedAt(smokeResult.checkedAt)}
            </div>
            {smokeResult.payload && <PayloadBlock label="Hosted smoke reply">{smokeResult.payload}</PayloadBlock>}
          </div>
        </StatusCard>

        <StatusCard
          title="Local Ollama"
          state={ollamaResult.state}
          headline={ollamaResult.headline}
          detail={ollamaResult.detail}
          checkedAt={ollamaResult.checkedAt}
          actions={(
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => void runOllamaCheck()} disabled={ollamaResult.state === 'running'}>
                {ollamaResult.state === 'running' ? 'Testing...' : 'Test Ollama'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={resetOllamaBreaker}>
                Reset Ollama Breaker
              </button>
            </>
          )}
        >
          <DataRow label="Endpoint" value={ollamaEndpoint} />
          <DataRow label="Selected model" value={ollamaModel} />
          <DataRow label="Circuit allowing requests" value={formatBoolean(ollamaBreaker.isAvailable)} />
          <DataRow label="Last Ollama result" value={ollamaResult.headline} />
          {ollamaResult.payload && <PayloadBlock label="Available models">{ollamaResult.payload}</PayloadBlock>}
        </StatusCard>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 12,
      border: '1px solid #1e2030',
      background: 'rgba(10, 12, 18, 0.45)',
    }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b6f85', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#f5f7ff', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function StatusCard(
  {
    title,
    state,
    headline,
    detail,
    checkedAt,
    actions,
    children,
  }: {
    title: string;
    state: DiagnosticState;
    headline: string;
    detail: string;
    checkedAt: string | null;
    actions?: ReactNode;
    children?: ReactNode;
  },
) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>{title}</div>
          <StatusBadge state={state}>{headline}</StatusBadge>
          <div style={{ fontSize: 13, color: '#9ea4c5', marginTop: 10 }}>{detail}</div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
            Last checked: {formatCheckedAt(checkedAt)}
          </div>
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {actions}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ state, children }: { state: DiagnosticState; children: ReactNode }) {
  const colors = {
    idle: { border: '#2f344f', background: 'rgba(47, 52, 79, 0.28)', text: '#cfd3e6' },
    running: { border: '#c18a24', background: 'rgba(193, 138, 36, 0.18)', text: '#ffd27a' },
    success: { border: '#1f8f5f', background: 'rgba(31, 143, 95, 0.18)', text: '#79e2b2' },
    warning: { border: '#9b6a21', background: 'rgba(155, 106, 33, 0.18)', text: '#ffcc80' },
    error: { border: '#a84747', background: 'rgba(168, 71, 71, 0.18)', text: '#ffadad' },
  } as const;

  const tone = colors[state];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      borderRadius: 999,
      border: `1px solid ${tone.border}`,
      background: tone.background,
      color: tone.text,
      fontSize: 12,
      fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, fontSize: 12 }}>
      <div style={{ color: '#6b6f85' }}>{label}</div>
      <div style={{ color: '#f5f7ff', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function PayloadBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6b6f85', marginBottom: 6 }}>
        {label}
      </div>
      <pre style={{
        margin: 0,
        padding: 12,
        borderRadius: 12,
        background: '#0a0c12',
        border: '1px solid #1e2030',
        color: '#dfe3f5',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {children}
      </pre>
    </div>
  );
}

function mapRuntimeState(state: AssistantRuntimeStatus['state']): DiagnosticState {
  switch (state) {
    case 'ready':
      return 'success';
    case 'checking':
      return 'running';
    case 'sign_in_required':
    case 'not_configured':
      return 'warning';
    case 'offline':
    default:
      return 'error';
  }
}

function mapHostedStatus(status: HostedAssistantConnectionStatus, checkedAt: string): DiagnosticResult {
  switch (status.status) {
    case 'available':
      return {
        state: 'success',
        headline: 'Hosted assistant reachable',
        detail: status.accessMode === 'local_project_key'
          ? 'The Supabase Edge Function responded successfully using local project access on localhost.'
          : 'The Supabase Edge Function responded successfully for the current signed-in session.',
        checkedAt,
      };
    case 'sign_in_required':
      return {
        state: 'warning',
        headline: 'Hosted assistant needs sign-in',
        detail: status.message || 'Sign in with Google to use the hosted assistant.',
        checkedAt,
      };
    case 'not_configured':
      return {
        state: 'warning',
        headline: 'Hosted assistant not configured',
        detail: status.message || 'Supabase is not configured in this build.',
        checkedAt,
      };
    case 'unavailable':
    default:
      return {
        state: 'error',
        headline: 'Hosted assistant unavailable',
        detail: status.message || 'HELM could not reach the hosted assistant.',
        checkedAt,
      };
  }
}

function formatCheckedAt(value: string | null): string {
  if (!value) return 'not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function formatExpiry(value: number | null | undefined): string {
  if (!value) return 'none';
  const epochMs = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatHostedFailureSource(value: 'health' | 'chat' | null): string {
  if (value === 'health') return 'health check';
  if (value === 'chat') return 'chat request';
  return 'none';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRuntimeSuggestion(status: AssistantRuntimeStatus | null, runtimeError: string | null): string {
  if (runtimeError) {
    return 'Open the hosted and Ollama checks below to capture the exact failure.';
  }

  switch (status?.state) {
    case 'ready':
      return 'Provider is ready. If Lina still falls back, run the hosted smoke test below.';
    case 'sign_in_required':
      return 'Sign in with Google from the sidebar, then refresh this panel.';
    case 'not_configured':
      return 'Check the current build config and ensure Supabase values are present.';
    case 'offline':
      return 'Run the hosted and Ollama checks below to see which provider is failing.';
    case 'checking':
      return 'Wait for the current runtime probe to finish.';
    default:
      return 'Refresh runtime to probe the current provider decision.';
  }
}

function buildSnapshotText(
  {
    providerSetting,
    runtimeStatus,
    runtimeCheckedAt,
    runtimeError,
    supabaseReady,
    authenticated,
    currentUserId,
    sessionSnapshot,
    hostedResult,
    smokeResult,
    ollamaResult,
    ollamaEndpoint,
    ollamaModel,
  }: {
    providerSetting: string;
    runtimeStatus: AssistantRuntimeStatus | null;
    runtimeCheckedAt: string | null;
    runtimeError: string | null;
    supabaseReady: boolean;
    authenticated: boolean;
    currentUserId: string | null;
    sessionSnapshot: ReturnType<typeof getAuthSessionSnapshot>;
    hostedResult: DiagnosticResult;
    smokeResult: DiagnosticResult;
    ollamaResult: DiagnosticResult;
    ollamaEndpoint: string;
    ollamaModel: string;
  },
): string {
  const hostedDiagnostics = getHostedAssistantDiagnostics();

  return [
    'HELM AI Diagnostics Snapshot',
    `Captured: ${new Date().toLocaleString()}`,
    `Origin: ${window.location.origin}`,
    `Build mode: ${import.meta.env.MODE || 'unknown'}`,
    '',
    '[Runtime]',
    `Configured mode: ${providerSetting}`,
    `Resolved provider: ${runtimeStatus?.activeProvider || 'none'}`,
    `State: ${runtimeStatus?.state || (runtimeError ? 'error' : 'not checked')}`,
    `Headline: ${runtimeError ? 'Runtime status check failed' : runtimeStatus?.headline || 'No runtime check yet'}`,
    `Detail: ${runtimeError || runtimeStatus?.detail || 'No runtime detail available.'}`,
    `Checked at: ${formatCheckedAt(runtimeCheckedAt)}`,
    '',
    '[Supabase Session]',
    `Configured: ${formatBoolean(supabaseReady)}`,
    `Authenticated: ${formatBoolean(authenticated)}`,
    `User ID: ${currentUserId || 'none'}`,
    `Email: ${sessionSnapshot?.email || 'none'}`,
    `Provider: ${sessionSnapshot?.provider || 'none'}`,
    `Session expires: ${formatExpiry(sessionSnapshot?.expiresAt)}`,
    `Access token present: ${formatBoolean(Boolean(sessionSnapshot?.accessTokenPresent))}`,
    `Local project access: ${formatBoolean(hostedDiagnostics.localProjectAccessAvailable)}`,
    '',
    '[Hosted Assistant]',
    `Function: ${HOSTED_ASSISTANT_FUNCTION}`,
    `Model: ${HOSTED_ASSISTANT_MODEL}`,
    `Last access mode: ${formatHostedAssistantAccessMode(hostedDiagnostics.lastAccessMode)}`,
    `Circuit allowing requests: ${formatBoolean(hostedDiagnostics.circuitAllowingRequests)}`,
    `Last failure source: ${formatHostedFailureSource(hostedDiagnostics.lastFailureSource)}`,
    `Last failure message: ${hostedDiagnostics.lastFailureMessage || 'none'}`,
    `Last failure at: ${formatCheckedAt(hostedDiagnostics.lastFailureAt)}`,
    `Health headline: ${hostedResult.headline}`,
    `Health detail: ${hostedResult.detail}`,
    `Health checked at: ${formatCheckedAt(hostedResult.checkedAt)}`,
    hostedResult.payload ? `Health payload: ${hostedResult.payload}` : null,
    `Smoke headline: ${smokeResult.headline}`,
    `Smoke detail: ${smokeResult.detail}`,
    `Smoke checked at: ${formatCheckedAt(smokeResult.checkedAt)}`,
    smokeResult.payload ? `Smoke payload: ${smokeResult.payload}` : null,
    '',
    '[Ollama]',
    `Endpoint: ${ollamaEndpoint}`,
    `Selected model: ${ollamaModel}`,
    `Circuit allowing requests: ${formatBoolean(ollamaBreaker.isAvailable)}`,
    `Headline: ${ollamaResult.headline}`,
    `Detail: ${ollamaResult.detail}`,
    `Checked at: ${formatCheckedAt(ollamaResult.checkedAt)}`,
    ollamaResult.payload ? `Models: ${ollamaResult.payload}` : null,
  ].filter(Boolean).join('\n');
}
