import { describe, expect, it } from 'vitest';
import { competitionSchema } from '../services/backend/competitionContracts';
import { competitionLeader, competitionRange, competitionScore } from '../services/prayerCompetition';
import type { PrayerCompetitionSummary } from '../types/domain';

const summary = (onTime: number, late: number, missed: number): PrayerCompetitionSummary => ({
  from: '2026-11-01', to: '2026-11-30', asOf: '2026-11-04T12:00:00Z', onTime, late, missed,
});

describe('prayer challenge', () => {
  it('compares only classified required prayers and counts late completions', () => {
    expect(competitionScore(summary(8, 1, 1))).toEqual({ completed: 9, total: 10, percentage: 90 });
    // Fewer obligatory opportunities must not disadvantage a participant.
    expect(competitionLeader(summary(8, 1, 1), summary(4, 1, 0))).toBe('partner');
    expect(competitionLeader(summary(8, 1, 1), summary(16, 2, 2))).toBe('tie');
  });

  it('does not declare a winner without scores for both participants', () => {
    expect(competitionScore(summary(0, 0, 0)).percentage).toBeNull();
    expect(competitionLeader(summary(0, 0, 0), summary(1, 0, 0))).toBeNull();
    expect(competitionLeader(summary(0, 0, 1), summary(0, 0, 1))).toBe('tie');
    expect(competitionLeader(summary(151, 0, 2), summary(152, 0, 2))).toBe('partner');
  });

  it('uses calendar months and Monday weeks across year, leap-day and DST boundaries', () => {
    expect(competitionRange('2026-11-04', 'month', 0)).toEqual({ from: '2026-11-01', to: '2026-11-30', label: 'November 2026' });
    expect(competitionRange('2026-01-04', 'month', -1).from).toBe('2025-12-01');
    expect(competitionRange('2024-03-01', 'month', -1).to).toBe('2024-02-29');
    expect(competitionRange('2026-11-01', 'week', 0)).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
    expect(competitionRange('2026-03-29', 'day', -1)).toMatchObject({ from: '2026-03-28', to: '2026-03-28' });
  });

  it('refuses inconsistent, negative and out-of-range partner data', () => {
    expect(competitionSchema.safeParse({ status: 'ready', self: summary(1, 0, 0), partner: null }).success).toBe(false);
    expect(competitionSchema.safeParse({ status: 'unavailable', self: summary(1, 0, 0), partner: summary(0, 0, 0) }).success).toBe(false);
    expect(competitionSchema.safeParse({ status: 'ready', self: summary(1, 0, 0), partner: summary(-1, 0, 0) }).success).toBe(false);
    expect(competitionSchema.safeParse({ status: 'ready', self: summary(1, 0, 0), partner: summary(156, 0, 0) }).success).toBe(false);
  });
});
