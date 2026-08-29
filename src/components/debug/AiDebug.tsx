import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  HOSTED_ASSISTANT_BILLING_FUNCTION,
  HOSTED_ASSISTANT_FUNCTION,
  OLLAMA_ENDPOINT,
} from '../../config';
import { useSettingsContext } from "../../store/contexts/SettingsContext";
import { getAllCapabilityDefinitions } from '../../assistant/capabilities';
import {
  getAssistantProviderSetting,
  getAssistantRuntimeStatus,
  type AssistantRuntimeStatus,
} from '../../services/assistantAvailability';
import {
  getHostedAssistantModelSetting,
} from '../../services/assistantModels';
import {
  getAssistantDebugTrace,
  subscribeAssistantDebugTrace,
  type AssistantDebugTrace,
} from '../../services/assistantDebug';
import {
  getDashboardFocusDiagnostics,
  subscribeDashboardFocusDiagnostics,
  type DashboardFocusDiagnostics,
} from '../../services/dashboardFocusDiagnostics';
import {
  formatAssistantTokenCount,
  formatCurrencyAmount,
  formatUsdEstimate,
  OPENAI_USAGE_ESTIMATE_LABEL,
} from '../../services/assistantBilling';
import {
  fetchHostedAssistantProjectBilling,
  type HostedAssistantProjectBillingSummary,
} from '../../services/hostedAssistantBillingApi';
import {
  chatWithHostedAssistant,
  getHostedAssistantDiagnostics,
  resetHostedAssistantDiagnostics,
  testHostedAssistantConnection,
  type HostedAssistantConnectionStatus,
} from '../../services/hostedAssistantApi';
import { formatHostedAssistantAccessMode, isLocalhostRuntime } from '../../services/hostedAssistantAccess';
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

const DEFAULT_OPENAI_BILLING_RESULT: DiagnosticResult = {
  state: 'idle',
  headline: 'OpenAI billing not checked yet',
  detail: 'Load the OpenAI billing summary to see factual daily project costs and usage from the configured hosted-assistant project.',
  checkedAt: null,
};

const SMOKE_TEST_MESSAGES = [
  {
    role: 'system' as const,
    content: 'You are a Sabah One hosted assistant smoke test. Always return JSON with reply set to READY.',
  },
  {
    role: 'user' as const,
    content: 'Return JSON with reply set to READY.',
  },
  {
    role: 'assistant' as const,
    content: '{"reply":"READY"}',
  },
  {
    role: 'user' as const,
    content: 'Good. Now return JSON with reply set to READY again.',
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
  const settings = useSettingsContext();
  const [runtimeStatus, setRuntimeStatus] = useState<AssistantRuntimeStatus | null>(null);
  const [runtimeCheckedAt, setRuntimeCheckedAt] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [refreshingRuntime, setRefreshingRuntime] = useState(false);
  const [hostedResult, setHostedResult] = useState<DiagnosticResult>(DEFAULT_HOSTED_RESULT);
  const [smokeResult, setSmokeResult] = useState<DiagnosticResult>(DEFAULT_HOSTED_SMOKE_RESULT);
  const [ollamaResult, setOllamaResult] = useState<DiagnosticResult>(DEFAULT_OLLAMA_RESULT);
  const [openAIBillingResult, setOpenAIBillingResult] = useState<DiagnosticResult>(DEFAULT_OPENAI_BILLING_RESULT);
  const [openAIBillingSummary, setOpenAIBillingSummary] = useState<HostedAssistantProjectBillingSummary | null>(null);
  const [copyState, setCopyState] = useState<DiagnosticState>('idle');
  const [assistantTrace, setAssistantTrace] = useState<AssistantDebugTrace | null>(() => getAssistantDebugTrace());
  const [dashboardFocusTrace, setDashboardFocusTrace] = useState<DashboardFocusDiagnostics | null>(() => getDashboardFocusDiagnostics());

  const providerSetting = getAssistantProviderSetting(settings.settings);
  const selectedHostedModel = getHostedAssistantModelSetting(settings.settings);
  const ollamaEndpoint = settings.settings.ollamaEndpoint || OLLAMA_ENDPOINT;
  const ollamaModel = settings.settings.ollamaModel || 'qwen3';
  const sessionSnapshot = getAuthSessionSnapshot();
  const supabaseReady = isSupabaseReady();
  const authenticated = isAuthenticated();
  const currentUserId = getCurrentUserId();
  const hostedDiagnostics = getHostedAssistantDiagnostics();
  const hostedAccessMode = formatHostedAssistantAccessMode(hostedDiagnostics.lastAccessMode);
  const hostedModelLabel = hostedDiagnostics.lastModel || selectedHostedModel;
  const localhostRuntime = isLocalhostRuntime();

  const refreshRuntime = useCallback(async () => {
    setRefreshingRuntime(true);
    setRuntimeError(null);
    try {
      const nextStatus = await getAssistantRuntimeStatus(settings.settings);
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
  }, [settings.settings]);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  useEffect(() => subscribeAssistantDebugTrace(setAssistantTrace), []);
  useEffect(() => subscribeDashboardFocusDiagnostics(setDashboardFocusTrace), []);

  const refreshOpenAIBilling = useCallback(async () => {
    setOpenAIBillingResult({
      state: 'running',
      headline: 'Loading OpenAI billing...',
      detail: 'Fetching the last 7 UTC billing buckets from OpenAI for the configured hosted-assistant project.',
      checkedAt: null,
    });

    const checkedAt = new Date().toISOString();

    try {
      const summary = await fetchHostedAssistantProjectBilling();
      setOpenAIBillingSummary(summary);
      setOpenAIBillingResult({
        state: 'success',
        headline: 'OpenAI billing loaded',
        detail: `Showing factual daily project costs and usage from OpenAI for project ${summary.projectId}.`,
        checkedAt,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setOpenAIBillingSummary(null);
      setOpenAIBillingResult({
        state: message.includes('unavailable in this build') || message.includes('not configured')
          ? 'warning'
          : 'error',
        headline: 'OpenAI project billing is unavailable in this build',
        detail: message,
        checkedAt,
      });
    }
  }, []);

  useEffect(() => {
    void refreshOpenAIBilling();
  }, [refreshOpenAIBilling]);

  async function runHostedCheck() {
    setHostedResult({
      state: 'running',
      headline: 'Testing hosted assistant...',
      detail: 'Checking the Supabase Edge Function health path with your current session.',
      checkedAt: null,
    });

    const checkedAt = new Date().toISOString();

    try {
      const status = await testHostedAssistantConnection({ model: selectedHostedModel });
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
      const text = await chatWithHostedAssistant(SMOKE_TEST_MESSAGES, SMOKE_TEST_FORMAT, {
        model: selectedHostedModel,
      });
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
          detail: `Sabah One could not reach ${ollamaEndpoint}. Start Ollama locally or update the configured endpoint.`,
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
      selectedHostedModel,
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
  const actions = getAllCapabilityDefinitions();

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
          <MetaCard label="Billing Function" value={HOSTED_ASSISTANT_BILLING_FUNCTION} />
          <MetaCard label="Hosted Model" value={hostedModelLabel} />
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
              : hostedDiagnostics.projectAccessAvailable
                ? 'Supabase ready with hosted project access'
                : 'Supabase ready but hosted project access is missing'
            : 'Supabase not configured'}
          detail={supabaseReady
            ? hostedDiagnostics.projectAccessAvailable
              ? `Hosted ${hostedModelLabel} can use the configured project access in this build${localhostRuntime ? ' on localhost' : ''}. Supabase sign-in remains for sync and user data.`
              : 'This build can reach Supabase, but the hosted AI project access key is missing.'
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
          <DataRow label="Project access available" value={formatBoolean(hostedDiagnostics.projectAccessAvailable)} />
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
          <DataRow label="Model" value={hostedModelLabel} />
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

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>OpenAI Billing</div>
            <StatusBadge state={openAIBillingResult.state}>{openAIBillingResult.headline}</StatusBadge>
            <div style={{ fontSize: 13, color: '#9ea4c5', marginTop: 10, maxWidth: 860 }}>
              Latest-turn figures are estimated from OpenAI usage on the assistant trace. Daily project costs and usage come from OpenAI organization billing APIs for the configured hosted-assistant project and use UTC bucket dates.
            </div>
            <div style={{ fontSize: 12, color: '#9ea4c5', marginTop: 8 }}>
              {openAIBillingResult.detail}
            </div>
            <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
              Last checked: {formatCheckedAt(openAIBillingResult.checkedAt)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => void refreshOpenAIBilling()} disabled={openAIBillingResult.state === 'running'}>
              {openAIBillingResult.state === 'running' ? 'Loading...' : 'Refresh OpenAI Billing'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <div style={{ padding: 14, borderRadius: 12, border: '1px solid #1e2030', background: 'rgba(10, 12, 18, 0.45)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f5f7ff', marginBottom: 10 }}>Latest Assistant Turn Estimate</div>
            {!assistantTrace?.assistantBilling ? (
              <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                No assistant billing metadata has been recorded yet.
              </div>
            ) : assistantTrace.assistantBilling.provider !== 'openai' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <DataRow label="Latest source" value={formatAssistantBillingSourceDetail(assistantTrace.assistantBilling.provider, assistantTrace.assistantBilling.model)} />
                <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                  The latest assistant turn did not include hosted OpenAI usage, so there is no OpenAI estimate to show here.
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <DataRow label="Estimate label" value={assistantTrace.assistantBilling.estimateLabel || OPENAI_USAGE_ESTIMATE_LABEL} />
                <DataRow label="Estimated total" value={formatUsdEstimate(assistantTrace.assistantBilling.estimatedUsd ?? 0)} />
                <DataRow label="Request count" value={String(assistantTrace.assistantBilling.requestCount)} />
                <DataRow label="Model" value={assistantTrace.assistantBilling.model || 'mixed'} />
                <DataRow label="Tokens" value={formatAssistantBillingTokens(assistantTrace.assistantBilling)} />
                {assistantTrace.assistantBilling.requests.map(request => (
                  <div
                    key={`${request.kind}:${request.responseId || request.model}`}
                    style={{
                      marginTop: 4,
                      padding: 12,
                      borderRadius: 10,
                      border: '1px solid #1e2030',
                      background: '#0a0c12',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f5f7ff', textTransform: 'capitalize' }}>
                        {request.kind}
                      </div>
                      <div style={{ fontSize: 12, color: '#79e2b2', fontWeight: 600 }}>
                        {formatUsdEstimate(request.estimatedUsd)}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <DataRow label="Model" value={request.model} />
                      <DataRow label="Service tier" value={request.serviceTier || 'default'} />
                      <DataRow label="Response ID" value={request.responseId || 'none'} />
                      <DataRow label="Tokens" value={formatAssistantRequestTokens(request)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: 14, borderRadius: 12, border: '1px solid #1e2030', background: 'rgba(10, 12, 18, 0.45)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f5f7ff', marginBottom: 10 }}>Last 7 UTC Days Of Factual Project Costs</div>
            {openAIBillingSummary ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <DataRow label="Project ID" value={openAIBillingSummary.projectId} />
                <DataRow label="Fetched At" value={formatCheckedAt(openAIBillingSummary.fetchedAt)} />
                {openAIBillingSummary.costs.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                    OpenAI returned no project cost buckets for the last 7 UTC days.
                  </div>
                ) : (
                  openAIBillingSummary.costs.map(bucket => (
                    <DataRow
                      key={`cost-${bucket.startTime}`}
                      label={formatUtcBucketLabel(bucket.startTime)}
                      value={formatCurrencyAmount(bucket.amount.value, bucket.amount.currency)}
                    />
                  ))
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                OpenAI project billing is unavailable in this build.
              </div>
            )}
          </div>

          <div style={{ padding: 14, borderRadius: 12, border: '1px solid #1e2030', background: 'rgba(10, 12, 18, 0.45)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f5f7ff', marginBottom: 10 }}>Last 7 UTC Days Of Factual Usage</div>
            {openAIBillingSummary ? (
              openAIBillingSummary.usage.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                  OpenAI returned no completion-usage buckets for the last 7 UTC days.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {openAIBillingSummary.usage.map(bucket => (
                    <div
                      key={`usage-${bucket.startTime}`}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: '1px solid #1e2030',
                        background: '#0a0c12',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>
                        {formatUtcBucketLabel(bucket.startTime)}
                      </div>
                      {bucket.results.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                          No usage rows returned for this UTC bucket.
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {bucket.results.map(result => (
                            <DataRow
                              key={`${bucket.startTime}:${result.model}:${result.serviceTier}`}
                              label={`${result.model} · ${result.serviceTier || 'default'}`}
                              value={formatOpenAIUsageSummary(result)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div style={{ fontSize: 12, color: '#9ea4c5' }}>
                OpenAI project billing is unavailable in this build.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>Assistant Actions</div>
            <div style={{ fontSize: 13, color: '#9ea4c5', maxWidth: 860 }}>
              This registry is the source of truth for what Lina is allowed to claim and execute. Add or change actions here instead of scattering one-off parser rules.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge state="success">{actions.filter(action => action.status === 'live').length} live</StatusBadge>
            <StatusBadge state="idle">{actions.length} total</StatusBadge>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {actions.map(action => (
            <div
              key={action.id}
              style={{
                padding: 14,
                borderRadius: 12,
                border: '1px solid #1e2030',
                background: 'rgba(10, 12, 18, 0.45)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f5f7ff' }}>{action.id}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <StatusBadge state={mapActionStatus(action.status)}>{action.status}</StatusBadge>
                  <StatusBadge state="idle">{action.domain}</StatusBadge>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#9ea4c5', marginTop: 8 }}>{action.debugSummary}</div>
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                <DataRow label="Confirmation" value={action.confirmationRule} />
                <DataRow label="Executor" value={action.executorKey} />
                <DataRow label="Args" value={formatActionArgs(action)} />
                <DataRow label="Examples" value={action.examples.join(' | ')} />
                <DataRow label="Aliases" value={action.aliases.join(' | ')} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>Dashboard Focus Trace</div>
        <div style={{ fontSize: 13, color: '#9ea4c5' }}>
          This shows the latest dashboard recommendation run, including whether GPT selected it or Sabah One fell back to the local ranker.
        </div>

        {!dashboardFocusTrace ? (
          <div style={{ marginTop: 14, color: '#6b6f85', fontSize: 13 }}>
            No dashboard focus trace captured yet.
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <DataRow label="Recorded" value={formatCheckedAt(dashboardFocusTrace.recordedAt)} />
            <DataRow label="Status" value={dashboardFocusTrace.status} />
            <DataRow label="Source" value={dashboardFocusTrace.source} />
            <DataRow label="Provider mode" value={dashboardFocusTrace.providerMode} />
            <DataRow label="Hosted cadence" value="once per local day" />
            <DataRow label="Hosted review attempted today" value={formatBoolean(dashboardFocusTrace.hostedReviewAttemptedToday)} />
            <DataRow label="Model" value={dashboardFocusTrace.model || 'none'} />
            <DataRow label="Selected candidate" value={dashboardFocusTrace.selectedCandidateId || 'none'} />
            <DataRow label="Candidate count" value={String(dashboardFocusTrace.candidateCount)} />
            <DataRow label="Queue" value={dashboardFocusTrace.queueCandidateIds.join(' | ') || 'none'} />
            <DataRow label="Fallback reason" value={dashboardFocusTrace.fallbackReason || 'none'} />
            <DataRow label="Error" value={dashboardFocusTrace.errorMessage || 'none'} />
            <DataRow label="Latency" value={dashboardFocusTrace.latencyMs ? `${dashboardFocusTrace.latencyMs} ms` : 'n/a'} />
            <DataRow
              label="Snapshot stats"
              value={`Overdue ${dashboardFocusTrace.stats.overdueCount} · Due today ${dashboardFocusTrace.stats.dueTodayCount} · Prayers ${dashboardFocusTrace.stats.prayersLeft} · Routines ${dashboardFocusTrace.stats.routinesLeft}`}
            />
            {dashboardFocusTrace.recommendation && (
              <PayloadBlock label="Recommendation JSON">
                {JSON.stringify(dashboardFocusTrace.recommendation, null, 2)}
              </PayloadBlock>
            )}
            {dashboardFocusTrace.rawModelResponse && (
              <PayloadBlock label="Raw Focus Model Response">
                {dashboardFocusTrace.rawModelResponse}
              </PayloadBlock>
            )}
            <PayloadBlock label="Top Candidates">
              {JSON.stringify(dashboardFocusTrace.topCandidates, null, 2)}
            </PayloadBlock>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5f7ff', marginBottom: 8 }}>Latest Assistant Trace</div>
        <div style={{ fontSize: 13, color: '#9ea4c5' }}>
          Run a chat or voice command and this panel will show the last model turn, tool calls, validator verdict, execution facts, billing metadata, and final narrated reply that Lina produced.
        </div>

        {!assistantTrace ? (
          <div style={{ marginTop: 14, color: '#6b6f85', fontSize: 13 }}>
            No assistant trace captured yet.
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            <DataRow label="Recorded" value={formatCheckedAt(assistantTrace.recordedAt)} />
            <DataRow label="Source" value={assistantTrace.source} />
            <DataRow label="Transcript" value={assistantTrace.transcript} />
            <DataRow label="Effective" value={assistantTrace.effectiveTranscript} />
            <DataRow label="Assistant Message" value={assistantTrace.assistantMessage || 'none'} />
            <DataRow label="Billing Source" value={assistantTrace.assistantBilling ? formatAssistantBillingSourceDetail(assistantTrace.assistantBilling.provider, assistantTrace.assistantBilling.model) : 'none'} />
            <DataRow label="Billing Summary" value={assistantTrace.assistantBilling ? formatLatestTurnBillingSummary(assistantTrace.assistantBilling) : 'none'} />
            <DataRow label="Planning Source" value={assistantTrace.planningSource || 'unknown'} />
            <DataRow label="Planning Status" value={assistantTrace.planningStatus || 'unknown'} />
            <DataRow label="Planning Model" value={assistantTrace.planningModel || 'none'} />
            <DataRow
              label="Validator"
              value={assistantTrace.plannerValidation
                ? assistantTrace.plannerValidation.status === 'accepted'
                  ? 'accepted'
                  : assistantTrace.plannerValidation.status === 'rejected'
                    ? `rejected: ${assistantTrace.plannerValidation.reason || 'no reason recorded'}`
                    : 'skipped'
                : 'not recorded'}
            />
            <DataRow label="Plan Mode" value={assistantTrace.plan.mode} />
            <DataRow label="Degraded" value={assistantTrace.degradedReason || 'none'} />
            <DataRow
              label="Execution"
              value={assistantTrace.execution
                ? assistantTrace.execution.toolResults.map(result => `${result.capability}: ${result.status}`).join(' | ')
                : 'none'}
            />
            {assistantTrace.planningBundle && (
              <PayloadBlock label="Planning Bundle">
                {JSON.stringify(assistantTrace.planningBundle, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.rawPlannerResponse && (
              <PayloadBlock label="Raw Planner Response">
                {assistantTrace.rawPlannerResponse}
              </PayloadBlock>
            )}
            {assistantTrace.rawNarrationResponse && (
              <PayloadBlock label="Raw Narration Response">
                {assistantTrace.rawNarrationResponse}
              </PayloadBlock>
            )}
            {assistantTrace.assistantBilling && (
              <PayloadBlock label="Assistant Billing">
                {JSON.stringify(assistantTrace.assistantBilling, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.modelTurn && (
              <PayloadBlock label="Model Turn">
                {JSON.stringify(assistantTrace.modelTurn, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.toolCalls && (
              <PayloadBlock label="Tool Calls">
                {JSON.stringify(assistantTrace.toolCalls, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.pendingConfirmation && (
              <PayloadBlock label="Pending Confirmation">
                {JSON.stringify(assistantTrace.pendingConfirmation, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.parsedPlan && (
              <PayloadBlock label="Parsed Plan">
                {JSON.stringify(assistantTrace.parsedPlan, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.validatedPlan && (
              <PayloadBlock label="Validated Plan">
                {JSON.stringify(assistantTrace.validatedPlan, null, 2)}
              </PayloadBlock>
            )}
            {assistantTrace.execution?.navigationRequests && (
              <PayloadBlock label="Navigation Payload">
                {JSON.stringify(assistantTrace.execution.navigationRequests, null, 2)}
              </PayloadBlock>
            )}
            <PayloadBlock label="Plan JSON">{JSON.stringify(assistantTrace.plan, null, 2)}</PayloadBlock>
            {assistantTrace.execution && (
              <PayloadBlock label="Execution JSON">{JSON.stringify(assistantTrace.execution, null, 2)}</PayloadBlock>
            )}
          </div>
        )}
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
        detail: status.accessMode === 'project_key'
          ? 'The Supabase Edge Function responded successfully using the configured project access key.'
          : 'The Supabase Edge Function responded successfully.',
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
        detail: status.message || 'Sabah One could not reach the hosted assistant.',
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

function formatUtcBucketLabel(startTime: number): string {
  return `${new Date(startTime * 1000).toISOString().slice(0, 10)} UTC`;
}

function formatAssistantBillingTokens(
  billing: NonNullable<AssistantDebugTrace['assistantBilling']>,
): string {
  if (!billing.totals) return 'none recorded';
  return `${formatAssistantTokenCount(billing.totals.inputTokens)} input · ${formatAssistantTokenCount(billing.totals.cachedTokens)} cached · ${formatAssistantTokenCount(billing.totals.outputTokens)} output · ${formatAssistantTokenCount(billing.totals.totalTokens)} total`;
}

function formatAssistantRequestTokens(
  request: NonNullable<NonNullable<AssistantDebugTrace['assistantBilling']>['requests']>[number],
): string {
  return `${formatAssistantTokenCount(request.inputTokens)} input · ${formatAssistantTokenCount(request.cachedTokens)} cached · ${formatAssistantTokenCount(request.outputTokens)} output · ${formatAssistantTokenCount(request.reasoningTokens)} reasoning · ${formatAssistantTokenCount(request.totalTokens)} total`;
}

function formatAssistantBillingSourceDetail(provider: string, model?: string): string {
  return model ? `${provider} (${model})` : provider;
}

function formatLatestTurnBillingSummary(
  billing: NonNullable<AssistantDebugTrace['assistantBilling']>,
): string {
  if (billing.provider !== 'openai') {
    return `No hosted OpenAI estimate. Provider was ${formatAssistantBillingSourceDetail(billing.provider, billing.model)}.`;
  }

  return `${formatUsdEstimate(billing.estimatedUsd ?? 0)} across ${billing.requestCount} request${billing.requestCount === 1 ? '' : 's'} (${billing.estimateLabel || OPENAI_USAGE_ESTIMATE_LABEL}).`;
}

function formatOpenAIUsageSummary(
  result: HostedAssistantProjectBillingSummary['usage'][number]['results'][number],
): string {
  return `${formatAssistantTokenCount(result.totalRequests)} requests · ${formatAssistantTokenCount(result.inputTokens)} input · ${formatAssistantTokenCount(result.cachedTokens)} cached · ${formatAssistantTokenCount(result.outputTokens)} output`;
}

function mapActionStatus(status: 'live' | 'planned' | 'disabled'): DiagnosticState {
  switch (status) {
    case 'live':
      return 'success';
    case 'planned':
      return 'warning';
    case 'disabled':
    default:
      return 'idle';
  }
}

function formatActionArgs(action: ReturnType<typeof getAllCapabilityDefinitions>[number]): string {
  if (action.args.length === 0) return 'none';
  return action.args
    .map(arg => {
      const qualifier = arg.required ? 'required' : 'optional';
      const values = arg.values && arg.values.length > 0 ? ` (${arg.values.join(', ')})` : '';
      return `${arg.key}${values} [${arg.type}, ${qualifier}]`;
    })
    .join(' | ');
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
    selectedHostedModel,
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
    selectedHostedModel: string;
    ollamaResult: DiagnosticResult;
    ollamaEndpoint: string;
    ollamaModel: string;
  },
): string {
  const hostedDiagnostics = getHostedAssistantDiagnostics();

  return [
    'Sabah One AI Diagnostics Snapshot',
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
    `Project access available: ${formatBoolean(hostedDiagnostics.projectAccessAvailable)}`,
    '',
    '[Hosted Assistant]',
    `Function: ${HOSTED_ASSISTANT_FUNCTION}`,
    `Billing function: ${HOSTED_ASSISTANT_BILLING_FUNCTION}`,
    `Model: ${selectedHostedModel}`,
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
