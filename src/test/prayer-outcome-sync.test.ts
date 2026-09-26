import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrayerTrackingRecord } from '../types/domain';
import type { ServiceOutcome } from '../services/backend/contracts';
import {
  applyOutcomeOperation,
  applyServiceTracking,
  confirmedFromService,
  historyStartDate,
  listAllOutcomes,
  mergeRecords,
  planOutcomeSync,
} from '../services/backend/prayerOutcomeSync';
import { createPrayerTrackingState } from '../services/prayerTracking';

vi.mock('../config', () => ({ PRAYER_BACKEND_URL: 'https://prayer.test' }));
vi.mock('../store/supabase', () => ({ getCurrentAccessToken: () => 'token' }));

afterEach(() => vi.restoreAllMocks());

function fixture<T>(name: string): T {
  return (JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'prayer-service', `${name}.json`), 'utf8')) as {
    body: T;
  }).body;
}

const created = fixture<{ outcome: ServiceOutcome }>('outcome-created').outcome;

function record(date: string, prayerName: PrayerTrackingRecord['prayerName'], status: PrayerTrackingRecord['status'],
  recordedAt = '2026-09-25T12:00:00.000Z'): PrayerTrackingRecord {
  return { date, prayerName, status, recordedAt };
}

describe('planOutcomeSync', () => {
  const confirmed = confirmedFromService([created]);

  it('creates new outcomes, corrects changed ones and deletes removed ones', () => {
    const desired = {
      '2026-09-25::Dhuhr': record('2026-09-25', 'Dhuhr', 'late'),
      '2026-09-25::Asr': record('2026-09-25', 'Asr', 'on_time'),
      '2026-09-01::Fajr': record('2026-09-01', 'Fajr', 'unclassified'),
    };

    expect(planOutcomeSync(confirmed, desired)).toEqual([
      { kind: 'correct', key: '2026-09-25::Dhuhr', id: created.id, record: desired['2026-09-25::Dhuhr'] },
      { kind: 'create', key: '2026-09-25::Asr', record: desired['2026-09-25::Asr'] },
    ]);
    expect(planOutcomeSync(confirmed, {})).toEqual([{ kind: 'delete', key: '2026-09-25::Dhuhr', id: created.id }]);
  });

  it('does nothing when the service already matches', () => {
    expect(planOutcomeSync(confirmed, confirmed.records)).toEqual([]);
  });
});

describe('mergeRecords', () => {
  it('keeps service outcomes and adds changes made on this device while offline, newest status winning', () => {
    const service = { '2026-09-25::Dhuhr': record('2026-09-25', 'Dhuhr', 'missed', '2026-09-25T15:08:00.000Z') };
    const local = {
      '2026-09-25::Dhuhr': record('2026-09-25', 'Dhuhr', 'late', '2026-09-25T16:00:00.000Z'),
      '2026-09-25::Asr': record('2026-09-25', 'Asr', 'on_time'),
    };

    expect(mergeRecords(service, local)).toEqual(local);
    expect(mergeRecords(local, { '2026-09-25::Dhuhr': record('2026-09-25', 'Dhuhr', 'on_time', '2026-09-25T13:00:00.000Z') }))
      .toEqual(local);
  });
});

it('adopts the service tracking timeline and keeps reminder receipts local', () => {
  const local = { ...createPrayerTrackingState(new Date('2026-09-25T12:00:00Z')), reminderReceipts: { key: {} as never } };
  const tracking = fixture<{ tracking: Parameters<typeof applyServiceTracking>[1] }>('dashboard').tracking;

  const next = applyServiceTracking(local, tracking, {});

  expect(Date.parse(next.trackingStartedAt)).toBe(Date.parse(tracking.trackingStartedAt));
  expect(next.activationDayEligibility).toEqual({ date: tracking.activationDate, prayerNames: tracking.activationPrayers });
  expect(next.reminderReceipts).toBe(local.reminderReceipts);
});

describe('applyOutcomeOperation', () => {
  it('records a new outcome and remembers its id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(fixture('outcome-created'), { status: 201 }));
    const desired = record('2026-09-25', 'Dhuhr', 'on_time');

    const confirmed = await applyOutcomeOperation({ kind: 'create', key: '2026-09-25::Dhuhr', record: { ...desired, source: 'tasks', taskId: 'task-dhuhr' } },
      { records: {}, ids: {} });

    expect(confirmed.ids['2026-09-25::Dhuhr']).toBe(created.id);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      date: '2026-09-25', prayer: 'Dhuhr', status: 'on_time', source: 'tasks', taskId: 'task-dhuhr',
    });
  });

  it('turns a create into a correction when the service already has that prayer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(fixture('outcome-exists'), { status: 409 }))
      .mockResolvedValueOnce(Response.json([created]))
      .mockResolvedValueOnce(Response.json(fixture('outcome-corrected')));

    const confirmed = await applyOutcomeOperation(
      { kind: 'create', key: '2026-09-25::Dhuhr', record: record('2026-09-25', 'Dhuhr', 'late') },
      { records: {}, ids: {} });

    expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'GET', 'PATCH']);
    expect(confirmed.records['2026-09-25::Dhuhr'].status).toBe('late');
  });

  it('treats deleting an already deleted outcome as done', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ code: 'outcome_not_found', message: 'No such outcome.' }, { status: 404 }));
    const confirmed = confirmedFromService([created]);

    const next = await applyOutcomeOperation({ kind: 'delete', key: '2026-09-25::Dhuhr', id: created.id }, confirmed);

    expect(next).toEqual({ records: {}, ids: {} });
  });
});

it('fetches long histories in service-sized pages', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json([]));

  await listAllOutcomes('2025-01-01', '2026-09-25');

  expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).search)).toEqual([
    '?from=2025-01-01&to=2026-01-01',
    '?from=2026-01-02&to=2026-09-25',
  ]);
});

describe('loading unchanged data causes no save', () => {
  const local = {
    ...createPrayerTrackingState(new Date('2026-09-20T08:00:00Z')),
    activationDayEligibility: { date: '2026-09-20', prayerNames: ['Isha' as const] },
    records: { '2026-09-21::Fajr': record('2026-09-21', 'Fajr', 'on_time', '2026-09-21T05:00:00.000Z') },
  };
  const service = { '2026-09-21::Fajr': record('2026-09-21', 'Fajr', 'on_time', '2026-09-21T05:00:00Z') };

  it('keeps equivalent local records and returns the same state object', () => {
    const records = mergeRecords(service, local.records);
    const tracking = { trackingStartedAt: '2026-09-20T08:00:00Z', activationDate: null, activationPrayers: [], importedAt: null };

    expect(records['2026-09-21::Fajr']).toBe(local.records['2026-09-21::Fajr']);
    expect(applyServiceTracking(local, tracking, records)).toBe(local);
  });

  it('keeps this device activation-day snapshot until the service has one', () => {
    const tracking = { trackingStartedAt: '2026-09-20T08:00:00Z', activationDate: null, activationPrayers: [], importedAt: null };

    expect(applyServiceTracking(local, tracking, {}).activationDayEligibility).toEqual(local.activationDayEligibility);
  });
});

it('loads history from the earliest outcome when it predates the tracking start', () => {
  const legacy = { '2026-04-02::Fajr': record('2026-04-02', 'Fajr', 'on_time') };

  expect(historyStartDate('2026-09-01T08:00:00Z', {}, legacy)).toBe('2026-04-02');
  expect(historyStartDate('2026-09-01T08:00:00Z', {})).toBe('2026-09-01');
});
