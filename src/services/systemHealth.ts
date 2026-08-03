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
      label: 'Account data',
      headline: 'Loading database data',
      detail: 'Lina is opening the latest account state from Supabase.',
      tone: 'checking',
    };
  }

  if (persistence.mode === 'database') {
    return {
      id: 'local',
      label: 'Account data',
      headline: 'Database state loaded',
      detail: 'Shared Sabah One data is attached to the signed-in account. Device storage is limited to machine-bound settings and project permissions.',
      tone: 'healthy',
    };
  }

  if (persistence.mode === 'read-only') {
    return {
      id: 'local',
      label: 'Account data',
      headline: persistence.syncSession.reason === 'offline' ? 'Offline data available' : 'Reconnecting in the background',
      detail: 'Sabah One is showing the last confirmed account data read-only and will recover automatically.',
      tone: 'offline',
    };
  }

  return {
    id: 'local',
    label: 'Account data',
    headline: 'Database connection required',
    detail: 'Sabah One is waiting for a safe account snapshot from the database.',
    tone: 'offline',
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
      headline: 'Database unavailable',
      detail: 'Supabase configuration is required before Sabah One can open shared account data.',
      tone: 'offline',
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
      headline: 'Sign in required',
      detail: 'Sign in to load the database state attached to your Sabah One account.',
      tone: 'offline',
      action: { kind: 'sign-in', label: 'Sign in' },
    };
  }

  if (readFailureCount > 0 || persistence.lastRemoteReadError || persistence.lastRemoteWriteError) {
    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Database needs attention',
      detail: persistence.syncSession.hasUsableSnapshot
        ? 'Sabah One is showing the last confirmed account data and will retry automatically.'
        : 'Sabah One could not verify a safe account snapshot and will retry automatically.',
      tone: 'attention',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  if (queuedCount > 0) {
    const detailParts = [
      queuedCount > 0 ? plural(queuedCount, 'queued write') : null,
    ].filter(Boolean);
    const lastError = Boolean(persistence.supabaseQueue.lastFlushError);

    return {
      id: 'supabase',
      label: 'Supabase',
      headline: 'Syncing to Supabase',
      detail: lastError
        ? 'The last database mutation did not complete. Sabah One is reloading confirmed data.'
        : `${detailParts.join(' and ')} being committed.`,
      tone: 'syncing',
      action: { kind: 'refresh', label: 'Refresh status' },
    };
  }

  return {
    id: 'supabase',
    label: 'Supabase',
    headline: 'Database source of truth',
    detail: persistence.supabaseRealtime?.state === 'subscribed'
      ? 'The account database probe passed and its private realtime channel is authenticated.'
      : 'The database is authoritative; realtime reconnect is still being established.',
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
      headline: 'No external calendar',
      detail: 'Manual calendar records remain in your Sabah One account database; no Google Calendar account is connected.',
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
