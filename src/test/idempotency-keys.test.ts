import { describe, expect, it } from 'vitest';
import type { PrayerTrackingRecord } from '../types/domain';
import {
  correctOutcomeKey,
  createOutcomeKey,
  deleteOutcomeKey,
  newWriteKey,
} from '../services/backend/idempotencyKeys';

const VALID_KEY = /^[\x21-\x7E]{1,200}$/u;
const ID = '1c52385c-3d06-43e5-849f-8c9652ddf677';

function record(overrides: Partial<PrayerTrackingRecord> = {}): PrayerTrackingRecord {
  return { date: '2026-09-26', prayerName: 'Fajr', status: 'on_time', recordedAt: '2026-09-26T05:30:00.000Z', ...overrides };
}

describe('createOutcomeKey', () => {
  it('is the same for every retry of one completion', () => {
    expect(createOutcomeKey(record())).toBe(createOutcomeKey(record()));
  });

  it('is new when the prayer is completed again after an undo', () => {
    expect(createOutcomeKey(record({ recordedAt: '2026-09-26T05:31:00.000Z' }))).not.toBe(createOutcomeKey(record()));
  });

  it.each([
    ['date', { date: '2026-09-27' }],
    ['prayer', { prayerName: 'Dhuhr' as const }],
    ['status', { status: 'late' as const }],
  ])('differs when the %s differs', (_name, change) => {
    expect(createOutcomeKey(record(change))).not.toBe(createOutcomeKey(record()));
  });
});

describe('correctOutcomeKey', () => {
  it('is the same for every retry of one correction', () => {
    expect(correctOutcomeKey(ID, record({ status: 'late' }))).toBe(correctOutcomeKey(ID, record({ status: 'late' })));
  });

  it('never repeats when a status is corrected back and forth', () => {
    const toLate = correctOutcomeKey(ID, record({ status: 'late', recordedAt: '2026-09-26T06:00:00.000Z' }));
    const toOnTime = correctOutcomeKey(ID, record({ status: 'on_time', recordedAt: '2026-09-26T06:01:00.000Z' }));
    const toLateAgain = correctOutcomeKey(ID, record({ status: 'late', recordedAt: '2026-09-26T06:02:00.000Z' }));
    expect(new Set([toLate, toOnTime, toLateAgain]).size).toBe(3);
  });

  it('is specific to the outcome being corrected', () => {
    expect(correctOutcomeKey(ID, record())).not.toBe(correctOutcomeKey('another-id', record()));
  });
});

describe('keys the service accepts', () => {
  it.each([
    ['create', createOutcomeKey(record())],
    ['correct', correctOutcomeKey(ID, record())],
    ['delete', deleteOutcomeKey(ID)],
    ['new write', newWriteKey()],
  ])('%s keys are 1-200 visible ASCII characters', (_name, key) => {
    expect(key).toMatch(VALID_KEY);
  });
});

it('deleting one outcome is one action however often it is retried', () => {
  expect(deleteOutcomeKey(ID)).toBe(deleteOutcomeKey(ID));
  expect(deleteOutcomeKey(ID)).not.toBe(deleteOutcomeKey('another-id'));
});

it('whole-value saves get a new key each time', () => {
  expect(newWriteKey()).not.toBe(newWriteKey());
});
