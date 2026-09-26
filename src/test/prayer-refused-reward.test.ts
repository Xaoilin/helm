import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../services/gamification';
import {
  buildPrayerCompletionTransition,
  withdrawRefusedPrayerReward,
} from '../services/prayerCompletionPolicy';
import { revertRecord } from '../services/backend/prayerOutcomeSync';
import {
  createPrayerTrackingState,
  getPrayerRecordKey,
  getPrayerRewardLogId,
  normalizePrayerTrackingState,
} from '../services/prayerTracking';
import type { GamificationProfile, PrayerName, PrayerTrackingState, Task } from '../types/domain';

const DATE = '2026-09-26';
const COMPLETED_AT = new Date('2026-09-26T00:30:00Z');
const KNOWLEDGE = {
  knowledgeEntries: 0,
  knowledgeTopics: 0,
  lifestyleHaramMastered: 0,
  lifestyleHalalConsistent: 0,
  lifestyleTotal: 0,
};

function fajrTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-fajr',
    title: 'Fajr Prayer',
    category: 'prayer',
    priority: 'high',
    completed: false,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  } as Task;
}

function complete(
  prayerName: PrayerName,
  gamification: GamificationProfile,
  tracking: PrayerTrackingState,
  tasks: readonly Task[] = [],
) {
  return buildPrayerCompletionTransition({
    prayerName,
    status: 'on_time',
    prayerDate: DATE,
    source: 'dashboard',
    completedAt: COMPLETED_AT,
    tasks,
    tracking,
    gamification,
    knowledge: KNOWLEDGE,
    scheduleTimeZone: 'Europe/London',
  });
}

/** What the app loads on the next page view: outcomes come only from the prayer service. */
function reload(tracking: PrayerTrackingState) {
  return normalizePrayerTrackingState(tracking, { now: COMPLETED_AT });
}

const fajrKey = getPrayerRecordKey(DATE, 'Fajr');
const start = createPrayerTrackingState(new Date('2026-09-01T00:00:00Z'));

describe('withdrawRefusedPrayerReward', () => {
  describe('happy path', () => {
    it('gives back exactly what the refused completion granted', () => {
      const completed = complete('Fajr', DEFAULT_PROFILE, start);
      expect(completed.xpEarned).toBeGreaterThan(0);

      const { gamificationAfter } = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [], gamification: completed.gamificationAfter,
      });

      expect(gamificationAfter.totalXp).toBe(DEFAULT_PROFILE.totalXp);
      expect(gamificationAfter.level).toBe(DEFAULT_PROFILE.level);
      expect(gamificationAfter.totalTasksCompleted).toBe(DEFAULT_PROFILE.totalTasksCompleted);
      expect(gamificationAfter.habitTallies).toEqual({});
      expect(gamificationAfter.dailyLog).toEqual({});
      expect(gamificationAfter.prayerCompletionLedger).toEqual({});
    });

    it('a refused outcome never comes back on the next load, even while its reward receipt remains', () => {
      const completed = complete('Fajr', DEFAULT_PROFILE, start);
      const reverted = revertRecord(completed.trackingAfter, fajrKey, undefined);

      // Outcomes are no longer rebuilt from the XP ledger or daily log (the live bug's cause).
      expect(completed.gamificationAfter.prayerCompletionLedger?.[fajrKey]).toBeDefined();
      expect(reload(reverted).records[fajrKey]).toBeUndefined();
    });

    it('names the prayer task so today\'s tick can be undone', () => {
      const task = fajrTask();
      const completed = complete('Fajr', DEFAULT_PROFILE, start, [task]);

      const result = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [task], gamification: completed.gamificationAfter,
      });

      expect(result.taskId).toBe('task-fajr');
      expect(result.gamificationAfter.dailyLog).toEqual({});
      expect(reload(revertRecord(completed.trackingAfter, fajrKey, undefined)).records[fajrKey]).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('leaves other prayers on the same day untouched', () => {
      const fajr = complete('Fajr', DEFAULT_PROFILE, start);
      const both = complete('Dhuhr', fajr.gamificationAfter, fajr.trackingAfter);

      const { gamificationAfter } = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [], gamification: both.gamificationAfter,
      });

      expect(gamificationAfter.totalXp).toBe(both.gamificationAfter.totalXp - fajr.xpEarned);
      expect(gamificationAfter.dailyLog).toEqual({ [DATE]: [getPrayerRewardLogId('Dhuhr')] });
      expect(Object.keys(gamificationAfter.prayerCompletionLedger ?? {})).toEqual([getPrayerRecordKey(DATE, 'Dhuhr')]);
    });

    it('removes an older receipt that never recorded its XP, keeping XP as it is', () => {
      const legacy: GamificationProfile = {
        ...DEFAULT_PROFILE,
        totalXp: 120,
        totalTasksCompleted: 3,
        dailyLog: { [DATE]: [getPrayerRewardLogId('Fajr')] },
        prayerCompletionLedger: {
          [fajrKey]: { date: DATE, prayerName: 'Fajr', status: 'on_time', recordedAt: COMPLETED_AT.toISOString(), rewarded: true },
        },
      };

      const { gamificationAfter } = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [], gamification: legacy,
      });

      expect(gamificationAfter.prayerCompletionLedger).toEqual({});
      expect(gamificationAfter.dailyLog).toEqual({});
      expect(gamificationAfter.totalXp).toBe(120);
      expect(gamificationAfter.totalTasksCompleted).toBe(3);
    });

    it('removes a daily-log entry that has no receipt', () => {
      const task = fajrTask();
      const logged: GamificationProfile = { ...DEFAULT_PROFILE, dailyLog: { [DATE]: ['task-fajr', 'task-other'] } };

      const { gamificationAfter } = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [task], gamification: logged,
      });

      expect(gamificationAfter.dailyLog).toEqual({ [DATE]: ['task-other'] });
    });

    it('never takes XP, completions or tallies below zero', () => {
      const drained: GamificationProfile = {
        ...DEFAULT_PROFILE,
        totalXp: 5,
        habitTallies: { [getPrayerRewardLogId('Fajr')]: 1 },
        prayerCompletionLedger: {
          [fajrKey]: {
            date: DATE, prayerName: 'Fajr', status: 'on_time', recordedAt: COMPLETED_AT.toISOString(), rewarded: true, xpEarned: 50,
          },
        },
      };

      const { gamificationAfter } = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [], gamification: drained,
      });

      expect(gamificationAfter.totalXp).toBe(0);
      expect(gamificationAfter.level).toBe(1);
      expect(gamificationAfter.totalTasksCompleted).toBe(0);
      expect(gamificationAfter.habitTallies).toEqual({});
    });
  });

  describe('negative paths', () => {
    it('changes nothing when the prayer was never rewarded', () => {
      const other = complete('Dhuhr', DEFAULT_PROFILE, start).gamificationAfter;

      const result = withdrawRefusedPrayerReward({
        prayerDate: DATE, prayerName: 'Fajr', tasks: [], gamification: other,
      });

      expect(result.gamificationAfter).toBe(other);
      expect(result.taskId).toBeUndefined();
    });

    it('does not touch the same prayer on another day', () => {
      const completed = complete('Fajr', DEFAULT_PROFILE, start).gamificationAfter;

      const result = withdrawRefusedPrayerReward({
        prayerDate: '2026-09-25', prayerName: 'Fajr', tasks: [], gamification: completed,
      });

      expect(result.gamificationAfter).toBe(completed);
    });
  });
});

describe('prayer completion receipt', () => {
  it('records the XP a first completion granted', () => {
    const completed = complete('Fajr', DEFAULT_PROFILE, start);
    expect(completed.gamificationAfter.prayerCompletionLedger?.[fajrKey]?.xpEarned).toBe(completed.xpEarned);
  });

  it('records no XP when the prayer was already rewarded', () => {
    const first = complete('Fajr', DEFAULT_PROFILE, start);
    const again = complete('Fajr', first.gamificationAfter, first.trackingAfter);
    expect(again.xpEarned).toBe(0);
    expect(again.gamificationAfter.prayerCompletionLedger?.[fajrKey]?.xpEarned).toBeUndefined();
  });
});
