import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrayerTrackingRecord } from '../types/domain';
import { ServiceError } from '../services/backend/serviceClient';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerPersistence, type PrayerPreferences } from '../store/contexts/prayer/usePrayerPersistence';
import { makeGamification } from './fixtures';

const persistence = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStore: vi.fn(async () => undefined),
  subscribeStoreKey: vi.fn(() => () => undefined),
}));
vi.mock('../store/persistence', () => persistence);

const api = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => true),
  getPrayerDashboard: vi.fn(),
  importPrayerTracking: vi.fn(),
  listPrayerOutcomes: vi.fn(),
  createPrayerOutcome: vi.fn(),
  correctPrayerOutcome: vi.fn(),
  deletePrayerOutcome: vi.fn(),
  savePrayerPreferences: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => api);

const TODAY = '2026-09-26';
const FAJR_KEY = `${TODAY}::Fajr`;
const storedFajr: PrayerTrackingRecord = {
  date: TODAY, prayerName: 'Fajr', status: 'on_time', recordedAt: '2026-09-26T05:30:00.000Z', source: 'dashboard',
};
const preferences: PrayerPreferences = { enabled: true, reminderEnabled: true, reminderMinutes: 15 };

function usePersistenceHarness({ sourcesLoaded, preferences: currentPreferences }: {
  sourcesLoaded: boolean;
  preferences: PrayerPreferences;
}) {
  const store = usePrayerTracking();
  const serviceSync = usePrayerPersistence({
    store,
    sourcesLoaded,
    gamification: makeGamification(),
    tasks: [],
    location: { city: 'Bedford', country: 'United Kingdom' },
    preferences: currentPreferences,
    onRejected: vi.fn(),
  });
  return { store, serviceSync };
}

function renderPersistence(sourcesLoaded = true) {
  return renderHook(props => usePersistenceHarness(props), {
    initialProps: { sourcesLoaded, preferences },
  });
}

beforeEach(() => {
  api.isPrayerServiceEnabled.mockReturnValue(true);
  persistence.loadStore.mockResolvedValue({
    trackingStartedAt: '2026-09-01T00:00:00.000Z',
    records: { [FAJR_KEY]: storedFajr },
  });
  api.getPrayerDashboard.mockResolvedValue({
    today: TODAY,
    tracking: {
      trackingStartedAt: '2026-09-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: '2026-09-01T00:00:00Z',
    },
  });
  api.listPrayerOutcomes.mockResolvedValue([]);
  api.createPrayerOutcome.mockImplementation(async (request: { date: string; prayer: string; status: string }) => ({
    outcome: {
      id: crypto.randomUUID(), date: request.date, prayer: request.prayer, status: request.status,
      recordedAt: '2026-09-26T05:30:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
    },
    firstReward: true,
  }));
  api.savePrayerPreferences.mockResolvedValue(preferences);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('usePrayerPersistence', () => {
  it('waits for the legacy sources before loading the stored tracking', async () => {
    const { result, rerender } = renderPersistence(false);
    await act(async () => { await Promise.resolve(); });
    expect(persistence.loadStore).not.toHaveBeenCalled();
    expect(result.current.store.loaded).toBe(false);

    rerender({ sourcesLoaded: true, preferences });

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    expect(persistence.loadStore).toHaveBeenCalledWith('prayerTracking');
    expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' });
  });

  it('saves every change to the account store and sends it to the prayer service', async () => {
    const { result } = renderPersistence();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    await waitFor(() => expect(api.createPrayerOutcome).toHaveBeenCalledTimes(1));
    persistence.saveStore.mockClear();

    const dhuhr: PrayerTrackingRecord = { ...storedFajr, prayerName: 'Dhuhr', recordedAt: '2026-09-26T12:30:00.000Z' };
    act(() => {
      result.current.store.commitTracking(current => ({
        ...current,
        records: { ...current.records, [`${TODAY}::Dhuhr`]: dhuhr },
      }));
    });

    await waitFor(() => expect(persistence.saveStore).toHaveBeenCalledWith(
      'prayerTracking',
      expect.objectContaining({ records: expect.objectContaining({ [`${TODAY}::Dhuhr`]: dhuhr }) }),
    ));
    await waitFor(() => expect(api.createPrayerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ date: TODAY, prayer: 'Dhuhr', status: 'on_time' }),
    ));
    await waitFor(() => expect(result.current.serviceSync).toEqual({ status: 'synced', error: null }));
  });

  it('shows a prayer service failure while the account store still saves the change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.createPrayerOutcome.mockRejectedValue(new ServiceError(503, 'database_unavailable', 'Prayer service is unavailable.'));
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.serviceSync).toEqual({
      status: 'error',
      error: 'Prayer service is unavailable.',
    }));
    expect(persistence.saveStore).toHaveBeenCalledWith(
      'prayerTracking',
      expect.objectContaining({ records: expect.objectContaining({ [FAJR_KEY]: expect.anything() }) }),
    );
    expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' });
  });

  it('mirrors prayer preferences to the service and reports a failed save', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, rerender } = renderPersistence();
    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    await waitFor(() => expect(api.savePrayerPreferences).toHaveBeenCalledWith(preferences));

    const failure = new Error('offline');
    api.savePrayerPreferences.mockRejectedValue(failure);
    rerender({ sourcesLoaded: true, preferences: { ...preferences, reminderMinutes: 30 } });

    await waitFor(() => expect(api.savePrayerPreferences).toHaveBeenLastCalledWith({ ...preferences, reminderMinutes: 30 }));
    await waitFor(() => expect(errorLog).toHaveBeenCalledWith(
      'Prayer preferences could not be saved to the prayer service',
      failure,
    ));
  });

  it('uses only the account store when the prayer service is not configured', async () => {
    api.isPrayerServiceEnabled.mockReturnValue(false);
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    await waitFor(() => expect(persistence.saveStore).toHaveBeenCalled());
    expect(result.current.serviceSync).toEqual({ status: 'disabled', error: null });
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
    expect(api.savePrayerPreferences).not.toHaveBeenCalled();
  });
});
