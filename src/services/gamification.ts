/**
 * Gamification engine — pure functions, no React dependency.
 * Handles XP, levels, streaks, and badge logic.
 */

import type { Task, TaskPriority, GamificationProfile } from '../types/domain';

// ── XP System ──

const BASE_XP: Record<TaskPriority, number> = { low: 5, medium: 10, high: 20 };
const DAILY_BONUS = 5;
const GOAL_BONUS = 50;

export function getStreakMultiplier(streak: number): number {
  if (streak >= 14) return 2.0;
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.25;
  return 1.0;
}

export function calculateTaskXp(task: Pick<Task, 'priority' | 'category'>, currentStreak: number): number {
  let xp = BASE_XP[task.priority];
  if (task.category === 'daily') xp += DAILY_BONUS;
  if (task.category === 'goal') xp += GOAL_BONUS;
  return Math.round(xp * getStreakMultiplier(currentStreak));
}

// ── Levels ──

export function xpForLevel(level: number): number {
  return level * level * 25;
}

export function levelFromXp(totalXp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(totalXp / 25)));
}

export function xpToNextLevel(totalXp: number): { current: number; needed: number; progress: number } {
  const level = levelFromXp(totalXp);
  const currentLevelXp = level <= 1 ? 0 : xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const range = nextLevelXp - currentLevelXp;
  const current = totalXp - currentLevelXp;
  return { current: Math.max(0, current), needed: range, progress: range > 0 ? Math.max(0, current / range) : 0 };
}

const TITLES: [number, string][] = [
  [20, 'Legend'],
  [15, 'Relentless'],
  [10, 'Consistent'],
  [5, 'Focused'],
  [1, 'Beginner'],
];

export function titleForLevel(level: number): string {
  for (const [minLevel, title] of TITLES) {
    if (level >= minLevel) return title;
  }
  return 'Beginner';
}

// ── Streaks ──

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function updateStreak(
  profile: GamificationProfile,
  completionDate: Date = new Date(),
): Pick<GamificationProfile, 'currentStreak' | 'longestStreak' | 'lastCompletionDate'> {
  const todayStr = toLocalDateStr(completionDate);

  // Already completed today — no streak change
  if (profile.lastCompletionDate === todayStr) {
    return { currentStreak: profile.currentStreak, longestStreak: profile.longestStreak, lastCompletionDate: todayStr };
  }

  // Check if yesterday was the last completion (streak continues)
  const yesterday = new Date(completionDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterday);

  let newStreak: number;
  if (profile.lastCompletionDate === yesterdayStr) {
    newStreak = profile.currentStreak + 1;
  } else {
    // Streak broken (or first ever completion)
    newStreak = 1;
  }

  return {
    currentStreak: newStreak,
    longestStreak: Math.max(profile.longestStreak, newStreak),
    lastCompletionDate: todayStr,
  };
}

export function checkStreakBroken(profile: GamificationProfile): boolean {
  if (!profile.lastCompletionDate) return false;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterday);
  const todayStr = toLocalDateStr(today);
  // Streak is alive if last completion was today or yesterday
  return profile.lastCompletionDate !== todayStr && profile.lastCompletionDate !== yesterdayStr;
}

export const STREAK_MILESTONES = [7, 14, 30, 60, 100];

export function isStreakMilestone(streak: number): boolean {
  return STREAK_MILESTONES.includes(streak);
}

// ── Badges ──

export interface BadgeDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export const BADGES: BadgeDef[] = [
  { id: 'first-blood', name: 'First Blood', emoji: '\u{1F3AF}', description: 'Complete your first task', rarity: 'common' },
  { id: 'hat-trick', name: 'Hat Trick', emoji: '\u{1F3A9}', description: 'Complete 3 tasks in one day', rarity: 'common' },
  { id: 'early-bird', name: 'Early Bird', emoji: '\u{1F425}', description: 'Complete a task before 9am', rarity: 'rare' },
  { id: 'streak-7', name: 'Week Warrior', emoji: '\u{1F525}', description: '7-day streak', rarity: 'rare' },
  { id: 'streak-30', name: 'Monthly Master', emoji: '\u{26A1}', description: '30-day streak', rarity: 'epic' },
  { id: 'goal-getter', name: 'Goal Getter', emoji: '\u{1F3C6}', description: 'Complete a long-term goal', rarity: 'epic' },
  { id: 'century', name: 'Century', emoji: '\u{1F4AF}', description: 'Complete 100 tasks total', rarity: 'epic' },
  { id: 'streak-100', name: 'Unstoppable', emoji: '\u{1F48E}', description: '100-day streak', rarity: 'legendary' },
  { id: 'level-10', name: 'Double Digits', emoji: '\u{1F451}', description: 'Reach level 10', rarity: 'legendary' },
];

export function getBadgeDef(id: string): BadgeDef | undefined {
  return BADGES.find(b => b.id === id);
}

export interface BadgeCheckContext {
  profile: GamificationProfile;
  task: Pick<Task, 'category'>;
  completionsToday: number;
  hourOfDay: number;
}

export function checkNewBadges(ctx: BadgeCheckContext): string[] {
  const earned = new Set(ctx.profile.badges);
  const newBadges: string[] = [];

  const check = (id: string, condition: boolean) => {
    if (!earned.has(id) && condition) newBadges.push(id);
  };

  check('first-blood', ctx.profile.totalTasksCompleted >= 1);
  check('hat-trick', ctx.completionsToday >= 3);
  check('early-bird', ctx.hourOfDay < 9);
  check('streak-7', ctx.profile.currentStreak >= 7);
  check('streak-30', ctx.profile.currentStreak >= 30);
  check('streak-100', ctx.profile.currentStreak >= 100);
  check('goal-getter', ctx.task.category === 'goal');
  check('century', ctx.profile.totalTasksCompleted >= 100);
  check('level-10', ctx.profile.level >= 10);

  return newBadges;
}

// ── Default profile ──

export const DEFAULT_PROFILE: GamificationProfile = {
  totalXp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  totalTasksCompleted: 0,
  badges: [],
};

// ── Process a task completion ──

export interface CompletionResult {
  xpEarned: number;
  newLevel: number;
  leveledUp: boolean;
  newTitle: string;
  newBadges: BadgeDef[];
  streakUpdate: Pick<GamificationProfile, 'currentStreak' | 'longestStreak' | 'lastCompletionDate'>;
  isStreakMilestone: boolean;
  updatedProfile: GamificationProfile;
}

export function processTaskCompletion(
  profile: GamificationProfile,
  task: Pick<Task, 'priority' | 'category'>,
  completionsToday: number,
  now: Date = new Date(),
): CompletionResult {
  // 1. Update streak
  const streakUpdate = updateStreak(profile, now);

  // 2. Calculate XP with streak multiplier
  const xpEarned = calculateTaskXp(task, streakUpdate.currentStreak);

  // 3. Update totals
  const newTotalXp = profile.totalXp + xpEarned;
  const newTotalCompleted = profile.totalTasksCompleted + 1;
  const oldLevel = profile.level;
  const newLevel = levelFromXp(newTotalXp);

  // 4. Check badges
  const updatedProfile: GamificationProfile = {
    ...profile,
    totalXp: newTotalXp,
    level: newLevel,
    totalTasksCompleted: newTotalCompleted,
    ...streakUpdate,
  };

  const newBadgeIds = checkNewBadges({
    profile: updatedProfile,
    task,
    completionsToday: completionsToday + 1,
    hourOfDay: now.getHours(),
  });

  updatedProfile.badges = [...profile.badges, ...newBadgeIds];

  return {
    xpEarned,
    newLevel,
    leveledUp: newLevel > oldLevel,
    newTitle: titleForLevel(newLevel),
    newBadges: newBadgeIds.map(id => getBadgeDef(id)!).filter(Boolean),
    streakUpdate,
    isStreakMilestone: isStreakMilestone(streakUpdate.currentStreak) && streakUpdate.currentStreak !== profile.currentStreak,
    updatedProfile,
  };
}
