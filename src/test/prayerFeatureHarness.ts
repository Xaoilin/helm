import { afterEach, beforeEach, vi } from 'vitest';
import { Fragment, createElement } from 'react';
import { act, render } from '@testing-library/react';
import DashboardSurface from '../surfaces/DashboardSurface';
import ProfileSurface from '../surfaces/ProfileSurface';
import SettingsSurface from '../surfaces/SettingsSurface';
import TasksSurface from '../surfaces/TasksSurface';
import PrayerGlobalOverlays from '../components/prayer/PrayerGlobalOverlays';
import { AppProvider, useApp } from '../store/AppContext';
import type { Surface } from '../types/domain';

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  return {
    ...actual,
    loadStore: async (key: string) => {
      const raw = localStorage.getItem(`helm:${key}`);
      return raw === null ? null : JSON.parse(raw);
    },
    saveStore: async (key: string, value: unknown) => {
      localStorage.setItem(`helm:${key}`, JSON.stringify(value));
    },
    loadDeviceStore: async (key: string) => {
      const raw = localStorage.getItem(`helm:device:${key}`);
      return raw === null ? null : JSON.parse(raw);
    },
    saveDeviceStore: async (key: string, value: unknown) => {
      localStorage.setItem(`helm:device:${key}`, JSON.stringify(value));
    },
  };
});

vi.mock('../hooks/useGoogleSync', () => {
  const value = {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
    triggerSync: vi.fn().mockResolvedValue(undefined),
    accountSyncStates: {},
    diagnostics: { accounts: {} },
    credentialStatuses: {},
    refreshCredentialStatuses: vi.fn().mockResolvedValue(undefined),
    serverRuntimeStatus: null,
  };

  return {
    GoogleSyncProvider: ({ children }: { children: unknown }) => children,
    useGoogleSync: () => value,
  };
});

function installPrayerScheduleFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.aladhan.com/v1/timingsByCity')) {
      return new Response(JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: '06:50',
            Dhuhr: '13:00',
            Asr: '16:30',
            Sunset: '20:00',
            Maghrib: '20:15',
            Isha: '21:45',
            Midnight: '00:15',
          },
          date: {
            hijri: {
              day: '12',
              month: { en: 'Safar' },
              year: '1448',
            },
          },
          meta: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('localhost:11434/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    throw new Error(`Unexpected prayer feature fetch: ${url}`);
  }));
}

function seedSettings() {
  localStorage.setItem('helm:settings', JSON.stringify({
    theme: 'dark',
    dataRetentionDays: 90,
    telemetry: false,
    assistantProvider: 'ollama',
    prayerEnabled: true,
    prayerCity: 'Bedford',
    prayerCountry: 'United Kingdom',
    prayerReminderEnabled: true,
    prayerReminderMinutes: 15,
  }));
}

function seedPrayerAndHabit() {
  localStorage.setItem('helm:tasks', JSON.stringify([
    {
      id: 'prayer-fajr',
      title: 'Fajr Prayer',
      description: '',
      completed: false,
      priority: 'medium',
      category: 'prayer',
      prayerName: 'Fajr',
      recurring: { frequency: 'daily' },
      createdAt: '2026-07-28T04:00:00.000Z',
      updatedAt: '2026-07-28T04:00:00.000Z',
    },
    {
      id: 'habit-water',
      title: 'Drink water',
      description: '',
      completed: false,
      priority: 'low',
      category: 'daily',
      recurring: { frequency: 'daily' },
      createdAt: '2026-07-28T04:00:00.000Z',
      updatedAt: '2026-07-28T04:00:00.000Z',
    },
  ]));
}

const PRAYER_TEST_SURFACES: Array<{ surface: Surface; label: string }> = [
  { surface: 'dashboard', label: 'Dashboard' },
  { surface: 'tasks', label: 'Tasks' },
  { surface: 'profile', label: 'Profile' },
  { surface: 'settings', label: 'Settings' },
];

function PrayerFeatureTestApp() {
  const app = useApp();
  const surface = (() => {
    switch (app.surface) {
      case 'tasks': return createElement(TasksSurface);
      case 'profile': return createElement(ProfileSurface);
      case 'settings': return createElement(SettingsSurface);
      default: return createElement(DashboardSurface);
    }
  })();

  return createElement(
    Fragment,
    null,
    ...PRAYER_TEST_SURFACES.map(item => createElement(
      'button',
      {
        key: item.surface,
        type: 'button',
        onClick: () => app.navigate(item.surface),
        'aria-label': `Navigate to ${item.label}`,
      },
      item.label,
    )),
    surface,
    createElement(PrayerGlobalOverlays),
  );
}

export function renderPrayerFeatureApp() {
  return render(createElement(AppProvider, null, createElement(PrayerFeatureTestApp)));
}

export async function flushPrayerFeatureUpdates() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 4; index += 1) {
      await Promise.resolve();
    }
  });
}

export function installPrayerFeatureHarness() {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 28, 6, 36, 0));
    installPrayerScheduleFetch();
    seedSettings();
    seedPrayerAndHabit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });
}
