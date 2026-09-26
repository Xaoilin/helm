import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrayerReminderReceipt, PrayerTrackingRecord } from '../types/domain';
import { ServiceError } from '../services/backend/serviceClient';
import { getPrayerReminderKey } from '../services/prayerTracking';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerPersistence } from '../store/contexts/prayer/usePrayerPersistence';

const persistence = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStore: vi.fn(async () => undefined),
  subscribeStoreKey: vi.fn(() => () => undefined),
}));
vi.mock('../store/persistence', () => persistence);

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
const ASR_KEY = `${TODAY}::Asr`;
const serviceFajr = {
  id: '1c52385c-3d06-43e5-849f-8c9652ddf677', date: TODAY, prayer: 'Fajr', status: 'on_time',
  recordedAt: '2026-09-26T05:30:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
};
/** An outcome only the old Supabase mirror still holds. */
const mirroredAsr: PrayerTrackingRecord = {
  date: TODAY, prayerName: 'Asr', status: 'late', recordedAt: '2026-09-26T16:30:00.000Z', source: 'dashboard',
};
const reminder: PrayerReminderReceipt = {
  date: TODAY, prayerName: 'Dhuhr', deadlineAt: '2026-09-26T15:08:00.000Z',
  notificationKey: getPrayerReminderKey(TODAY, 'Dhuhr', '2026-09-26T15:08:00.000Z'),
  notifiedAt: '2026-09-26T14:53:00.000Z',
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
  persistence.loadStore.mockResolvedValue({
    trackingStartedAt: '2026-04-01T00:00:00.000Z',
    records: { [ASR_KEY]: mirroredAsr },
    reminderReceipts: { [reminder.notificationKey]: reminder },
    boundedReminderReceipts: {},
  });
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
  it('waits for settings and rewards before loading anything', async () => {
    const { result, rerender } = renderPersistence(false);
    await act(async () => { await Promise.resolve(); });
    expect(persistence.loadStore).not.toHaveBeenCalled();
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();

    rerender({ sourcesLoaded: true, locationReady: true });

    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(result.current.store.loaded).toBe(true);
  });

  it('is loaded without waiting for the services, and loads outcomes once the location is final', async () => {
    const { result, rerender } = renderPersistence(true, false);

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();

    rerender({ sourcesLoaded: true, locationReady: true });

    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(api.getPrayerDashboard).toHaveBeenCalledTimes(1);
  });

  it('takes outcomes and the tracking start only from the prayer service', async () => {
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.store.tracking.records[FAJR_KEY]).toMatchObject({ status: 'on_time' }));
    expect(result.current.store.tracking.trackingStartedAt).toBe('2026-09-01T00:00:00Z');
    // The old mirror's outcome is neither shown nor sent to the service.
    expect(result.current.store.tracking.records[ASR_KEY]).toBeUndefined();
    await waitFor(() => expect(result.current.serviceSync.status).toBe('synced'));
    expect(api.createPrayerOutcome).not.toHaveBeenCalled();
  });

  it('keeps reminder receipts from the account record, which the service does not hold', async () => {
    const { result } = renderPersistence();

    await waitFor(() => expect(result.current.store.loaded).toBe(true));
    expect(result.current.store.tracking.reminderReceipts[reminder.notificationKey]).toEqual(reminder);
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
    // The account record is saved too, but its codec keeps only reminder receipts.
    expect(persistence.saveStore).toHaveBeenCalledWith('prayerTracking', expect.anything());
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
