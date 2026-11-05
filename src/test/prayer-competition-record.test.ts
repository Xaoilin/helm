import { describe, expect, it, vi } from 'vitest';
import { competitionRecordWindow, includeFinishedCurrentPeriod, loadCompetitionRecord } from '../services/prayerCompetitionRecord';
import type { PrayerCompetition, PrayerCompetitionSummary } from '../types/domain';

const summary = (completed: number, missed: number): PrayerCompetitionSummary => ({
  from: '2026-11-01', to: '2026-11-01', asOf: '2026-11-07T12:00:00Z', onTime: completed, late: 0, missed,
});

describe('prayer competition record', () => {
  it('counts finished days in the selected month from November, never today or earlier months', () => {
    const days = competitionRecordWindow('2026-11-07', 'day', '2026-11-07');
    expect(days.periods.map(p => p.from)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(competitionRecordWindow('2026-11-07', 'day', '2026-10-31').periods).toEqual([]);
    expect(competitionRecordWindow('2026-12-07', 'day', '2026-11-03').periods).toHaveLength(30);
    expect(competitionRecordWindow('2026-12-07', 'day', '2026-12-03').periods).toHaveLength(6);
  });

  it('counts only whole Monday–Sunday weeks and finished calendar months since the start', () => {
    expect(competitionRecordWindow('2026-11-08', 'week', '2026-11-02').periods).toEqual([]);
    expect(competitionRecordWindow('2026-11-09', 'week', '2026-11-02').periods).toMatchObject([{ from: '2026-11-02', to: '2026-11-08' }]);
    expect(competitionRecordWindow('2026-12-15', 'week', '2026-12-15').periods).toHaveLength(6);
    expect(competitionRecordWindow('2026-11-30', 'month', '2026-11-01').periods).toEqual([]);
    expect(competitionRecordWindow('2026-12-01', 'month', '2026-12-01').periods).toMatchObject([{ from: '2026-11-01', to: '2026-11-30' }]);
    expect(competitionRecordWindow('2027-01-01', 'month', '2027-01-01').periods).toHaveLength(2);
  });

  it('tallies winners separately from ties and periods without scores', async () => {
    const results: PrayerCompetition[] = [
      { status: 'ready', self: summary(5, 0), partner: summary(4, 1) },
      ...Array.from({ length: 4 }, (): PrayerCompetition => ({ status: 'ready', self: summary(4, 1), partner: summary(5, 0) })),
      { status: 'ready', self: summary(3, 2), partner: summary(3, 2) },
      { status: 'ready', self: summary(0, 0), partner: summary(5, 0) },
    ];
    const read = vi.fn(async () => results.shift()!);
    expect(await loadCompetitionRecord(competitionRecordWindow('2026-11-08', 'day', '2026-11-08').periods, () => true, read))
      .toEqual({ self: 1, partner: 4, ties: 1, unscored: 1 });
  });

  it('does not publish a partial tally when a partner is missing or a request fails', async () => {
    const periods = competitionRecordWindow('2026-11-07', 'day', '2026-11-07').periods;
    const read = vi.fn(async (): Promise<PrayerCompetition> => ({ status: 'unavailable', self: summary(5, 0), partner: null }));
    expect(await loadCompetitionRecord(periods, () => true, read)).toBeNull();
    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
    await expect(loadCompetitionRecord(periods, () => true, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('stops superseded requests and limits concurrent reads to three', async () => {
    let active = true;
    let running = 0;
    let maximum = 0;
    const read = vi.fn(async (): Promise<PrayerCompetition> => {
      maximum = Math.max(maximum, ++running);
      await Promise.resolve();
      running--;
      active = false;
      return { status: 'ready', self: summary(5, 0), partner: summary(4, 1) };
    });
    expect(await loadCompetitionRecord(competitionRecordWindow('2026-11-07', 'day', '2026-11-07').periods, () => active, read)).toBeNull();
    expect(maximum).toBe(3);
    expect(read).toHaveBeenCalledTimes(3);
  });
});


describe('early completed-period records', () => {
  const record = { self: 1, partner: 4, ties: 0, unscored: 0 };
  const side = { from: '2026-11-05', to: '2026-11-05', asOf: '2026-11-05T22:00:00Z', onTime: 5, late: 0, missed: 0, allPrayed: true, pointsEarned: 60, pointsAvailable: 60 };
  it('counts a finished day before midnight only when both participants finish', () => {
    expect(includeFinishedCurrentPeriod(record, { status: 'ready', self: side, partner: { ...side, pointsEarned: 40 } }, '2026-11-05').self).toBe(2);
    expect(includeFinishedCurrentPeriod(record, { status: 'ready', self: side, partner: { ...side, allPrayed: false } }, '2026-11-05')).toBe(record);
  });
  it('counts complete weeks and months on their last day and never counts a future end', () => {
    for (const from of ['2026-11-02', '2026-11-01']) {
      const period = { ...side, from, to: '2026-11-08' };
      expect(includeFinishedCurrentPeriod(record, { status: 'ready', self: period, partner: period }, '2026-11-08').ties).toBe(1);
      expect(includeFinishedCurrentPeriod(record, { status: 'ready', self: period, partner: period }, '2026-11-05')).toBe(record);
    }
  });
});
