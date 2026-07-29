import { afterEach, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';

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

export function renderWithProvider(ui: React.ReactElement) {
  return render(<AppProvider>{ui}</AppProvider>);
}

export function installGoogleCalendarFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.aladhan.com/v1/timingsByCity')) {
      return new Response(JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: '06:45',
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
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('localhost:11434/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/users/me/calendarList')) {
      return new Response(JSON.stringify({
        items: [
          {
            id: 'alisa@example.com',
            summary: 'Primary',
            accessRole: 'owner',
            primary: true,
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/events?')) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch in surfaces test: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function installGoogleAuthPopupSpy() {
  const requestCodeMock = vi.fn();
  const initCodeClientMock = vi.fn(() => ({
    requestCode: requestCodeMock,
  }));

  Object.defineProperty(window, 'google', {
    value: {
      accounts: {
        oauth2: {
          initCodeClient: initCodeClientMock,
          revoke: vi.fn(),
        },
      },
    },
    configurable: true,
  });

  return {
    initCodeClientMock,
    requestCodeMock,
  };
}

beforeEach(() => {
  installGoogleCalendarFetchMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  Reflect.deleteProperty(window, 'google');
});
