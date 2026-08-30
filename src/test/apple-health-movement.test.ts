import { describe, expect, it, vi } from 'vitest';
import {
  APPLE_HEALTH_MAX_EXPORT_BYTES,
  createAppleHealthEvidenceInputs,
  parseAppleHealthMovementExport,
  submitAppleHealthMovementEvidence,
} from '../services/appleHealthMovement';

const NOW = new Date('2026-09-01T12:00:00.000Z');

const REDACTED_EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_GB">
  <ExportDate value="2026-08-31 12:00:00 +0000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-30 23:30:00 -0400" endDate="2026-08-30 23:45:00 -0400" value="12"/>
  <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="iPhone" unit="km" startDate="2026-08-31 00:15:00 -0400" endDate="2026-08-31 00:30:00 -0400" value="0.4"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-31 00:20:00 -0400" endDate="2026-08-31 00:25:00 -0400" value="8"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-08-30 12:00:00 -0400" endDate="2026-08-30 12:05:00 -0400" value="900"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Sensitive medical app" unit="count/min" startDate="2026-08-30 12:00:00 -0400" endDate="2026-08-30 12:01:00 -0400" value="72"/>
  <WorkoutRoute location="sensitive-route-data"/>
</HealthData>`;

function parse(xml = REDACTED_EXPORT, overrides: Partial<Parameters<typeof parseAppleHealthMovementExport>[1]> = {}) {
  return parseAppleHealthMovementExport(xml, {
    timeZone: 'America/New_York',
    now: NOW,
    ...overrides,
  });
}

describe('Apple Health movement bridge', () => {
  it('aggregates positive iPhone movement once per app-local date and ignores watch/sensitive categories', () => {
    const result = parse();

    expect(result).toMatchObject({
      sourceLabel: 'iPhone',
      dateRange: { start: '2026-08-30', end: '2026-08-31' },
      freshness: { exportedAt: '2026-08-31T12:00:00.000Z', ageDays: 1 },
    });
    expect(result.days).toEqual([
      { localDate: '2026-08-30', movementTypes: ['stepCount'] },
      { localDate: '2026-08-31', movementTypes: ['distanceWalkingRunning', 'stepCount'] },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/900|72|route|Sensitive medical app|location/u);
  });

  it('maps the same source/date to stable minimal evidence identities', async () => {
    const result = parse();
    const [firstRun, secondRun] = await Promise.all([
      createAppleHealthEvidenceInputs(result),
      createAppleHealthEvidenceInputs(result),
    ]);

    expect(firstRun).toEqual(secondRun);
    expect(firstRun).toHaveLength(2);
    expect(firstRun[0]).toMatchObject({
      evidenceType: 'vitality_activity',
      sourceTier: 'self_reported',
      localDate: '2026-08-30',
      metadata: {
        provider: 'apple_health',
        source: 'iPhone',
        dateRangeStart: '2026-08-30',
        dateRangeEnd: '2026-08-31',
        exportedAt: '2026-08-31T12:00:00.000Z',
        freshnessAgeDays: 1,
        movementTypes: 'stepCount',
      },
    });
    expect(firstRun[0].idempotencyKey).toMatch(/^apple-health:[0-9a-f]{64}$/u);
    expect(firstRun[0].sourceReference).toBe(firstRun[0].idempotencyKey);
    expect(JSON.stringify(firstRun)).not.toMatch(/900|72|Sensitive|route|location|<Record/u);
  });

  it('turns repeated submission into duplicate receipts without a second business effect', async () => {
    const result = parse();
    const acceptedKeys = new Set<string>();
    const accept = vi.fn(async (input: { idempotencyKey: string }) => {
      const duplicate = acceptedKeys.has(input.idempotencyKey);
      acceptedKeys.add(input.idempotencyKey);
      return { duplicate };
    });

    await expect(submitAppleHealthMovementEvidence(result, accept)).resolves.toMatchObject({
      importedDays: 2,
      accepted: 2,
      duplicates: 0,
    });
    await expect(submitAppleHealthMovementEvidence(result, accept)).resolves.toMatchObject({
      importedDays: 2,
      accepted: 0,
      duplicates: 2,
    });
    expect(accept).toHaveBeenCalledTimes(4);
    expect(new Set(accept.mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(2);
  });

  it('fails closed for malformed, unsafe, ambiguous, partial, future, and timezone-ambiguous input', () => {
    expect(() => parse('<HealthData><Record></HealthData>')).toThrow(/malformed/u);
    expect(() => parse(`<!DOCTYPE HealthData [<!ENTITY x "boom">]>${REDACTED_EXPORT}`)).toThrow(/declarations/u);
    expect(() => parse('x'.repeat(APPLE_HEALTH_MAX_EXPORT_BYTES + 1))).toThrow(/too large/u);
    expect(() => parse(REDACTED_EXPORT.replace('startDate="2026-08-30 23:30:00 -0400"', 'startDate="2026-08-30 23:30:00"')))
      .toThrow(/explicit time zone/u);
    expect(() => parse(REDACTED_EXPORT.replace('sourceName="Apple Watch"', 'sourceName="iPhone"').replace('value="900"', 'value="oops"')))
      .toThrow(/finite/u);
    expect(() => parse(REDACTED_EXPORT.replace('sourceName="iPhone" unit="km"', 'sourceName="iPhone Other" unit="km"')))
      .toThrow(/unambiguous/u);
    expect(() => parse(REDACTED_EXPORT.replace('ExportDate value="2026-08-31 12:00:00 +0000"', 'ExportDate value="2026-09-02 12:00:00 +0000"')))
      .toThrow(/future/u);
    expect(() => parse(REDACTED_EXPORT, { timeZone: 'not/a-zone' })).toThrow(/time zone/u);
    expect(() => parse(REDACTED_EXPORT.replace('value="12"', 'value="-1"'))).toThrow(/non-negative/u);
  });

  it('requires a supported iPhone source and does not make a watch a prerequisite', () => {
    const iphoneOnly = parse(REDACTED_EXPORT.replace(/\s*<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch"[^>]+\/>/u, ''));
    expect(iphoneOnly.sourceLabel).toBe('iPhone');
    expect(() => parse(REDACTED_EXPORT.replace(/sourceName="iPhone"/gu, 'sourceName="Apple Watch"')))
      .toThrow(/iPhone movement/u);
  });
});
