import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrayerTrackingRecord } from '../types/domain';
import { ServiceError } from '../services/backend/serviceClient';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerPersistence } from '../store/contexts/prayer/usePrayerPersistence';

const api = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => true),
  getPrayerDashboard: vi.fn(),
  listPrayerOutcomes: vi.fn(),
  createPrayerOutcome: vi.fn(),
  correctPrayerOutcome: vi.fn(),
  deletePrayerOutcome: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => api);

const TODAY = '2026-09-26';
const FAJR_KEY = `${TODAY}::Fajr`;
const serviceFajr = {
  id: '1c52385c-3d06-43e5-849f-8c9652ddf677', date: TODAY, prayer: 'Fajr', status: 'on_time',
  recordedAt: '2026-09-26T05:30:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
};

function usePersistenceHarness({ sourcesLoaded, locationReady = true }: { sourcesLoaded: boolean; locationReady?: boolean }) {
  const store = usePrayerTracking();
  const persisted = usePrayerPersistence({
    store,
    sourcesLoaded,
    locationReady,
    location: { city: 'Bedford', country: 'United Kingdom' },
    onRejected: vi.fn(),
  });
  return { store, ...persisted };
}

function renderPersistence(sourcesLoaded = true, locationReady = true) {
  return renderHook(props => usePersistenceHarness(props), { initialProps: { sourcesLoaded, locationReady } });
}

beforeEach(() => {
  api.isPrayerServiceEnabled.mockReturnValue(true);
  api.getPrayerDashboard.mockResolvedValue({
    today: TODAY,
    tracking: {
      trackingStartedAt: '2026-09-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: null,
    },
  });
  api.listPrayerOutcomes.mockResolvedValue([serviceFajr]);
  api.createPrayerOutcome.mockImplementation(async (request: { date: string; prayer: string; status: string }) => ({
    outcome: { ...serviceFajr, id: crypto.randomUUID(), prayer: request.prayer, status: request.status },
    firstReward: true,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('usePrayerPersistence', () => {
  it('loads confirmed outcomes before tasks finish, but keeps tracking writes gated', async () => {
    const { result, rerender } = renderPersistence(false);
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(result.current.store.loaded).toBe(false);
    expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' });
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
    expect(api.correctPrayerOutcome).not.toHaveBeenCalled();
    expect(api.deletePrayerOutcome).not.toHaveBeenCalled();

    rerender({ sourcesLoaded: true, locationReady: true });

    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(result.current.store.loaded).toBe(true);
    expect(api.getPrayerDashboard).toHaveBeenCalledTimes(1);
  });

  it('is loaded without waiting for the services, and loads outcomes once the location is final', async () => {
    const { result, rerender } = renderPersistence(true, false);

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();

    rerender({ sourcesLoaded: true, locationReady: true });

    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(api.getPrayerDashboard).toHaveBeenCalledTimes(1);
  });

  it('never deletes service outcomes when the first load finishes after its effect was cleaned up (live bug)', async () => {
    let resolveOutcomes: (outcomes: unknown[]) => void = () => undefined;
    api.listPrayerOutcomes.mockReturnValue(new Promise(resolve => { resolveOutcomes = resolve; }));
    const { result, rerender } = renderPersistence();
    await waitFor(() => expect(api.listPrayerOutcomes).toHaveBeenCalled());

    // The loading effect is cleaned up while the service answers (e.g. its inputs changed).
    rerender({ sourcesLoaded: true, locationReady: false });
    rerender({ sourcesLoaded: true, locationReady: true });
    await act(async () => { resolveOutcomes([serviceFajr]); });

    // A routine change afterwards (a new state object with the same outcomes) is pushed.
    act(() => {
      result.current.store.commitTracking(current => ({ ...current, records: { ...current.records } }));
    });

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(api.deletePrayerOutcome).not.toHaveBeenCalled();
    expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' });
  });

  it('takes outcomes and the tracking start only from the prayer service', async () => {
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' }));
    expect(result.current.store.tracking.trackingStartedAt).toBe('2026-09-01T00:00:00Z');
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
  });

  it('sends every change to the prayer service under its idempotency key', async () => {
    const { result } = renderPersistence();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));

    const dhuhr: PrayerTrackingRecord = {
      date: TODAY, prayerName: 'Dhuhr', status: 'on_time', recordedAt: '2026-09-26T12:30:00.000Z', source: 'dashboard',
    };
    act(() => {
      result.current.store.commitTracking(current => ({
        ...current,
        records: { ...current.records, [`${TODAY}::Dhuhr`]: dhuhr },
      }));
    });

    await waitFor(() => expect(api.createPrayerOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ date: TODAY, prayer: 'Dhuhr', status: 'on_time' }),
      `prayer-outcome:create:${TODAY}:Dhuhr:on_time:2026-09-26T12:30:00.000Z`,
    ));
    await waitFor(() => expect(result.current.serviceSync).toEqual({ status: 'synced', error: null }));
  });

  it('shows a prayer service failure and keeps the change to retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.createPrayerOutcome.mockRejectedValue(new ServiceError(503, 'write_timeout', 'The save was not confirmed in time.'));
    const { result } = renderPersistence();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));

    const dhuhr: PrayerTrackingRecord = {
      date: TODAY, prayerName: 'Dhuhr', status: 'late', recordedAt: '2026-09-26T13:00:00.000Z',
    };
    act(() => {
      result.current.store.commitTracking(current => ({
        ...current,
        records: { ...current.records, [`${TODAY}::Dhuhr`]: dhuhr },
      }));
    });

    await waitFor(() => expect(result.current.serviceSync).toEqual({
      status: 'error',
      error: 'The save was not confirmed in time.',
    }));
    expect(result.current.store.tracking.records[`${TODAY}::Dhuhr`]).toEqual(dhuhr);
  });

  it('reloads from the service when the page becomes visible, to pick up other devices', async () => {
    const { result } = renderPersistence();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(api.getPrayerDashboard).toHaveBeenCalledTimes(1);
    api.listPrayerOutcomes.mockResolvedValue([serviceFajr, { ...serviceFajr, id: crypto.randomUUID(), prayer: 'Dhuhr' }]);

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(result.current.store.tracking.records[`${TODAY}::Dhuhr`]).toBeDefined());
    expect(api.getPrayerDashboard).toHaveBeenCalledTimes(2);
  });

  it('reload fetches outcomes the service recorded itself, such as a miss', async () => {
    const { result } = renderPersistence();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    api.listPrayerOutcomes.mockResolvedValue([
      serviceFajr,
      { ...serviceFajr, id: crypto.randomUUID(), prayer: 'Dhuhr', status: 'missed', source: 'system', rewarded: false },
    ]);

    await act(async () => { result.current.reload(); });

    await waitFor(() => expect(result.current.store.tracking.records[`${TODAY}::Dhuhr`])
      .toMatchObject({ status: 'missed', source: 'system' }));
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
  });

  it('calls no service and shows no outcomes when the prayer service is not configured', async () => {
    api.isPrayerServiceEnabled.mockReturnValue(false);
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    expect(result.current.serviceSync).toEqual({ status: 'disabled', error: null });
    expect(result.current.store.tracking.records).toEqual({});
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
  });
});
