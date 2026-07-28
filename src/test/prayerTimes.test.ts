import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPrayerTimes,
  getPrayerTimes,
  type PrayerTimesData,
} from '../services/prayerTimes';
import { toLocalDateStr } from '../services/financeHelpers';
import { prayerTimesBreaker } from '../services/serviceBreakers';

function apiResponse(overrides: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({
    data: {
      timings: {
        Fajr: '05:12',
        Sunrise: '06:48',
        Dhuhr: '13:09',
        Asr: '16:42',
        Sunset: '20:02',
        Maghrib: '20:18',
        Isha: '21:41',
        Midnight: '00:12',
        ...overrides,
      },
      date: {
        hijri: {
          day: '12',
          month: { en: 'Safar' },
          year: '1448',
        },
      },
      meta: { timezone: 'Europe/London' },
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cacheData(date: string, city = 'Bedford'): PrayerTimesData {
  return {
    prayers: [
      { name: 'Fajr', nameArabic: 'Fajr', time: '05:12', type: 'prayer' },
      { name: 'Sunrise', nameArabic: 'Sunrise', time: '06:48', type: 'event' },
      { name: 'Dhuhr', nameArabic: 'Dhuhr', time: '13:09', type: 'prayer' },
      { name: 'Asr', nameArabic: 'Asr', time: '16:42', type: 'prayer' },
      { name: 'Sunset', nameArabic: 'Sunset', time: '20:02', type: 'event' },
      { name: 'Maghrib', nameArabic: 'Maghrib', time: '20:18', type: 'prayer' },
      { name: 'Isha', nameArabic: 'Isha', time: '21:41', type: 'prayer' },
      { name: 'Midnight', nameArabic: 'Midnight', time: '00:12', type: 'event' },
    ],
    date,
    hijriDate: '12 Safar 1448',
    city,
    country: 'United Kingdom',
    timezone: 'Europe/London',
    method: 'Shia Ithna-Ashari, Leva Institute, Qum',
    fetchedAt: new Date().toISOString(),
    source: 'network',
  };
}

describe('prayer time schedule loading', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    prayerTimesBreaker.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('validates and returns the complete Jafari timetable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse()));

    const schedule = await fetchPrayerTimes('Bedford', 'United Kingdom');

    expect(schedule.prayers.map(prayer => prayer.name)).toEqual([
      'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Sunset', 'Maghrib', 'Isha', 'Midnight',
    ]);
    expect(schedule.timezone).toBe('Europe/London');
    expect(schedule.source).toBe('network');
  });

  it('rejects a schedule that omits a required deadline', async () => {
    const response = apiResponse();
    const body = await response.json();
    delete body.data.timings.Sunrise;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

    await expect(fetchPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow(
      'omitted required timings: Sunrise',
    );
  });

  it('retries transient server errors before succeeding', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(apiResponse());
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchPrayerTimes('Bedford', 'United Kingdom');
    await vi.runAllTimersAsync();
    const schedule = await pending;

    expect(schedule.source).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses only a matching current-day cache', async () => {
    const today = toLocalDateStr(new Date());
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cacheData(today)));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const schedule = await getPrayerTimes('Bedford', 'United Kingdom');

    expect(schedule.source).toBe('cache');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a matching current-day cache when refresh fails', async () => {
    const today = toLocalDateStr(new Date());
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cacheData(today)));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    const schedule = await getPrayerTimes('Bedford', 'United Kingdom', { forceRefresh: true });

    expect(schedule.source).toBe('cache');
  });

  it('does not use a stale or wrong-location cache', async () => {
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cacheData('2020-01-01', 'London')));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    await expect(getPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow('400');
  });

  it('rejects a same-day cache for the wrong country', async () => {
    const today = toLocalDateStr(new Date());
    const cached = cacheData(today);
    cached.country = 'United States';
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cached));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    await expect(getPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow('400');
  });

  it('rejects a malformed same-day cache missing a deadline', async () => {
    const today = toLocalDateStr(new Date());
    const cached = cacheData(today);
    cached.prayers = cached.prayers.filter(prayer => prayer.name !== 'Midnight');
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cached));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    await expect(getPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow('400');
  });

  it.each([
    ['24:10', 'invalid clock range'],
    ['06:99', 'invalid minutes'],
    ['06:48 trailing', 'trailing junk'],
  ])('rejects a network timetable with %s (%s)', async (invalidTime) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse({ Sunrise: invalidTime })));

    await expect(fetchPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow(
      'omitted required timings: Sunrise',
    );
  });

  it('rejects impossible ordering instead of turning Fajr into a 24-hour window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse({ Sunrise: '04:30' })));

    await expect(fetchPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow(
      'invalid timing sequence',
    );
  });

  it('rejects a same-day cache with impossible ordering', async () => {
    const today = toLocalDateStr(new Date());
    const cached = cacheData(today);
    cached.prayers.find(prayer => prayer.name === 'Sunrise')!.time = '04:30';
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify(cached));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));

    await expect(getPrayerTimes('Bedford', 'United Kingdom')).rejects.toThrow('400');
  });
});
