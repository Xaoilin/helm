import { describe, expect, it } from 'vitest';
import { competitionLeader, competitionPoints } from '../services/prayerCompetition';
import { competitionSummarySchema } from '../services/backend/competitionContracts';
import { PRAYER_TIMING_CHOICES, prayerTimingPoints } from '../services/prayerTiming';
import { createPrayerTrackingState, setPrayerOutcome } from '../services/prayerTracking';
import { confirmedFromService, mergeRecords, planOutcomeSync } from '../services/backend/prayerOutcomeSync';
import { correctOutcomeKey } from '../services/backend/idempotencyKeys';
import type { PrayerCompetitionSummary, PrayerTrackingRecord } from '../types/domain';

const summary = (pointsEarned: number, pointsAvailable = 12): PrayerCompetitionSummary => ({
  from: '2026-11-05', to: '2026-11-05', asOf: '2026-11-05T18:00:00Z', onTime: pointsAvailable / 12, late: 0, missed: 0,
  pointsEarned, pointsAvailable,
});
const record: PrayerTrackingRecord = { date: '2026-11-05', prayerName: 'Fajr', status: 'on_time', recordedAt: '2026-11-05T18:00:00Z' };

describe('explicit prayer timing', () => {
  it('offers exactly the owner-selected 12/8/2 weights', () => {
    expect(PRAYER_TIMING_CHOICES.map(choice => prayerTimingPoints(choice.timing))).toEqual([12, 8, 2]);
  });
  it('keeps a reported prompt prayer even when it is logged after the window', () => {
    const state = setPrayerOutcome(createPrayerTrackingState(new Date('2026-11-01')), { ...record, timing: 'prompt' });
    expect(state.records['2026-11-05::Fajr']).toMatchObject({ status: 'on_time', timing: 'prompt' });
    expect(() => setPrayerOutcome(state, { ...record, status: 'late', timing: 'prompt' })).toThrow('timing');
  });
  it('syncs timing-only changes and gives them distinct retry keys', () => {
    const old = { ...record, timing: 'within_window' as const };
    const prompt = { ...record, timing: 'prompt' as const };
    const confirmed = { records: { '2026-11-05::Fajr': old }, ids: { '2026-11-05::Fajr': 'outcome-id' } };
    expect(planOutcomeSync(confirmed, { '2026-11-05::Fajr': prompt })).toEqual([
      { kind: 'correct', key: '2026-11-05::Fajr', id: 'outcome-id', record: prompt },
    ]);
    expect(correctOutcomeKey('outcome-id', old)).not.toBe(correctOutcomeKey('outcome-id', prompt));
    expect(mergeRecords({ key: prompt }, { key: old }).key.timing).toBe('prompt');
    expect(confirmedFromService([{ ...record, id: 'id', prayer: 'Fajr', timing: 'prompt', source: null, taskId: null, rewarded: true, deadlineAt: null }]).records['2026-11-05::Fajr'].timing).toBe('prompt');
  });
});

describe('weighted prayer competition', () => {
  it('distinguishes prompt, within and outside despite identical completion', () => {
    expect(competitionLeader(summary(12), summary(8))).toBe('self');
    expect(competitionLeader(summary(8), summary(2))).toBe('self');
    expect(competitionPoints(summary(8))).toEqual({ earned: 8, available: 12, percentage: 67 });
  });
  it('normalises opportunities and compares exact fractions', () => {
    expect(competitionLeader(summary(12, 24), summary(8))).toBe('partner');
    expect(competitionLeader(summary(16, 24), summary(8))).toBe('tie');
    expect(competitionLeader(summary(0, 0), summary(8))).toBeNull();
  });
  it('keeps old summary responses usable and refuses inconsistent points', () => {
    const legacy = { ...summary(12) };
    delete legacy.pointsEarned;
    delete legacy.pointsAvailable;
    expect(competitionSummarySchema.safeParse(legacy).success).toBe(true);
    expect(competitionLeader(summary(8), legacy)).toBeNull();
    expect(competitionSummarySchema.safeParse({ ...legacy, pointsEarned: 8 }).success).toBe(false);
    expect(competitionSummarySchema.safeParse(summary(13)).success).toBe(false);
    expect(competitionSummarySchema.safeParse({ ...summary(8), pointsAvailable: 24 }).success).toBe(false);
  });
});
