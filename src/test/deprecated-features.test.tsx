import type { ContextType } from 'react';
import { act, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { STORAGE_KEYS } from '../config/constants';
import {
  ASSISTANT_ENABLED,
  LIFE_HERO_ENABLED,
  VOICE_ENABLED,
  isSurfaceAvailable,
} from '../config/deprecatedFeatures';
import { DEFAULT_PROFILE } from '../services/gamification';
import { createDefaultDailyMomentumState } from '../services/dailyMomentum';
import { ShellProvider, getInitialShellSurface, useShell } from '../store/ShellContext';
import { CalendarCtx, type CalendarContextValue } from '../store/contexts/CalendarContext';
import { DailyMomentumCtx, type DailyMomentumContextValue } from '../store/contexts/DailyMomentumContext';
import { GamificationCtx, type GamificationContextValue } from '../store/contexts/GamificationContext';
import { PrayerCtx } from '../store/contexts/PrayerContext';
import { SettingsCtx, defaultSettings, type SettingsContextValue } from '../store/contexts/SettingsContext';
import SettingsSurface from '../surfaces/SettingsSurface';
import { AuthSessionCtx } from '../store/AuthSessionContext';
import type { Surface } from '../types/domain';
import { provide, renderWithContexts } from './renderWithContexts';

const mocks = vi.hoisted(() => ({
  assistantRuntimeStatus: vi.fn(),
  hostedAssistantConnection: vi.fn(),
  ollamaConnection: vi.fn(),
}));

// Infrastructure boundaries only: account persistence, the Supabase client, and assistant network services.
vi.mock('../store/persistence', () => ({
  activateStoreCollections: vi.fn().mockResolvedValue(undefined),
  refreshDatabasePersistence: vi.fn().mockResolvedValue(undefined),
  getSyncSessionSnapshot: () => ({ status: 'ready', readOnly: false, hasUsableSnapshot: true }),
  subscribeSyncSession: () => () => undefined,
}));
vi.mock('../store/supabase', async importOriginal => ({
  ...await importOriginal<typeof import('../store/supabase')>(),
  isAuthenticated: () => false,
  isSupabaseReady: () => false,
  getCurrentUserId: () => null,
}));
vi.mock('../services/assistantAvailability', async importOriginal => ({
  ...await importOriginal<typeof import('../services/assistantAvailability')>(),
  getAssistantRuntimeStatus: mocks.assistantRuntimeStatus,
}));
vi.mock('../services/hostedAssistantApi', async importOriginal => ({
  ...await importOriginal<typeof import('../services/hostedAssistantApi')>(),
  testHostedAssistantConnection: mocks.hostedAssistantConnection,
}));
vi.mock('../services/ollamaApi', async importOriginal => ({
  ...await importOriginal<typeof import('../services/ollamaApi')>(),
  testOllamaConnection: mocks.ollamaConnection,
  listOllamaModels: vi.fn().mockResolvedValue([]),
}));
// Child surfaces are outside this check; the sentinels prove what App chooses to mount.
vi.mock('../surfaces/DashboardSurface', () => ({ default: () => <p>Dashboard surface</p> }));
vi.mock('../components/prayer/PrayerGlobalOverlays', () => ({ default: () => null }));
vi.mock('../components/VoiceAssistant', () => ({ default: () => <aside aria-label="Lina panel" /> }));
vi.mock('../store/PageReadinessGate', () => ({
  useSharedPageReady: () => true,
  PageReadinessGate: ({ children }: { children: React.ReactNode }) => children,
}));

type PrayerContextValue = NonNullable<ContextType<typeof PrayerCtx>>;

function fakeSettings(): SettingsContextValue {
  return {
    settings: { ...defaultSettings, lifeHeroEnabled: true, assistantEnabled: true, wakeWordEnabled: true },
    integrations: [],
    loaded: true,
    appTimeZone: { effectiveTimeZone: 'Europe/London', browserTimeZone: 'Europe/London', source: 'browser' },
    appTimeZoneLoadWarning: null,
    serviceSettingsReady: true,
    updateSettings: vi.fn(),
    saveAppTimeZonePreference: vi.fn().mockResolvedValue(undefined),
    updateIntegration: vi.fn(),
  } as unknown as SettingsContextValue;
}

function appBindings() {
  const calendar = { calendarAccounts: [], updateCalendarAccount: vi.fn(), loaded: true } as unknown as CalendarContextValue;
  return [provide(SettingsCtx, fakeSettings()), provide(CalendarCtx, calendar)];
}

function settingsSurfaceBindings() {
  const gamification = { gamification: DEFAULT_PROFILE, updateGamification: vi.fn() } as unknown as GamificationContextValue;
  const momentum = {
    state: createDefaultDailyMomentumState(),
    loaded: true,
    saving: false,
    error: null,
    updateReminderPreference: vi.fn(),
  } as unknown as DailyMomentumContextValue;
  const prayer = {
    schedule: null,
    scheduleStatus: 'loading',
    scheduleError: null,
    scheduleTimezoneValid: true,
    diagnostics: { permissionState: 'default' },
    replacePrayerTracking: vi.fn(),
    requestReminderPermission: vi.fn(),
    testReminder: vi.fn(),
  } as unknown as PrayerContextValue;
  return [
    provide(AuthSessionCtx, {
      authUser: null,
      bootstrapped: true,
      loading: false,
      supabaseReady: true,
      sessionKey: 'signed-out',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    }),
    provide(SettingsCtx, fakeSettings()),
    provide(GamificationCtx, gamification),
    provide(DailyMomentumCtx, momentum),
    provide(PrayerCtx, prayer),
  ];
}

async function renderApp() {
  renderWithContexts(<ShellProvider><App /></ShellProvider>, appBindings());
  // Let lazy chunks and mount effects settle so a late Lina panel would be visible.
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.assistantRuntimeStatus.mockReset();
  mocks.hostedAssistantConnection.mockReset();
  mocks.ollamaConnection.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deprecated feature switches', () => {
  it('keeps Life Hero, the Lina assistant, and voice switched off', () => {
    expect({ LIFE_HERO_ENABLED, ASSISTANT_ENABLED, VOICE_ENABLED }).toEqual({
      LIFE_HERO_ENABLED: false,
      ASSISTANT_ENABLED: false,
      VOICE_ENABLED: false,
    });
  });

  it('withholds only the Chat surface from navigation', () => {
    expect(isSurfaceAvailable('chat')).toBe(false);
    for (const surface of ['dashboard', 'calendar', 'tasks', 'activity', 'settings', 'debug'] satisfies Surface[]) {
      expect(isSurfaceAvailable(surface)).toBe(true);
    }
  });
});

describe('shell with the assistant disabled', () => {
  it('restores a stored chat surface as the Dashboard', () => {
    window.sessionStorage.setItem(STORAGE_KEYS.SHELL_SURFACE, 'chat');

    expect(getInitialShellSurface()).toBe('dashboard');
  });

  it('opens the Dashboard when anything still asks for chat', () => {
    const { result } = renderHook(() => useShell(), { wrapper: ShellProvider });
    act(() => result.current.navigate('calendar'));
    expect(result.current.surface).toBe('calendar');

    act(() => result.current.navigate('chat'));

    expect(result.current.surface).toBe('dashboard');
  });
});

describe('app shell with deprecated features disabled', () => {
  it('does not offer Chat in desktop or mobile navigation', async () => {
    await renderApp();

    const desktop = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(desktop).getByRole('button', { name: 'Navigate to Dashboard' })).toBeInTheDocument();
    expect(within(desktop).queryByRole('button', { name: 'Navigate to Chat' })).not.toBeInTheDocument();
    const mobile = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobile).queryByRole('button', { name: 'Navigate to Chat' })).not.toBeInTheDocument();
  });

  it('falls back to the Dashboard when the session stored the chat surface', async () => {
    window.sessionStorage.setItem(STORAGE_KEYS.SHELL_SURFACE, 'chat');
    await renderApp();

    expect(screen.getByRole('main', { name: 'dashboard surface' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard surface')).toBeInTheDocument();
  });

  it('does not mount the Lina panel or voice assistant', async () => {
    await renderApp();

    expect(screen.queryByLabelText('Lina panel')).not.toBeInTheDocument();
  });

  it('makes no hosted assistant or Ollama status request on startup', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('unexpected network call'));
    vi.stubGlobal('fetch', fetchSpy);
    await renderApp();

    expect(mocks.assistantRuntimeStatus).not.toHaveBeenCalled();
    expect(mocks.hostedAssistantConnection).not.toHaveBeenCalled();
    expect(mocks.ollamaConnection).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('settings with deprecated features disabled', () => {
  it('hides Life Hero, Lina, voice, and Ollama sections even when stored settings opt in', () => {
    renderWithContexts(<SettingsSurface />, settingsSurfaceBindings());

    for (const heading of ['Life Hero', 'Voice Assistant (Lina)', 'Local AI (Ollama)']) {
      expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Toggle Lina')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Toggle wake word')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Microphone')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prayer times and reminders' })).toBeInTheDocument();
  });

  it('checks no assistant runtime and asks for no microphone', () => {
    const getUserMedia = vi.fn().mockResolvedValue({});
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia, enumerateDevices } });

    renderWithContexts(<SettingsSurface />, settingsSurfaceBindings());

    expect(mocks.assistantRuntimeStatus).not.toHaveBeenCalled();
    expect(mocks.ollamaConnection).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(enumerateDevices).not.toHaveBeenCalled();
  });
});
