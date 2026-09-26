import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrayerTrackingRecord, PrayerTrackingState } from '../types/domain';
import { isPermanentRejection, revertRecord } from '../services/backend/prayerOutcomeSync';
import { ServiceError } from '../services/backend/serviceClient';
import { createPrayerTrackingState } from '../services/prayerTracking';

const api = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => true),
  getPrayerDashboard: vi.fn(),
  importPrayerTracking: vi.fn(),
  listPrayerOutcomes: vi.fn(),
  createPrayerOutcome: vi.fn(),
  correctPrayerOutcome: vi.fn(),
  deletePrayerOutcome: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => api);

import { usePrayerServiceSync } from '../store/contexts/usePrayerServiceSync';

const TODAY = '2026-09-26';

function record(prayerName: PrayerTrackingRecord['prayerName'], status: PrayerTrackingRecord['status']): PrayerTrackingRecord {
  return { date: TODAY, prayerName, status, recordedAt: '2026-09-26T09:00:00.000Z' };
}

function serviceOutcome(prayer: string, status: string) {
  return {
    id: crypto.randomUUID(), date: TODAY, prayer, status, recordedAt: '2026-09-26T09:00:00Z',
    source: 'dashboard', taskId: null, rewarded: status === 'on_time' || status === 'late', deadlineAt: null,
  };
}

const notStarted = (prayer: string) => new ServiceError(409, 'prayer_not_started', `${prayer} has not started yet.`);

describe('isPermanentRejection', () => {
  it.each([
    [409, 'prayer_not_started'], [409, 'prayer_window_open'], [400, 'invalid_status'], [404, 'outcome_not_found'],
  ])('treats %i %s as final', (status, code) => {
    expect(isPermanentRejection(new ServiceError(status, code, 'x'))).toBe(true);
  });

  it.each([
    [0, 'network'], [0, 'timeout'], [401, 'not_signed_in'], [408, 'timeout'], [429, 'rate_limited'],
    [500, 'http_error'], [503, 'database_unavailable'],
  ])('retries %i %s', (status, code) => {
    expect(isPermanentRejection(new ServiceError(status, code, 'x'))).toBe(false);
  });

  it('retries errors that are not service errors', () => {
    expect(isPermanentRejection(new Error('boom'))).toBe(false);
  });
});

describe('revertRecord', () => {
  const state = { ...createPrayerTrackingState(), records: { 'k::Fajr': record('Fajr', 'on_time') } };

  it('restores the confirmed record', () => {
    const confirmed = record('Fajr', 'missed');
    expect(revertRecord(state, 'k::Fajr', confirmed).records['k::Fajr']).toBe(confirmed);
  });

  it('removes a record the service never had', () => {
    expect(revertRecord(state, 'k::Fajr', undefined).records).toEqual({});
  });
});

describe('usePrayerServiceSync', () => {
  let tracking: PrayerTrackingState;
  const commit = vi.fn((next: PrayerTrackingState) => { tracking = next; });
  const onRejected = vi.fn();

  beforeEach(() => {
    tracking = createPrayerTrackingState(new Date('2026-09-26T00:00:00Z'));
    api.getPrayerDashboard.mockResolvedValue({
      today: TODAY,
      tracking: { trackingStartedAt: '2026-09-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: '2026-09-01T00:00:00Z' },
    });
    api.listPrayerOutcomes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function render(options: { strict?: boolean } = {}) {
    return renderHook(() => usePrayerServiceSync(() => tracking, commit, onRejected),
      options.strict ? { wrapper: StrictMode } : {});
  }

  async function load(hook: ReturnType<typeof render>) {
    await act(() => hook.result.current.hydrate(tracking, { city: 'London', country: 'United Kingdom' }));
  }

  it('reverts and reports a completion the service refuses, and never retries it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.createPrayerOutcome.mockRejectedValue(notStarted('Fajr'));
    const hook = render();
    await load(hook);

    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: record('Fajr', 'on_time') } };
    await act(async () => { hook.result.current.push(); });

    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());
    expect(onRejected).toHaveBeenCalledWith({
      key: `${TODAY}::Fajr`, record: tracking.records[`${TODAY}::Fajr`], confirmed: undefined, message: 'Fajr has not started yet.',
    });
    expect(hook.result.current.state).toEqual({ status: 'synced', error: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.createPrayerOutcome).toHaveBeenCalledOnce();
  });

  it('never re-sends a refused change that a later push still carries before its revert lands', async () => {
    api.createPrayerOutcome.mockRejectedValue(notStarted('Fajr'));
    const hook = render();
    await load(hook);

    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: record('Fajr', 'on_time') } };
    await act(async () => { hook.result.current.push(); });
    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());

    // The app has not committed the revert yet, and another change pushes the same state again.
    await act(async () => { hook.result.current.push(); });
    await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
    expect(api.createPrayerOutcome).toHaveBeenCalledOnce();

    // Completing it again later is a new action with a new key, so it is sent.
    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: { ...record('Fajr', 'on_time'), recordedAt: '2026-09-26T09:05:00.000Z' } } };
    await act(async () => { hook.result.current.push(); });
    await waitFor(() => expect(api.createPrayerOutcome).toHaveBeenCalledTimes(2));
  });

  it('keeps accepted changes when another change in the same run is refused', async () => {
    api.createPrayerOutcome.mockImplementation(async (request: { prayer: string; status: string }) => {
      if (request.prayer === 'Dhuhr') throw notStarted('Dhuhr');
      return { outcome: serviceOutcome(request.prayer, request.status), firstReward: true };
    });
    const hook = render();
    await load(hook);

    tracking = { ...tracking, records: {
      [`${TODAY}::Fajr`]: record('Fajr', 'late'),
      [`${TODAY}::Dhuhr`]: record('Dhuhr', 'on_time'),
    } };
    await act(async () => { hook.result.current.push(); });

    await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
    expect(onRejected).toHaveBeenCalledOnce();
    expect(onRejected.mock.calls[0][0].key).toBe(`${TODAY}::Dhuhr`);
    expect(api.createPrayerOutcome).toHaveBeenCalledTimes(2);
  });

  it('restores the confirmed status when a correction is refused', async () => {
    const confirmed = serviceOutcome('Fajr', 'late');
    api.listPrayerOutcomes.mockResolvedValue([confirmed]);
    api.correctPrayerOutcome.mockRejectedValue(new ServiceError(409, 'prayer_window_open', 'Fajr is still on time.'));
    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: record('Fajr', 'late') } };
    const hook = render();
    await load(hook);

    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: { ...record('Fajr', 'missed'), recordedAt: '2026-09-26T10:00:00.000Z' } } };
    await act(async () => { hook.result.current.push(); });

    await waitFor(() => expect(onRejected).toHaveBeenCalledOnce());
    expect(onRejected.mock.calls[0][0].confirmed.status).toBe('late');
    expect(onRejected.mock.calls[0][0].message).toBe('Fajr is still on time.');
  });

  it('retries a temporary failure and then saves the change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.createPrayerOutcome
      .mockRejectedValueOnce(new ServiceError(503, 'database_unavailable', 'The database is unavailable.'))
      .mockImplementation(async (request: { prayer: string; status: string }) => ({
        outcome: serviceOutcome(request.prayer, request.status), firstReward: true,
      }));
    const hook = render();
    await load(hook);

    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: record('Fajr', 'on_time') } };
    await act(async () => { hook.result.current.push(); });
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'error', error: 'The database is unavailable.' }));
    expect(onRejected).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
    expect(api.createPrayerOutcome).toHaveBeenCalledTimes(2);
    // The retry is the same action, so the service applies it once even if the first attempt landed.
    const [first, retry] = api.createPrayerOutcome.mock.calls;
    expect(retry[1]).toBe(first[1]);
    expect(first[1]).toBe(`prayer-outcome:create:${TODAY}:Fajr:on_time:2026-09-26T09:00:00.000Z`);
  });

  it('still retries under StrictMode, which unmounts and remounts every component once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.createPrayerOutcome
      .mockRejectedValueOnce(new ServiceError(503, 'write_timeout', 'The save was not confirmed in time.'))
      .mockImplementation(async (request: { prayer: string; status: string }) => ({
        outcome: serviceOutcome(request.prayer, request.status), firstReward: true,
      }));
    const hook = render({ strict: true });
    await load(hook);

    tracking = { ...tracking, records: { [`${TODAY}::Fajr`]: record('Fajr', 'on_time') } };
    await act(async () => { hook.result.current.push(); });
    await waitFor(() => expect(hook.result.current.state.status).toBe('error'));

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
    expect(api.createPrayerOutcome).toHaveBeenCalledTimes(2);
  });

  describe('bulk deletion safety net', () => {
    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    async function loadFiveOutcomes() {
      api.listPrayerOutcomes.mockResolvedValue(prayers.map(prayer => serviceOutcome(prayer, 'on_time')));
      api.deletePrayerOutcome.mockResolvedValue(undefined);
      const hook = render();
      await load(hook);
      expect(Object.keys(tracking.records)).toHaveLength(5);
      return hook;
    }

    it('refuses to delete many outcomes at once and says so, sending nothing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const hook = await loadFiveOutcomes();

      tracking = { ...tracking, records: {} };
      await act(async () => { hook.result.current.push(); });

      await waitFor(() => expect(hook.result.current.state.status).toBe('error'));
      expect(hook.result.current.state.error).toContain('would delete 5 saved prayers');
      expect(api.deletePrayerOutcome).not.toHaveBeenCalled();
    });

    it('deletes them all when the user resets all progress', async () => {
      const hook = await loadFiveOutcomes();

      hook.result.current.allowBulkDelete();
      tracking = { ...tracking, records: {} };
      await act(async () => { hook.result.current.push(); });

      await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
      expect(api.deletePrayerOutcome).toHaveBeenCalledTimes(5);
    });

    it('still lets a single undo through', async () => {
      const hook = await loadFiveOutcomes();

      const records = { ...tracking.records };
      delete records[`${TODAY}::Isha`];
      tracking = { ...tracking, records };
      await act(async () => { hook.result.current.push(); });

      await waitFor(() => expect(hook.result.current.state.status).toBe('synced'));
      expect(api.deletePrayerOutcome).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call the service when the service is not configured', async () => {
    api.isPrayerServiceEnabled.mockReturnValueOnce(false);
    const hook = render();

    await act(async () => { await hook.result.current.hydrate(tracking, { city: 'London', country: 'UK' }); });

    expect(hook.result.current.state.status).toBe('disabled');
    expect(api.getPrayerDashboard).not.toHaveBeenCalled();
  });
});
