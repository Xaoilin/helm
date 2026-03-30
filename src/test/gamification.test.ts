import { describe, it, expect } from 'vitest';
import {
  calculateTaskXp,
  getStreakMultiplier,
  levelFromXp,
  xpForLevel,
  xpToNextLevel,
  titleForLevel,
  updateStreak,
  checkStreakBroken,
  isStreakMilestone,
  checkNewBadges,
  processTaskCompletion,
  DEFAULT_PROFILE,
  BADGES,
} from '../services/gamification';

describe('XP calculation', () => {
  it('should award base XP by priority', () => {
    expect(calculateTaskXp({ priority: 'low', category: 'task' }, 0)).toBe(5);
    expect(calculateTaskXp({ priority: 'medium', category: 'task' }, 0)).toBe(10);
    expect(calculateTaskXp({ priority: 'high', category: 'task' }, 0)).toBe(20);
  });

  it('should add daily habit bonus', () => {
    expect(calculateTaskXp({ priority: 'medium', category: 'daily' }, 0)).toBe(15); // 10 + 5
  });

  it('should add goal completion bonus', () => {
    expect(calculateTaskXp({ priority: 'medium', category: 'goal' }, 0)).toBe(60); // 10 + 50
  });

  it('should apply streak multiplier', () => {
    expect(calculateTaskXp({ priority: 'medium', category: 'task' }, 7)).toBe(15); // 10 * 1.5
    expect(calculateTaskXp({ priority: 'medium', category: 'task' }, 14)).toBe(20); // 10 * 2.0
  });
});

describe('Streak multiplier', () => {
  it('should return 1.0 for 0-2 days', () => {
    expect(getStreakMultiplier(0)).toBe(1.0);
    expect(getStreakMultiplier(2)).toBe(1.0);
  });

  it('should return 1.25 for 3-6 days', () => {
    expect(getStreakMultiplier(3)).toBe(1.25);
    expect(getStreakMultiplier(6)).toBe(1.25);
  });

  it('should return 1.5 for 7-13 days', () => {
    expect(getStreakMultiplier(7)).toBe(1.5);
    expect(getStreakMultiplier(13)).toBe(1.5);
  });

  it('should return 2.0 for 14+ days', () => {
    expect(getStreakMultiplier(14)).toBe(2.0);
    expect(getStreakMultiplier(100)).toBe(2.0);
  });
});

describe('Levels', () => {
  it('should calculate level from XP', () => {
    expect(levelFromXp(0)).toBe(1);   // floor(sqrt(0/25)) = 0, max 1
    expect(levelFromXp(25)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(225)).toBe(3);
    expect(levelFromXp(2500)).toBe(10);
  });

  it('should calculate XP required for a level', () => {
    expect(xpForLevel(1)).toBe(25);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(5)).toBe(625);
    expect(xpForLevel(10)).toBe(2500);
  });

  it('should compute XP progress to next level', () => {
    const progress = xpToNextLevel(150); // Level 2 (need 100), next is 225
    expect(progress.current).toBe(50); // 150 - 100
    expect(progress.needed).toBe(125); // 225 - 100
    expect(progress.progress).toBeCloseTo(0.4);
  });

  it('should handle 0 XP without negative values', () => {
    const progress = xpToNextLevel(0); // Level 1, next is level 2 at 100 XP
    expect(progress.current).toBe(0);
    expect(progress.needed).toBe(100); // xpForLevel(2) - 0
    expect(progress.progress).toBe(0);
  });

  it('should assign correct titles', () => {
    expect(titleForLevel(1)).toBe('Beginner');
    expect(titleForLevel(4)).toBe('Beginner');
    expect(titleForLevel(5)).toBe('Focused');
    expect(titleForLevel(10)).toBe('Consistent');
    expect(titleForLevel(15)).toBe('Relentless');
    expect(titleForLevel(20)).toBe('Legend');
  });
});

describe('Streaks', () => {
  it('should start a streak on first completion', () => {
    const result = updateStreak(DEFAULT_PROFILE, new Date(2026, 2, 29));
    expect(result.currentStreak).toBe(1);
    expect(result.lastCompletionDate).toBe('2026-03-29');
  });

  it('should continue streak for consecutive days', () => {
    const profile = { ...DEFAULT_PROFILE, currentStreak: 5, lastCompletionDate: '2026-03-28' };
    const result = updateStreak(profile, new Date(2026, 2, 29));
    expect(result.currentStreak).toBe(6);
  });

  it('should break streak if a day was missed', () => {
    const profile = { ...DEFAULT_PROFILE, currentStreak: 10, lastCompletionDate: '2026-03-27' };
    const result = updateStreak(profile, new Date(2026, 2, 29)); // skipped the 28th
    expect(result.currentStreak).toBe(1);
  });

  it('should not increment streak for same-day completion', () => {
    const profile = { ...DEFAULT_PROFILE, currentStreak: 3, lastCompletionDate: '2026-03-29' };
    const result = updateStreak(profile, new Date(2026, 2, 29));
    expect(result.currentStreak).toBe(3); // unchanged
  });

  it('should track longest streak', () => {
    const profile = { ...DEFAULT_PROFILE, currentStreak: 5, longestStreak: 10, lastCompletionDate: '2026-03-28' };
    const result = updateStreak(profile, new Date(2026, 2, 29));
    expect(result.longestStreak).toBe(10); // still 10

    const profile2 = { ...DEFAULT_PROFILE, currentStreak: 10, longestStreak: 10, lastCompletionDate: '2026-03-28' };
    const result2 = updateStreak(profile2, new Date(2026, 2, 29));
    expect(result2.longestStreak).toBe(11); // new record
  });

  it('should detect broken streaks', () => {
    // Use local date string for yesterday (same as the production code)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const active = { ...DEFAULT_PROFILE, currentStreak: 5, lastCompletionDate: yesterdayStr };
    expect(checkStreakBroken(active)).toBe(false); // yesterday is ok

    const broken = { ...DEFAULT_PROFILE, currentStreak: 5, lastCompletionDate: '2025-01-01' };
    expect(checkStreakBroken(broken)).toBe(true);
  });

  it('should identify streak milestones', () => {
    expect(isStreakMilestone(7)).toBe(true);
    expect(isStreakMilestone(14)).toBe(true);
    expect(isStreakMilestone(30)).toBe(true);
    expect(isStreakMilestone(5)).toBe(false);
    expect(isStreakMilestone(8)).toBe(false);
  });
});

describe('Badges', () => {
  // Default extended context for badge tests
  const extDefaults = {
    dayOfWeek: 3, // Wednesday
    totalHabits: 0,
    totalGoalsCreated: 0,
    totalGoalsCompleted: 0,
    totalHighPriorityCompleted: 0,
    completedHabitToday: false,
    completedTaskToday: true,
    completedGoalToday: false,
    allHabitsDoneToday: false,
    goalCategories: 0,
    daysSinceFirstUse: 0,
    hadPriorStreak: false,
    knowledgeEntries: 0,
    knowledgeTopics: 0,
    lifestyleHaramMastered: 0,
    lifestyleHalalConsistent: 0,
    lifestyleTotal: 0,
    prayerHabitsCompleted: 0,
  };

  it('should award first-blood on first completion', () => {
    const badges = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, totalTasksCompleted: 1 },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 12,
    });
    expect(badges).toContain('first-blood');
  });

  it('should award hat-trick on 3 completions in a day', () => {
    const badges = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, totalTasksCompleted: 3 },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 3,
      hourOfDay: 14,
    });
    expect(badges).toContain('hat-trick');
  });

  it('should award early-bird before 9am', () => {
    const badges = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, totalTasksCompleted: 1 },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 7,
    });
    expect(badges).toContain('early-bird');
  });

  it('should award goal-getter on goal completion', () => {
    const badges = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, totalTasksCompleted: 1 },
      task: { category: 'goal', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 12,
      totalGoalsCompleted: 1,
      completedGoalToday: true,
    });
    expect(badges).toContain('goal-getter');
  });

  it('should not re-award earned badges', () => {
    const badges = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, totalTasksCompleted: 1, badges: ['first-blood'] },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 12,
    });
    expect(badges).not.toContain('first-blood');
  });

  it('should award streak badges at milestones', () => {
    const badges7 = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, currentStreak: 7, totalTasksCompleted: 1 },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 12,
    });
    expect(badges7).toContain('streak-7');

    const badges30 = checkNewBadges({
      ...extDefaults,
      profile: { ...DEFAULT_PROFILE, currentStreak: 30, totalTasksCompleted: 1 },
      task: { category: 'task', priority: 'medium' },
      completionsToday: 1,
      hourOfDay: 12,
    });
    expect(badges30).toContain('streak-30');
  });

  it('should have 125 badge definitions', () => {
    expect(BADGES.length).toBe(125);
    expect(BADGES.every(b => b.id && b.name && b.emoji && b.rarity)).toBe(true);
    // All IDs must be unique
    const ids = BADGES.map(b => b.id);
    expect(new Set(ids).size).toBe(125);
  });

  it('should have badges across all rarities', () => {
    const byRarity = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const b of BADGES) byRarity[b.rarity]++;
    expect(byRarity.common).toBeGreaterThanOrEqual(20);
    expect(byRarity.rare).toBeGreaterThanOrEqual(20);
    expect(byRarity.epic).toBeGreaterThanOrEqual(15);
    expect(byRarity.legendary).toBeGreaterThanOrEqual(10);
    expect(byRarity.common + byRarity.rare + byRarity.epic + byRarity.legendary).toBe(125);
  });

  it('should include Islamic badges', () => {
    const islamicIds = ['first-note', 'notes-5', 'first-topic', 'five-prayers', 'haram-avoid-1', 'halal-consist-1', 'notes-100', 'notes-500', 'haram-avoid-5', 'topics-20'];
    for (const id of islamicIds) {
      expect(BADGES.some(b => b.id === id)).toBe(true);
    }
  });
});

describe('processTaskCompletion (integration)', () => {
  it('should produce correct result for a fresh profile', () => {
    const result = processTaskCompletion(DEFAULT_PROFILE, { priority: 'medium', category: 'task' }, 0);
    expect(result.xpEarned).toBe(10);
    expect(result.updatedProfile.totalXp).toBe(10);
    expect(result.updatedProfile.totalTasksCompleted).toBe(1);
    expect(result.updatedProfile.currentStreak).toBe(1);
    expect(result.newBadges.some(b => b.id === 'first-blood')).toBe(true);
    expect(result.leveledUp).toBe(false);
  });

  it('should detect level up', () => {
    const profile = { ...DEFAULT_PROFILE, totalXp: 90, level: 1 }; // needs 100 for L2
    const result = processTaskCompletion(profile, { priority: 'medium', category: 'task' }, 0);
    expect(result.xpEarned).toBe(10);
    expect(result.updatedProfile.totalXp).toBe(100);
    expect(result.leveledUp).toBe(true);
    expect(result.newLevel).toBe(2);
  });

  it('should include all new badges in updatedProfile', () => {
    const result = processTaskCompletion(DEFAULT_PROFILE, { priority: 'high', category: 'goal' }, 0);
    // Should earn: first-blood (first task), goal-getter (goal), possibly others
    expect(result.updatedProfile.badges).toContain('first-blood');
    expect(result.updatedProfile.badges).toContain('goal-getter');
  });
});
