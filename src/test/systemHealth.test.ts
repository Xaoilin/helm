// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSystemHealthSnapshot, type SystemHealthInput } from '../services/systemHealth';
import type { CalendarAccount, Settings } from '../types/domain';

const emptyQueue = {
  queuedCount: 0,
  queuedKeys: [],
  lastQueuedAt: null,
  lastFlushStartedAt: null,
  lastFlushSuccessAt: null,
  lastFlushFailureAt: null,
  lastFlushError: null,
  lastFlushKeys: [],
  lastFailureKeys: [],
};

const baseSettings: Settings = {
  theme: 'dark',
  dataRetentionDays: 30,
  telemetry: false,
  assistantEnabled: true,
  wakeWordEnabled: false,
};

type InputOverrides = Partial<Omit<SystemHealthInput, 'persistence' | 'supabase' | 'calendar' | 'openAi' | 'ollama' | 'voice'>> & {
  persistence?: Partial<Omit<SystemHealthInput['persistence'], 'supabaseQueue'>> & {
    supabaseQueue?: Partial<SystemHealthInput['persistence']['supabaseQueue']>;
  };
  supabase?: Partial<SystemHealthInput['supabase']>;
  calendar?: Partial<SystemHealthInput['calendar']>;
  openAi?: Partial<SystemHealthInput['openAi']>;
  ollama?: Partial<SystemHealthInput['ollama']>;
  voice?: Partial<Omit<SystemHealthInput['voice'], 'settings'>> & {
    settings?: Partial<SystemHealthInput['voice']['settings']>;
  };
};

function googleAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 'acc-google',
    name: 'Google',
    email: 'alisa@example.com',
    provider: 'google',
    isPrimary: true,
    connected: true,
    mocked: false,
    authStatus: 'connected',
    ...overrides,
  };
}

function baseInput(overrides: InputOverrides = {}): SystemHealthInput {
  const base: SystemHealthInput = {
    appLoaded: true,
    persistence: {
      mode: 'database',
      syncSession: {
        status: 'ready',
        userId: '11111111-1111-4111-8111-111111111111',
        accountVersion: 1,
        hasUsableSnapshot: true,
        readOnly: false,
        reason: null,
        lastReadyAt: '2026-04-24T09:00:00.000Z',
        lastProbeAt: '2026-04-24T09:00:00.000Z',
        error: null,
      },
      lastLocalWriteAt: '2026-04-24T09:00:00.000Z',
      lastLocalWriteKey: 'tasks',
      lastLocalWriteError: null,
      dirtyKeys: [],
      lastRemoteReadError: null,
      lastRemoteWriteError: null,
      remoteReadFailedKeys: [],
      supabaseRealtime: {
        state: 'subscribed',
        lastEventAt: null,
        lastStatusAt: '2026-04-24T09:00:00.000Z',
        lastError: null,
      },
      supabaseQueue: emptyQueue,
    },
    supabase: {
      ready: true,
      authenticated: true,
      bootstrapped: true,
    },
    calendar: {
      accounts: [googleAccount()],
      syncState: 'idle',
      lastSyncTime: '2026-04-24T09:01:00.000Z',
      syncError: null,
    },
    openAi: {
      status: { status: 'available', model: 'gpt-5.4' },
      checking: false,
      checkedAt: '2026-04-24T09:02:00.000Z',
    },
    ollama: {
      connected: true,
      checking: false,
      endpoint: 'http://localhost:11434',
      checkedAt: '2026-04-24T09:02:00.000Z',
    },
    voice: {
      settings: baseSettings,
      deepgramKeyPresent: true,
      browserSpeechAvailable: false,
    },
  };

  return {
    ...base,
    ...overrides,
    persistence: {
      ...base.persistence,
      ...overrides.persistence,
      supabaseQueue: {
        ...base.persistence.supabaseQueue,
        ...overrides.persistence?.supabaseQueue,
      },
    },
    supabase: {
      ...base.supabase,
      ...overrides.supabase,
    },
    calendar: {
      ...base.calendar,
      ...overrides.calendar,
    },
    openAi: {
      ...base.openAi,
      ...overrides.openAi,
    },
    ollama: {
      ...base.ollama,
      ...overrides.ollama,
    },
    voice: {
      ...base.voice,
      ...overrides.voice,
      settings: {
        ...base.voice.settings,
        ...overrides.voice?.settings,
      },
    },
  };
}

function item(input: SystemHealthInput, id: string) {
  const found = buildSystemHealthSnapshot(input).items.find(candidate => candidate.id === id);
  if (!found) throw new Error(`Missing health item ${id}`);
  return found;
}

describe('system health status mapping', () => {
  it('shows signed-out shared data as blocked and requires sign-in', () => {
    const input = baseInput({
      persistence: {
        mode: 'blocked',
        syncSession: {
          status: 'blocked',
          userId: null,
          accountVersion: 0,
          hasUsableSnapshot: false,
          readOnly: true,
          reason: 'signed_out',
          lastReadyAt: null,
          lastProbeAt: null,
          error: 'Sign in to load Sabah One data.',
        },
      },
      supabase: {
        ready: true,
        authenticated: false,
        bootstrapped: true,
      },
    });

    expect(item(input, 'local')).toMatchObject({
      headline: 'Database connection required',
      tone: 'offline',
    });
    expect(item(input, 'supabase')).toMatchObject({
      headline: 'Sign in required',
      tone: 'offline',
      action: { kind: 'sign-in' },
    });
  });

  it('shows dirty and queued Supabase writes as syncing', () => {
    const input = baseInput({
      persistence: {
        dirtyKeys: ['tasks'],
        supabaseQueue: {
          ...emptyQueue,
          queuedCount: 1,
          queuedKeys: ['helm:tasks'],
        },
      },
    });

    expect(item(input, 'supabase')).toMatchObject({
      headline: 'Syncing to Supabase',
      tone: 'syncing',
    });
  });

  it('keeps raw database errors inside diagnostics', () => {
    const input = baseInput({
      persistence: {
        lastRemoteReadError: 'PostgREST failed with secret-token-12345678901234567890',
      },
    });

    const supabase = item(input, 'supabase');
    expect(supabase.detail).toBe(
      'Sabah One is showing the last confirmed account data and will retry automatically.',
    );
    expect(supabase.detail).not.toContain('PostgREST');
    expect(supabase.detail).not.toContain('secret-token');
  });

  it('shows Google Calendar reconnect states as needing attention', () => {
    const input = baseInput({
      calendar: {
        accounts: [googleAccount({
          authStatus: 'needs_reconnect',
          lastAuthError: 'Reconnect this Google account.',
        })],
        syncState: 'error',
        lastSyncTime: null,
        syncError: null,
      },
    });

    expect(item(input, 'calendar')).toMatchObject({
      headline: 'Calendar needs attention',
      tone: 'attention',
      action: { kind: 'integrations' },
    });
  });

  it('shows hosted OpenAI unavailable without exposing token-like details', () => {
    const secret = 'sk-proj_abcdefghijklmnopqrstuvwxyz123456';
    const input = baseInput({
      openAi: {
        status: {
          status: 'unavailable',
          message: `HTTP 500: ${secret}`,
        },
        checking: false,
        checkedAt: '2026-04-24T09:02:00.000Z',
      },
    });

    const openAi = item(input, 'openai');
    expect(openAi).toMatchObject({
      headline: 'OpenAI unavailable',
      tone: 'offline',
    });
    expect(openAi.detail).toBe('Hosted assistant health check did not pass.');
    expect(openAi.detail).not.toContain(secret);
  });

  it('shows Ollama offline without implying the app is broken', () => {
    const input = baseInput({
      ollama: {
        connected: false,
        checking: false,
        endpoint: 'http://localhost:11434',
        checkedAt: '2026-04-24T09:02:00.000Z',
      },
    });

    expect(item(input, 'ollama')).toMatchObject({
      headline: 'Ollama offline',
      detail: 'Hosted OpenAI can still be used when available.',
      tone: 'offline',
    });
  });

  it('shows voice disabled and unavailable no-STT states truthfully', () => {
    expect(item(baseInput({
      voice: {
        settings: { ...baseSettings, assistantEnabled: false },
        deepgramKeyPresent: false,
        browserSpeechAvailable: false,
      },
    }), 'voice')).toMatchObject({
      headline: 'Voice disabled',
      tone: 'offline',
    });

    expect(item(baseInput({
      voice: {
        settings: { ...baseSettings, assistantEnabled: true },
        deepgramKeyPresent: false,
        browserSpeechAvailable: false,
      },
    }), 'voice')).toMatchObject({
      headline: 'Voice unavailable',
      tone: 'attention',
    });
  });
});
