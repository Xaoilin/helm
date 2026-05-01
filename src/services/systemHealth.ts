import type { SyncState } from '../hooks/useGoogleSync';
import type { PersistenceHealthSnapshot } from '../store/persistence';
import type { HostedAssistantConnectionStatus } from './hostedAssistantApi';
import type { CalendarAccount, Settings } from '../types/domain';

export type HealthTone = 'healthy' | 'syncing' | 'attention' | 'offline' | 'local' | 'checking';
export type HealthActionKind = 'refresh' | 'sign-in' | 'settings' | 'integrations' | 'calendar';
export type HealthItemId = 'local' | 'supabase' | 'calendar' | 'openai' | 'ollama' | 'voice';

export interface HealthAction {
  kind: HealthActionKind;
  label: string;
}

export interface HealthItem {
  id: HealthItemId;
  label: string;
  headline: string;
  detail: string;
  tone: HealthTone;
  action?: HealthAction;
  meta?: string;
}

export interface HealthSnapshot {
  generatedAt: string;
  summary: string;
  overallTone: HealthTone;
  attentionCount: number;
  items: HealthItem[];
}

export interface SystemHealthInput {
  appLoaded: boolean;
  persistence: PersistenceHealthSnapshot;
  supabase: {
    ready: boolean;
    authenticated: boolean;
    bootstrapped: boolean;
  };
  calendar: {
    accounts: CalendarAccount[];
    syncState: SyncState;
    lastSyncTime: string | null;
    syncError: string | null;
  };
  openAi: {
    status: HostedAssistantConnectionStatus | null;
    checking: boolean;
    checkedAt: string | null;
  };
  ollama: {
    connected: boolean | null;
    checking: boolean;
    endpoint: string;
    checkedAt: string | null;
  };
  voice: {
    settings: Pick<Settings, 'assistantEnabled' | 'wakeWordEnabled' | 'microphoneDeviceId' | 'deepgramApiKey'>;
    deepgramKeyPresent: boolean;
    browserSpeechAvailable: boolean;
  };
}

const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{24,}/g;

export function sanitizeHealthDetail(value: string | null | undefined): string {
  return (value || '').replace(TOKEN_LIKE_PATTERN, '[redacted]');
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function formatCheckedAt(checkedAt: string | null): string | undefined {
  if (!checkedAt) return undefined;
  try {
    return `Checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return undefined;
  }
}

function buildLocalItem(input: SystemHealthInput): HealthItem {
  const { appLoaded, persistence } = input;

  if (!appLoaded) {
    return {
      id: 'local',
      label: 'Local data',
      headline: 'Loading local data',
      detail: 'Lina is opening the local-first store.',
      tone: 'checking',
    };
  }

  if (persistence.mode === 'database') {
    const importCandidateCount = persistence.localImportCandidateCount || 0;
    if (importCandidateCount > 0) {
      return {
        id: 'local',
        label: 'Local data',
        headline: 'Local copies waiting',
        detail: `${plural(importCandidateCount, 'local copy', 'local copies')} can be imported or discarded in Settings.`,
        tone: 'attention',
        action: { kind: 'settings', label: 'Open Settings' },
      };
    }

    return {
      id: 'local',
      label: 'Local data',
      headline: 'Local data ignored',
      detail: 'Signed-in app data is read from Supabase, not this device cache.',
      tone: 'healthy',
    };
  }

  if (persistence.lastLocalWriteError) {
    return {
      id: 'local',
      label: 'Local data',
      headline: 'Local save needs attention',
      detail: sanitizeHealthDetail(persistence.lastLocalWriteError),
      tone: 'attention',
      action: { kind: 'settings', label: 'Open Settings' },
    };
  }

  if (persistence.lastLocalWriteAt) {
    return {
      id: 'local',
      label: 'Local data',
      headline: 'Local data saved',
      detail: 'Your latest app data is in the local cache.',
      tone: 'healthy',
      meta: formatCheckedAt(persistence.lastLocalWriteAt),
    };
  }

  return {
    id: 'local',
    label: 'Local data',
    headline: 'Local save pending',
    detail: 'No local write has completed in this session yet.',
    tone: 'attention',
    action: { kind: 'refresh', label: 'Refresh status' },
  };
}

function buildSupabaseItem(input: SystemHealthInput): HealthItem {
  const { persistence, supabase } = input;
  const queuedCount = persistence.supabaseQueue.queuedCount;
  const remoteReadFailedKeys = persistence.remoteReadFailedKeys || [];
  const readFailureCount = remoteReadFailedKeys.length;

  if (!supabase.ready) {
    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Local-only',
      detail: 'Supabase is not configured, so app data stays local on this device.',
      tone: 'local',
      action: { kind: 'settings', label: 'Open Settings' },
    };
  }

  if (!supabase.bootstrapped) {
    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Checking Supabase',
      detail: 'Lina is checking your sign-in session.',
      tone: 'checking',
    };
  }

  if (!supabase.authenticated) {
    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Local-only',
      detail: 'Sign in to sync this device with Supabase.',
      tone: 'local',
      action: { kind: 'sign-in', label: 'Sign in' },
    };
  }

  if (readFailureCount > 0 || persistence.lastRemoteReadError || persistence.lastRemoteWriteError) {
    const error = sanitizeHealthDetail(persistence.lastRemoteReadError || persistence.lastRemoteWriteError);
    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Database needs attention',
      detail: error || `${plural(readFailureCount, 'database read')} failed.`,
      tone: 'attention',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  if (queuedCount > 0) {
    const detailParts = [
      queuedCount > 0 ? plural(queuedCount, 'queued write') : null,
    ].filter(Boolean);
    const lastError = sanitizeHealthDetail(persistence.supabaseQueue.lastFlushError);

    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Syncing to Supabase',
      detail: lastError
        ? `Retrying after the last sync attempt failed: ${lastError}`
        : `${detailParts.join(' and ')} waiting to sync.`,
      tone: 'syncing',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  return {
    id: 'supabase',
    label: 'Supabase',
    headline: 'Database source of truth',
    detail: persistence.supabaseRealtime?.state === 'subscribed'
      ? 'Signed-in app data is saved in Supabase and realtime refresh is connected.'
      : 'Signed-in app data is saved in Supabase. Realtime refresh is best-effort.',
    tone: 'healthy',
    meta: formatCheckedAt(persistence.lastRemoteWriteAt || persistence.supabaseQueue.lastFlushSuccessAt),
  };
}

function buildCalendarItem(input: SystemHealthInput): HealthItem {
  const { calendar } = input;
  const googleAccounts = calendar.accounts.filter(account => account.provider === 'google');

  if (googleAccounts.length === 0) {
    return {
      id: 'calendar',
      label: 'Google Calendar',
      headline: 'Calendar local-only',
      detail: 'No Google Calendar account is connected.',
      tone: 'local',
      action: { kind: 'integrations', label: 'Open Integrations' },
    };
  }

  if (calendar.syncState === 'syncing') {
    return {
      id: 'calendar',
      label: 'Google Calendar',
      headline: 'Calendar syncing',
      detail: `Refreshing ${plural(googleAccounts.length, 'Google account')}.`,
      tone: 'syncing',
      action: { kind: 'calendar', label: 'Open Calendar' },
    };
  }

  const unhealthyAccount = googleAccounts.find(account => (
    account.authStatus === 'needs_reconnect'
    || account.authStatus === 'revoked'
    || account.authStatus === 'error'
    || Boolean(account.lastAuthError)
    || Boolean(account.syncError)
    || account.connected === false
  ));
  const calendarError = calendar.syncError || unhealthyAccount?.lastAuthError || unhealthyAccount?.syncError;

  if (calendar.syncState === 'error' || unhealthyAccount || calendarError) {
    return {
      id: 'calendar',
      label: 'Google Calendar',
      headline: 'Calendar needs attention',
      detail: calendarError ? sanitizeHealthDetail(calendarError) : 'One Google Calendar account needs reconnection.',
      tone: 'attention',
      action: { kind: 'integrations', label: 'Open Integrations' },
    };
  }

  return {
    id: 'calendar',
    label: 'Google Calendar',
    headline: 'Calendar healthy',
    detail: `${plural(googleAccounts.length, 'Google account')} connected with no current sync errors.`,
    tone: 'healthy',
    meta: formatCheckedAt(calendar.lastSyncTime),
  };
}

function buildOpenAiItem(input: SystemHealthInput): HealthItem {
  const { openAi } = input;

  if (openAi.checking || !openAi.status) {
    return {
      id: 'openai',
      label: 'OpenAI',
      headline: 'Checking OpenAI',
      detail: 'Running the hosted assistant health check.',
      tone: 'checking',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  if (openAi.status.status === 'available') {
    return {
      id: 'openai',
      label: 'OpenAI',
      headline: 'OpenAI available',
      detail: openAi.status.model ? `Hosted assistant is reachable with ${openAi.status.model}.` : 'Hosted assistant health check passed.',
      tone: 'healthy',
      meta: formatCheckedAt(openAi.checkedAt),
    };
  }

  if (openAi.status.status === 'sign_in_required') {
    return {
      id: 'openai',
      label: 'OpenAI',
      headline: 'OpenAI sign-in needed',
      detail: sanitizeHealthDetail(openAi.status.message) || 'Sign in before using hosted OpenAI.',
      tone: 'attention',
      action: { kind: 'sign-in', label: 'Sign in' },
    };
  }

  if (openAi.status.status === 'not_configured') {
    return {
      id: 'openai',
      label: 'OpenAI',
      headline: 'OpenAI not configured',
      detail: sanitizeHealthDetail(openAi.status.message) || 'Hosted OpenAI is not configured for this build.',
      tone: 'local',
      action: { kind: 'settings', label: 'Open Settings' },
    };
  }

  return {
    id: 'openai',
    label: 'OpenAI',
    headline: 'OpenAI unavailable',
    detail: 'Hosted assistant health check did not pass.',
    tone: 'offline',
    action: { kind: 'refresh', label: 'Refresh status' },
  };
}

function buildOllamaItem(input: SystemHealthInput): HealthItem {
  const { ollama } = input;

  if (ollama.checking || ollama.connected === null) {
    return {
      id: 'ollama',
      label: 'Ollama',
      headline: 'Checking Ollama',
      detail: `Checking ${ollama.endpoint}.`,
      tone: 'checking',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  if (ollama.connected) {
    return {
      id: 'ollama',
      label: 'Ollama',
      headline: 'Ollama available',
      detail: `Local AI endpoint is reachable at ${ollama.endpoint}.`,
      tone: 'healthy',
      meta: formatCheckedAt(ollama.checkedAt),
    };
  }

  return {
    id: 'ollama',
    label: 'Ollama',
    headline: 'Ollama offline',
    detail: 'Hosted OpenAI can still be used when available.',
    tone: 'offline',
    action: { kind: 'settings', label: 'Open Settings' },
  };
}

function buildVoiceItem(input: SystemHealthInput): HealthItem {
  const { voice } = input;

  if (voice.settings.assistantEnabled === false) {
    return {
      id: 'voice',
      label: 'Voice',
      headline: 'Voice disabled',
      detail: 'Enable Lina voice in Settings when you want to use it.',
      tone: 'offline',
      action: { kind: 'settings', label: 'Open Settings' },
    };
  }

  if (voice.deepgramKeyPresent) {
    return {
      id: 'voice',
      label: 'Voice',
      headline: 'Voice ready',
      detail: voice.settings.microphoneDeviceId ? 'Deepgram speech-to-text and a microphone are configured.' : 'Deepgram speech-to-text is configured.',
      tone: 'healthy',
      meta: voice.settings.wakeWordEnabled ? 'Wake word on' : 'Wake word off',
    };
  }

  if (voice.browserSpeechAvailable) {
    return {
      id: 'voice',
      label: 'Voice',
      headline: 'Voice ready',
      detail: 'Browser speech recognition is available without a Deepgram key.',
      tone: 'local',
      meta: voice.settings.wakeWordEnabled ? 'Wake word on' : 'Wake word off',
    };
  }

  return {
    id: 'voice',
    label: 'Voice',
    headline: 'Voice unavailable',
    detail: 'Add a Deepgram key or use a browser with speech recognition support.',
    tone: 'attention',
    action: { kind: 'settings', label: 'Open Settings' },
  };
}

function buildSummary(items: HealthItem[]): Pick<HealthSnapshot, 'summary' | 'overallTone' | 'attentionCount'> {
  const attentionCount = items.filter(item => item.tone === 'attention' || item.tone === 'offline').length;
  const workingCount = items.filter(item => item.tone === 'checking' || item.tone === 'syncing').length;

  if (attentionCount > 0) {
    return {
      attentionCount,
      overallTone: 'attention',
      summary: `${plural(attentionCount, 'item')} ${attentionCount === 1 ? 'needs' : 'need'} attention`,
    };
  }

  if (workingCount > 0) {
    return {
      attentionCount,
      overallTone: 'checking',
      summary: 'Status refreshing',
    };
  }

  return {
    attentionCount,
    overallTone: 'healthy',
    summary: 'Core systems look ready',
  };
}

export function buildSystemHealthSnapshot(input: SystemHealthInput): HealthSnapshot {
  const items = [
    buildLocalItem(input),
    buildSupabaseItem(input),
    buildCalendarItem(input),
    buildOpenAiItem(input),
    buildOllamaItem(input),
    buildVoiceItem(input),
  ];
  const summary = buildSummary(items);

  return {
    generatedAt: new Date().toISOString(),
    ...summary,
    items,
  };
}
