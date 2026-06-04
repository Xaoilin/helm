/**
 * Gamification engine — pure functions, no React dependency.
 * Handles XP, levels, streaks, and badge logic.
 */

import type { Task, TaskPriority, GamificationProfile } from '../types/domain';
import {
  isHabitCategory,
  isPrayerTask,
} from './prayerTasks';

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
  if (isHabitCategory(task.category)) xp += DAILY_BONUS;
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

function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseLocalDateStr(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateStr);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function toLocalDateStrFromIso(isoDate: string): string | null {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalDateStr(parsed);
}

function enumerateLocalDateRange(startDateStr: string, endDateStr: string): string[] {
  const start = parseLocalDateStr(startDateStr);
  const end = parseLocalDateStr(endDateStr);
  if (!start || !end || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toLocalDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function maxLocalDateStr(left: string, right: string): string {
  return left >= right ? left : right;
}

function minLocalDateStr(left: string, right: string): string {
  return left <= right ? left : right;
}

function getMonthEndDateStr(monthStr: string): string {
  const [yearStr, monthStrPart] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStrPart);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return `${monthStr}-01`;
  return toLocalDateStr(new Date(year, month, 0));
}

function enumerateMonthKeys(startMonth: string, endMonth: string): string[] {
  const [startYearStr, startMonthStr] = startMonth.split('-');
  const [endYearStr, endMonthStr] = endMonth.split('-');
  const start = new Date(Number(startYearStr), Number(startMonthStr) - 1, 1);
  const end = new Date(Number(endYearStr), Number(endMonthStr) - 1, 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(toMonthStr(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function formatMonthLabel(monthStr: string): string {
  const [yearStr, monthStrPart] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monthStrPart);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthStr;
  }

  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
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

// 100 achievements organized by early game → mid game → late game
export const BADGES: BadgeDef[] = [
  // ══════════════════════════════════════════
  // EARLY GAME — First steps (common, 30 badges)
  // ══════════════════════════════════════════

  // Task milestones (first steps)
  { id: 'first-blood', name: 'First Blood', emoji: '\u{1F3AF}', description: 'Complete your first task', rarity: 'common' },
  { id: 'getting-started', name: 'Getting Started', emoji: '\u{1F331}', description: 'Complete 3 tasks total', rarity: 'common' },
  { id: 'on-a-roll', name: 'On a Roll', emoji: '\u{1F3B2}', description: 'Complete 5 tasks total', rarity: 'common' },
  { id: 'task-10', name: 'Double Digits', emoji: '\u{1F4CB}', description: 'Complete 10 tasks total', rarity: 'common' },
  { id: 'task-25', name: 'Quarter Century', emoji: '\u{1F4CA}', description: 'Complete 25 tasks total', rarity: 'common' },

  // Daily streaks (early)
  { id: 'streak-2', name: 'Back Again', emoji: '\u{1F504}', description: '2-day streak', rarity: 'common' },
  { id: 'streak-3', name: 'Three-Peat', emoji: '\u{1F3C3}', description: '3-day streak', rarity: 'common' },
  { id: 'streak-5', name: 'High Five', emoji: '\u{270B}', description: '5-day streak', rarity: 'common' },

  // Daily productivity
  { id: 'hat-trick', name: 'Hat Trick', emoji: '\u{1F3A9}', description: 'Complete 3 tasks in one day', rarity: 'common' },
  { id: 'busy-day', name: 'Busy Day', emoji: '\u{26A1}', description: 'Complete 5 tasks in one day', rarity: 'common' },

  // Time-based
  { id: 'early-bird', name: 'Early Bird', emoji: '\u{1F425}', description: 'Complete a task before 9am', rarity: 'common' },
  { id: 'night-owl', name: 'Night Owl', emoji: '\u{1F989}', description: 'Complete a task after 10pm', rarity: 'common' },

  // Habits
  { id: 'habit-starter', name: 'Habit Starter', emoji: '\u{1F95A}', description: 'Create your first daily habit', rarity: 'common' },
  { id: 'routine-builder', name: 'Routine Builder', emoji: '\u{1F3D7}', description: 'Create 3 daily habits', rarity: 'common' },
  { id: 'all-habits', name: 'Clean Sweep', emoji: '\u{1F9F9}', description: 'Complete all daily habits in one day', rarity: 'common' },

  // Goals
  { id: 'dreamer', name: 'Dreamer', emoji: '\u{1F4AD}', description: 'Create your first goal', rarity: 'common' },
  { id: 'goal-setter', name: 'Goal Setter', emoji: '\u{1F3AF}', description: 'Create 3 goals', rarity: 'common' },

  // Levels (early)
  { id: 'level-2', name: 'Level Up!', emoji: '\u{2B06}', description: 'Reach level 2', rarity: 'common' },
  { id: 'level-3', name: 'Rising Star', emoji: '\u{2B50}', description: 'Reach level 3', rarity: 'common' },
  { id: 'level-5', name: 'Halfway There', emoji: '\u{1F31F}', description: 'Reach level 5', rarity: 'common' },

  // XP milestones (early)
  { id: 'xp-50', name: 'First Fifty', emoji: '\u{1FA99}', description: 'Earn 50 XP total', rarity: 'common' },
  { id: 'xp-100', name: 'Triple Digits', emoji: '\u{1F4B0}', description: 'Earn 100 XP total', rarity: 'common' },
  { id: 'xp-250', name: 'XP Collector', emoji: '\u{1F48E}', description: 'Earn 250 XP total', rarity: 'common' },

  // Priority
  { id: 'high-priority', name: 'Priority One', emoji: '\u{1F534}', description: 'Complete a high-priority task', rarity: 'common' },
  { id: 'all-priorities', name: 'Well Rounded', emoji: '\u{1F308}', description: 'Complete tasks of all 3 priority levels', rarity: 'common' },

  // Variety
  { id: 'multitasker', name: 'Multitasker', emoji: '\u{1F939}', description: 'Complete a habit, task, and goal in the same day', rarity: 'common' },
  { id: 'weekend-warrior', name: 'Weekend Warrior', emoji: '\u{1F3D6}', description: 'Complete a task on Saturday or Sunday', rarity: 'common' },
  { id: 'monday-motivation', name: 'Monday Motivation', emoji: '\u{1F4AA}', description: 'Complete a task on Monday', rarity: 'common' },
  { id: 'five-in-a-row', name: 'Five in a Row', emoji: '\u{1F3B0}', description: 'Complete 5 tasks without a break', rarity: 'common' },
  { id: 'first-week', name: 'First Week', emoji: '\u{1F4C5}', description: 'Use HELM for 7 days', rarity: 'common' },

  // ══════════════════════════════════════════
  // MID GAME — Building momentum (rare, 30 badges)
  // ══════════════════════════════════════════

  // Task milestones
  { id: 'task-50', name: 'Half Century', emoji: '\u{1F4AA}', description: 'Complete 50 tasks total', rarity: 'rare' },
  { id: 'century', name: 'Century', emoji: '\u{1F4AF}', description: 'Complete 100 tasks total', rarity: 'rare' },
  { id: 'task-200', name: 'Bicentennial', emoji: '\u{1F3DB}', description: 'Complete 200 tasks total', rarity: 'rare' },
  { id: 'task-500', name: 'High Five Hundred', emoji: '\u{1F44B}', description: 'Complete 500 tasks total', rarity: 'rare' },

  // Streaks
  { id: 'streak-7', name: 'Week Warrior', emoji: '\u{1F525}', description: '7-day streak', rarity: 'rare' },
  { id: 'streak-10', name: 'Perfect Ten', emoji: '\u{1F51F}', description: '10-day streak', rarity: 'rare' },
  { id: 'streak-14', name: 'Fortnight', emoji: '\u{1F3F0}', description: '14-day streak', rarity: 'rare' },
  { id: 'streak-21', name: 'Habit Formed', emoji: '\u{1F9E0}', description: '21-day streak (habits take 21 days!)', rarity: 'rare' },

  // Daily productivity
  { id: 'power-day', name: 'Power Day', emoji: '\u{1F4A5}', description: 'Complete 7 tasks in one day', rarity: 'rare' },
  { id: 'ten-a-day', name: 'Perfect 10', emoji: '\u{1F3C6}', description: 'Complete 10 tasks in one day', rarity: 'rare' },

  // Goals
  { id: 'goal-getter', name: 'Goal Getter', emoji: '\u{1F3C6}', description: 'Complete your first goal', rarity: 'rare' },
  { id: 'goal-3', name: 'Triple Threat', emoji: '\u{1F947}', description: 'Complete 3 goals', rarity: 'rare' },
  { id: 'goal-5', name: 'Ambitious', emoji: '\u{1F680}', description: 'Complete 5 goals', rarity: 'rare' },

  // Habits (mid)
  { id: 'habits-5', name: 'Routine Master', emoji: '\u{1F3CB}', description: 'Create 5 daily habits', rarity: 'rare' },
  { id: 'perfect-week', name: 'Perfect Week', emoji: '\u{1F48E}', description: 'Complete all habits every day for 7 days', rarity: 'rare' },
  { id: 'habit-streak-14', name: 'Iron Discipline', emoji: '\u{1F6E1}', description: 'Complete all habits for 14 consecutive days', rarity: 'rare' },

  // Levels
  { id: 'level-7', name: 'Lucky Seven', emoji: '\u{1F340}', description: 'Reach level 7', rarity: 'rare' },
  { id: 'level-10', name: 'Decahedron', emoji: '\u{1F451}', description: 'Reach level 10', rarity: 'rare' },

  // XP milestones
  { id: 'xp-500', name: 'XP Hunter', emoji: '\u{1F396}', description: 'Earn 500 XP total', rarity: 'rare' },
  { id: 'xp-1000', name: 'Grand', emoji: '\u{1F3C5}', description: 'Earn 1,000 XP total', rarity: 'rare' },
  { id: 'xp-2500', name: 'XP Hoarder', emoji: '\u{1F4B0}', description: 'Earn 2,500 XP total', rarity: 'rare' },

  // Time patterns
  { id: 'early-week', name: 'Dawn Patrol', emoji: '\u{1F305}', description: 'Complete a task before 7am', rarity: 'rare' },
  { id: 'lunch-hustler', name: 'Lunch Hustler', emoji: '\u{1F35C}', description: 'Complete a task between 12-1pm', rarity: 'rare' },

  // Variety / special
  { id: 'comeback-kid', name: 'Comeback Kid', emoji: '\u{1F4A8}', description: 'Start a new streak after losing one', rarity: 'rare' },
  { id: 'badge-10', name: 'Collector', emoji: '\u{1F3AA}', description: 'Earn 10 badges', rarity: 'rare' },
  { id: 'badge-25', name: 'Trophy Room', emoji: '\u{1F3E0}', description: 'Earn 25 badges', rarity: 'rare' },
  { id: 'categories-3', name: 'Diversified', emoji: '\u{1F4DA}', description: 'Have goals in 3+ categories', rarity: 'rare' },
  { id: 'full-day', name: 'Full Day', emoji: '\u{1F31E}', description: 'Complete tasks + habits + check calendar in one day', rarity: 'rare' },
  { id: 'first-month', name: 'Monthly Member', emoji: '\u{1F4C6}', description: 'Use HELM for 30 days', rarity: 'rare' },

  // ══════════════════════════════════════════
  // LATE GAME — Mastery (epic, 25 badges)
  // ══════════════════════════════════════════

  // Task milestones
  { id: 'task-1000', name: 'Grand Master', emoji: '\u{1F3C6}', description: 'Complete 1,000 tasks total', rarity: 'epic' },
  { id: 'task-2500', name: 'Titan', emoji: '\u{1F9D9}', description: 'Complete 2,500 tasks total', rarity: 'epic' },

  // Streaks
  { id: 'streak-30', name: 'Monthly Master', emoji: '\u{1F30D}', description: '30-day streak', rarity: 'epic' },
  { id: 'streak-60', name: 'Two Months Strong', emoji: '\u{1F4AA}', description: '60-day streak', rarity: 'epic' },
  { id: 'streak-90', name: 'Quarter Year', emoji: '\u{1F3C9}', description: '90-day streak', rarity: 'epic' },

  // Goals (late)
  { id: 'goal-10', name: 'Dream Achiever', emoji: '\u{1F320}', description: 'Complete 10 goals', rarity: 'epic' },
  { id: 'goal-25', name: 'Visionary', emoji: '\u{1F52E}', description: 'Complete 25 goals', rarity: 'epic' },

  // Daily productivity
  { id: 'power-15', name: 'Overdrive', emoji: '\u{1F6F8}', description: 'Complete 15 tasks in one day', rarity: 'epic' },

  // Levels
  { id: 'level-15', name: 'Veteran', emoji: '\u{1F396}', description: 'Reach level 15', rarity: 'epic' },
  { id: 'level-20', name: 'Legend', emoji: '\u{1F451}', description: 'Reach level 20', rarity: 'epic' },

  // XP
  { id: 'xp-5000', name: 'Five Grand', emoji: '\u{1F4B5}', description: 'Earn 5,000 XP total', rarity: 'epic' },
  { id: 'xp-10000', name: 'XP Mogul', emoji: '\u{1F4B0}', description: 'Earn 10,000 XP total', rarity: 'epic' },

  // Habits
  { id: 'habits-10', name: 'Lifestyle Designer', emoji: '\u{1F3A8}', description: 'Create 10 daily habits', rarity: 'epic' },
  { id: 'perfect-month', name: 'Perfect Month', emoji: '\u{1F31F}', description: 'Complete all habits every day for 30 days', rarity: 'epic' },

  // Badges
  { id: 'badge-50', name: 'Half Century Collection', emoji: '\u{1F3C5}', description: 'Earn 50 badges', rarity: 'epic' },

  // Multiplier
  { id: 'multiplier-max', name: 'Double Time', emoji: '\u{23E9}', description: 'Reach 2x XP streak multiplier', rarity: 'epic' },

  // Categories
  { id: 'categories-5', name: 'Renaissance', emoji: '\u{1F3AD}', description: 'Have goals in 5+ categories', rarity: 'epic' },

  // Consistency
  { id: 'weekday-streak-20', name: 'Business Class', emoji: '\u{1F454}', description: '20 consecutive weekdays with completions', rarity: 'epic' },
  { id: 'high-priority-10', name: 'Firefighter', emoji: '\u{1F692}', description: 'Complete 10 high-priority tasks', rarity: 'epic' },
  { id: 'high-priority-50', name: 'Crisis Manager', emoji: '\u{1F3E5}', description: 'Complete 50 high-priority tasks', rarity: 'epic' },

  // Time
  { id: 'three-months', name: 'Quarterly Review', emoji: '\u{1F4CA}', description: 'Use HELM for 90 days', rarity: 'epic' },
  { id: 'night-shift', name: 'Night Shift', emoji: '\u{1F303}', description: 'Complete a task after midnight', rarity: 'epic' },
  { id: 'dawn-warrior', name: 'Dawn Warrior', emoji: '\u{1F304}', description: 'Complete a task before 6am', rarity: 'epic' },
  { id: 'every-hour', name: 'Around the Clock', emoji: '\u{1F570}', description: 'Complete tasks in 12+ different hours', rarity: 'epic' },

  // ══════════════════════════════════════════
  // ENDGAME — Legendary (legendary, 15 badges)
  // ══════════════════════════════════════════

  // Task milestones
  { id: 'task-5000', name: 'Five Thousand', emoji: '\u{1F3C6}', description: 'Complete 5,000 tasks total', rarity: 'legendary' },
  { id: 'task-10000', name: 'Transcendent', emoji: '\u{1F4AB}', description: 'Complete 10,000 tasks total', rarity: 'legendary' },

  // Streaks
  { id: 'streak-100', name: 'Unstoppable', emoji: '\u{1F48E}', description: '100-day streak', rarity: 'legendary' },
  { id: 'streak-200', name: 'Iron Will', emoji: '\u{1F9BE}', description: '200-day streak', rarity: 'legendary' },
  { id: 'streak-365', name: 'Full Year', emoji: '\u{1F389}', description: '365-day streak', rarity: 'legendary' },

  // Levels
  { id: 'level-30', name: 'Mythic', emoji: '\u{1F525}', description: 'Reach level 30', rarity: 'legendary' },
  { id: 'level-50', name: 'Immortal', emoji: '\u{2604}', description: 'Reach level 50', rarity: 'legendary' },

  // XP
  { id: 'xp-25000', name: 'XP Legend', emoji: '\u{1F4B0}', description: 'Earn 25,000 XP total', rarity: 'legendary' },
  { id: 'xp-100000', name: 'XP God', emoji: '\u{1F4AB}', description: 'Earn 100,000 XP total', rarity: 'legendary' },

  // Goals
  { id: 'goal-50', name: 'Life Architect', emoji: '\u{1F3DB}', description: 'Complete 50 goals', rarity: 'legendary' },
  { id: 'goal-100', name: 'Master Planner', emoji: '\u{1F4DC}', description: 'Complete 100 goals', rarity: 'legendary' },

  // Badges
  { id: 'badge-75', name: 'Completionist', emoji: '\u{1F3AE}', description: 'Earn 75 badges', rarity: 'legendary' },
  { id: 'badge-100', name: 'Platinum', emoji: '\u{1F3C6}', description: 'Earn all 100 badges', rarity: 'legendary' },

  // Ultimate
  { id: 'year-member', name: 'Founding Member', emoji: '\u{1F3F5}', description: 'Use HELM for 365 days', rarity: 'legendary' },
  { id: 'perfect-quarter', name: 'Perfect Quarter', emoji: '\u{1F48E}', description: 'Complete all habits every day for 90 days', rarity: 'legendary' },
  { id: 'streak-500', name: 'Eternal Flame', emoji: '\u{1F30B}', description: '500-day streak', rarity: 'legendary' },
  { id: 'xp-50000', name: 'XP Overlord', emoji: '\u{1F4A0}', description: 'Earn 50,000 XP total', rarity: 'legendary' },

  // ══════════════════════════════════════════
  // ISLAMIC — Knowledge & spiritual growth
  // ══════════════════════════════════════════

  // Knowledge base (early)
  { id: 'first-note', name: 'Seeker', emoji: '\u{1F4D6}', description: 'Add your first knowledge entry', rarity: 'common' },
  { id: 'notes-5', name: 'Student of Knowledge', emoji: '\u{1F4DA}', description: 'Add 5 knowledge entries', rarity: 'common' },
  { id: 'first-topic', name: 'Topic Opener', emoji: '\u{1F4C2}', description: 'Create your first knowledge topic', rarity: 'common' },
  { id: 'topics-3', name: 'Curious Mind', emoji: '\u{1F9E0}', description: 'Create 3 knowledge topics', rarity: 'common' },
  { id: 'first-prayer-habit', name: 'First Salah', emoji: '\u{1F54C}', description: 'Complete a prayer-related habit', rarity: 'common' },

  // Knowledge base (mid)
  { id: 'notes-10', name: 'Knowledge Builder', emoji: '\u{1F3D7}', description: 'Add 10 knowledge entries', rarity: 'rare' },
  { id: 'notes-25', name: 'Dedicated Learner', emoji: '\u{1F393}', description: 'Add 25 knowledge entries', rarity: 'rare' },
  { id: 'topics-5', name: 'Five Pillars Scholar', emoji: '\u{1F54B}', description: 'Create 5 knowledge topics', rarity: 'rare' },
  { id: 'notes-50', name: 'Hafiz of Notes', emoji: '\u{1F4DC}', description: 'Add 50 knowledge entries', rarity: 'rare' },
  { id: 'five-prayers', name: 'Five Daily', emoji: '\u{1F64F}', description: 'Complete 5 prayer habits in one day', rarity: 'rare' },

  // Lifestyle tracker
  { id: 'lifestyle-first', name: 'Self Reflection', emoji: '\u{1F6A9}', description: 'Add your first lifestyle item', rarity: 'common' },
  { id: 'haram-avoid-1', name: 'First Step', emoji: '\u{1F6D1}', description: 'Master avoiding one haram thing', rarity: 'rare' },
  { id: 'haram-avoid-3', name: 'Purifying', emoji: '\u{1F31F}', description: 'Master avoiding 3 haram things', rarity: 'epic' },
  { id: 'haram-avoid-5', name: 'Taqwa', emoji: '\u{2728}', description: 'Master avoiding 5 haram things', rarity: 'epic' },
  { id: 'haram-avoid-10', name: 'God-Conscious', emoji: '\u{1F54C}', description: 'Master avoiding 10 haram things', rarity: 'legendary' },
  { id: 'halal-consist-1', name: 'Good Start', emoji: '\u2705', description: 'Become consistent in one halal practice', rarity: 'rare' },
  { id: 'halal-consist-3', name: 'Righteous Path', emoji: '\u{1F31F}', description: 'Become consistent in 3 halal practices', rarity: 'epic' },
  { id: 'halal-consist-5', name: 'Ihsan', emoji: '\u{1F48E}', description: 'Become consistent in 5 halal practices', rarity: 'epic' },
  { id: 'halal-consist-10', name: 'Walking the Siraat', emoji: '\u{1F319}', description: 'Become consistent in 10 halal practices', rarity: 'legendary' },
  { id: 'lifestyle-10', name: 'Lifestyle Auditor', emoji: '\u{1F4CB}', description: 'Track 10 lifestyle items total', rarity: 'rare' },

  // Deep knowledge (late)
  { id: 'notes-100', name: 'Scholar', emoji: '\u{1F9D1}\u200D\u{1F393}', description: 'Add 100 knowledge entries', rarity: 'epic' },
  { id: 'topics-10', name: 'Encyclopaedist', emoji: '\u{1F4DA}', description: 'Create 10 knowledge topics', rarity: 'epic' },
  { id: 'notes-250', name: 'Walking Library', emoji: '\u{1F3DB}', description: 'Add 250 knowledge entries', rarity: 'legendary' },
  { id: 'notes-500', name: 'Alim', emoji: '\u{1F4D6}', description: 'Add 500 knowledge entries', rarity: 'legendary' },
  { id: 'topics-20', name: 'Mufassir', emoji: '\u{1F30D}', description: 'Create 20 knowledge topics', rarity: 'legendary' },
];

export function getBadgeDef(id: string): BadgeDef | undefined {
  return BADGES.find(b => b.id === id);
}

export interface BadgeCheckContext {
  profile: GamificationProfile;
  task: Pick<Task, 'category' | 'priority'>;
  completionsToday: number;
  hourOfDay: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
  // Extended context for 100 badges
  totalHabits: number;
  totalGoalsCreated: number;
  totalGoalsCompleted: number;
  totalHighPriorityCompleted: number;
  completedHabitToday: boolean;
  completedTaskToday: boolean;
  completedGoalToday: boolean;
  allHabitsDoneToday: boolean;
  goalCategories: number; // distinct goal tag count
  daysSinceFirstUse: number;
  hadPriorStreak: boolean; // true if they broke a streak before this one
  // Islamic context
  knowledgeEntries: number;
  knowledgeTopics: number;
  lifestyleHaramMastered: number;
  lifestyleHalalConsistent: number;
  lifestyleTotal: number;
  prayerHabitsCompleted: number; // prayer-related habits done today
}

export function checkNewBadges(ctx: BadgeCheckContext): string[] {
  const earned = new Set(ctx.profile.badges);
  const newBadges: string[] = [];

  const check = (id: string, condition: boolean) => {
    if (!earned.has(id) && condition) newBadges.push(id);
  };

  const t = ctx.profile.totalTasksCompleted;
  const s = ctx.profile.currentStreak;
  const lv = ctx.profile.level;
  const xp = ctx.profile.totalXp;
  const badges = ctx.profile.badges.length;

  // ── EARLY GAME (common) ──
  check('first-blood', t >= 1);
  check('getting-started', t >= 3);
  check('on-a-roll', t >= 5);
  check('task-10', t >= 10);
  check('task-25', t >= 25);
  check('streak-2', s >= 2);
  check('streak-3', s >= 3);
  check('streak-5', s >= 5);
  check('hat-trick', ctx.completionsToday >= 3);
  check('busy-day', ctx.completionsToday >= 5);
  check('early-bird', ctx.hourOfDay < 9);
  check('night-owl', ctx.hourOfDay >= 22);
  check('habit-starter', ctx.totalHabits >= 1);
  check('routine-builder', ctx.totalHabits >= 3);
  check('all-habits', ctx.allHabitsDoneToday && ctx.totalHabits >= 1);
  check('dreamer', ctx.totalGoalsCreated >= 1);
  check('goal-setter', ctx.totalGoalsCreated >= 3);
  check('level-2', lv >= 2);
  check('level-3', lv >= 3);
  check('level-5', lv >= 5);
  check('xp-50', xp >= 50);
  check('xp-100', xp >= 100);
  check('xp-250', xp >= 250);
  check('high-priority', ctx.task.priority === 'high' || ctx.totalHighPriorityCompleted >= 1);
  check('all-priorities', ctx.totalHighPriorityCompleted >= 1); // simplified: checked alongside other priorities tracked by total
  check('multitasker', ctx.completedHabitToday && ctx.completedTaskToday && ctx.completedGoalToday);
  check('weekend-warrior', ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6);
  check('monday-motivation', ctx.dayOfWeek === 1);
  check('five-in-a-row', ctx.completionsToday >= 5);
  check('first-week', ctx.daysSinceFirstUse >= 7);

  // ── MID GAME (rare) ──
  check('task-50', t >= 50);
  check('century', t >= 100);
  check('task-200', t >= 200);
  check('task-500', t >= 500);
  check('streak-7', s >= 7);
  check('streak-10', s >= 10);
  check('streak-14', s >= 14);
  check('streak-21', s >= 21);
  check('power-day', ctx.completionsToday >= 7);
  check('ten-a-day', ctx.completionsToday >= 10);
  check('goal-getter', ctx.task.category === 'goal' || ctx.totalGoalsCompleted >= 1);
  check('goal-3', ctx.totalGoalsCompleted >= 3);
  check('goal-5', ctx.totalGoalsCompleted >= 5);
  check('habits-5', ctx.totalHabits >= 5);
  check('perfect-week', s >= 7 && ctx.allHabitsDoneToday);
  check('habit-streak-14', s >= 14 && ctx.allHabitsDoneToday);
  check('level-7', lv >= 7);
  check('level-10', lv >= 10);
  check('xp-500', xp >= 500);
  check('xp-1000', xp >= 1000);
  check('xp-2500', xp >= 2500);
  check('early-week', ctx.hourOfDay < 7);
  check('lunch-hustler', ctx.hourOfDay >= 12 && ctx.hourOfDay < 13);
  check('comeback-kid', ctx.hadPriorStreak && s >= 1);
  check('badge-10', badges + newBadges.length >= 10);
  check('badge-25', badges + newBadges.length >= 25);
  check('categories-3', ctx.goalCategories >= 3);
  check('full-day', ctx.completedHabitToday && ctx.completedTaskToday);
  check('first-month', ctx.daysSinceFirstUse >= 30);

  // ── LATE GAME (epic) ──
  check('task-1000', t >= 1000);
  check('task-2500', t >= 2500);
  check('streak-30', s >= 30);
  check('streak-60', s >= 60);
  check('streak-90', s >= 90);
  check('goal-10', ctx.totalGoalsCompleted >= 10);
  check('goal-25', ctx.totalGoalsCompleted >= 25);
  check('power-15', ctx.completionsToday >= 15);
  check('level-15', lv >= 15);
  check('level-20', lv >= 20);
  check('xp-5000', xp >= 5000);
  check('xp-10000', xp >= 10000);
  check('habits-10', ctx.totalHabits >= 10);
  check('perfect-month', s >= 30 && ctx.allHabitsDoneToday);
  check('badge-50', badges + newBadges.length >= 50);
  check('multiplier-max', s >= 14);
  check('categories-5', ctx.goalCategories >= 5);
  check('weekday-streak-20', s >= 20);
  check('high-priority-10', ctx.totalHighPriorityCompleted >= 10);
  check('high-priority-50', ctx.totalHighPriorityCompleted >= 50);
  check('three-months', ctx.daysSinceFirstUse >= 90);
  check('night-shift', ctx.hourOfDay >= 0 && ctx.hourOfDay < 4);
  check('dawn-warrior', ctx.hourOfDay < 6);

  // ── ENDGAME (legendary) ──
  check('task-5000', t >= 5000);
  check('task-10000', t >= 10000);
  check('streak-100', s >= 100);
  check('streak-200', s >= 200);
  check('streak-365', s >= 365);
  check('level-30', lv >= 30);
  check('level-50', lv >= 50);
  check('xp-25000', xp >= 25000);
  check('xp-100000', xp >= 100000);
  check('goal-50', ctx.totalGoalsCompleted >= 50);
  check('goal-100', ctx.totalGoalsCompleted >= 100);
  check('badge-75', badges + newBadges.length >= 75);
  check('badge-100', badges + newBadges.length >= 100);
  check('year-member', ctx.daysSinceFirstUse >= 365);
  check('perfect-quarter', s >= 90 && ctx.allHabitsDoneToday);
  check('streak-500', s >= 500);
  check('xp-50000', xp >= 50000);

  // ── ISLAMIC ──
  // Knowledge
  check('first-note', ctx.knowledgeEntries >= 1);
  check('notes-5', ctx.knowledgeEntries >= 5);
  check('notes-10', ctx.knowledgeEntries >= 10);
  check('notes-25', ctx.knowledgeEntries >= 25);
  check('notes-50', ctx.knowledgeEntries >= 50);
  check('notes-100', ctx.knowledgeEntries >= 100);
  check('notes-250', ctx.knowledgeEntries >= 250);
  check('notes-500', ctx.knowledgeEntries >= 500);
  check('first-topic', ctx.knowledgeTopics >= 1);
  check('topics-3', ctx.knowledgeTopics >= 3);
  check('topics-5', ctx.knowledgeTopics >= 5);
  check('topics-10', ctx.knowledgeTopics >= 10);
  check('topics-20', ctx.knowledgeTopics >= 20);

  // Prayer
  check('first-prayer-habit', ctx.prayerHabitsCompleted >= 1);
  check('five-prayers', ctx.prayerHabitsCompleted >= 5);

  // Lifestyle
  check('lifestyle-first', ctx.lifestyleTotal >= 1);
  check('lifestyle-10', ctx.lifestyleTotal >= 10);
  check('haram-avoid-1', ctx.lifestyleHaramMastered >= 1);
  check('haram-avoid-3', ctx.lifestyleHaramMastered >= 3);
  check('haram-avoid-5', ctx.lifestyleHaramMastered >= 5);
  check('haram-avoid-10', ctx.lifestyleHaramMastered >= 10);
  check('halal-consist-1', ctx.lifestyleHalalConsistent >= 1);
  check('halal-consist-3', ctx.lifestyleHalalConsistent >= 3);
  check('halal-consist-5', ctx.lifestyleHalalConsistent >= 5);
  check('halal-consist-10', ctx.lifestyleHalalConsistent >= 10);

  return newBadges;
}

// ── Default profile ──

/** Build extended context from task list for badge checking. */
export function buildCompletionContext(
  tasks: Pick<Task, 'category' | 'completed' | 'completedAt' | 'priority' | 'goalTag' | 'createdAt' | 'title'>[],
  _goalTags: string[] | undefined,
  todayStr: string,
  profile: GamificationProfile,
  islamic?: { knowledgeEntries: number; knowledgeTopics: number; lifestyleHaramMastered: number; lifestyleHalalConsistent: number; lifestyleTotal: number },
): CompletionContext {
  const dailyHabits = tasks.filter(t => isHabitCategory(t.category));
  const allHabitsDone = dailyHabits.length > 0 && dailyHabits.every(t => t.completed);
  const completedToday = tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr));

  const first = tasks.reduce<string | null>((e, t) => (!e || t.createdAt < e) ? t.createdAt : e, null);
  const daysSince = first ? Math.max(0, Math.ceil((Date.now() - new Date(first).getTime()) / 86400000)) : 0;

  const uniqueGoalTags = new Set(tasks.filter(t => t.category === 'goal' && t.goalTag).map(t => t.goalTag));

  // Count prayer-related habits completed today
  const prayerHabitsCompleted = completedToday.filter(task => isPrayerTask(task)).length;

  return {
    totalHabits: dailyHabits.length,
    totalGoalsCreated: tasks.filter(t => t.category === 'goal').length,
    totalGoalsCompleted: tasks.filter(t => t.category === 'goal' && t.completed).length,
    totalHighPriorityCompleted: tasks.filter(t => t.priority === 'high' && t.completed).length,
    completedHabitToday: completedToday.some(t => isHabitCategory(t.category)),
    completedTaskToday: completedToday.some(t => t.category === 'task'),
    completedGoalToday: completedToday.some(t => t.category === 'goal'),
    allHabitsDoneToday: allHabitsDone,
    goalCategories: uniqueGoalTags.size,
    daysSinceFirstUse: daysSince,
    hadPriorStreak: profile.longestStreak > profile.currentStreak,
    knowledgeEntries: islamic?.knowledgeEntries ?? 0,
    knowledgeTopics: islamic?.knowledgeTopics ?? 0,
    lifestyleHaramMastered: islamic?.lifestyleHaramMastered ?? 0,
    lifestyleHalalConsistent: islamic?.lifestyleHalalConsistent ?? 0,
    lifestyleTotal: islamic?.lifestyleTotal ?? 0,
    prayerHabitsCompleted,
  };
}

export const DEFAULT_PROFILE: GamificationProfile = {
  totalXp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  totalTasksCompleted: 0,
  badges: [],
  habitTallies: {},
  dailyLog: {},
};

/** Record a habit completion in the profile tallies. */
export function recordHabitCompletion(
  profile: GamificationProfile,
  taskId: string,
  dateStr: string,
): GamificationProfile {
  const tallies = { ...(profile.habitTallies || {}) };
  tallies[taskId] = (tallies[taskId] || 0) + 1;

  const log = { ...(profile.dailyLog || {}) };
  const dayLog = log[dateStr] || [];
  if (!dayLog.includes(taskId)) {
    log[dateStr] = [...dayLog, taskId];
  }

  return { ...profile, habitTallies: tallies, dailyLog: log };
}

/**
 * Backfill or correct a prayer entry in the daily log for a past date.
 * Does NOT award XP, streak, or badges — purely a log correction for accurate stats.
 */
export function backfillPrayerLog(
  profile: GamificationProfile,
  taskId: string,
  dateStr: string,
  completed: boolean,
): GamificationProfile {
  const log = { ...(profile.dailyLog || {}) };
  const dayLog = [...(log[dateStr] || [])];

  if (completed) {
    if (!dayLog.includes(taskId)) {
      dayLog.push(taskId);
    }
  } else {
    const idx = dayLog.indexOf(taskId);
    if (idx !== -1) {
      dayLog.splice(idx, 1);
    }
  }

  if (dayLog.length > 0) {
    log[dateStr] = dayLog;
  } else {
    delete log[dateStr];
  }

  return { ...profile, dailyLog: log };
}

/** Calculate prayer completion stats from daily log. */
export interface PrayerStatsSummary {
  completed: number;
  total: number;
  percentage: number;
}

export interface PrayerStatsPerPrayer extends PrayerStatsSummary {
  name: string;
}

export interface PrayerStatsPeriod {
  month: string;
  label: string;
  trackedDays: number;
  overall: PrayerStatsSummary;
  perPrayer: PrayerStatsPerPrayer[];
}

export interface PrayerStatsResult {
  overall: PrayerStatsSummary;
  perPrayer: PrayerStatsPerPrayer[];
  trackedDays: number;
  last30Days: { date: string; count: number }[];
  currentMonth: PrayerStatsPeriod;
  monthlyHistory: PrayerStatsPeriod[];
}

type PrayerStatsTask = {
  id: string;
  title: string;
  category: string;
  prayerName?: string;
  createdAt?: string;
};

function buildPrayerStatsPeriod(
  prayerHabits: Pick<PrayerStatsTask, 'id' | 'title' | 'prayerName'>[],
  log: Record<string, string[]>,
  dates: string[],
  month: string,
  label: string,
): PrayerStatsPeriod {
  const trackedDays = dates.length;
  const perPrayer = prayerHabits.map(habit => {
    const prayerName = habit.prayerName || habit.title;
    const completed = dates.filter(date => log[date]?.includes(habit.id)).length;

    return {
      name: prayerName.charAt(0).toUpperCase() + prayerName.slice(1),
      completed,
      total: trackedDays,
      percentage: trackedDays > 0 ? Math.round((completed / trackedDays) * 100) : 0,
    };
  });

  const totalPossible = prayerHabits.length * trackedDays;
  const totalCompleted = perPrayer.reduce((sum, prayer) => sum + prayer.completed, 0);

  return {
    month,
    label,
    trackedDays,
    overall: {
      completed: totalCompleted,
      total: totalPossible,
      percentage: totalPossible > 0 ? Math.round((totalCompleted / totalPossible) * 100) : 0,
    },
    perPrayer,
  };
}

function getPrayerStatsActiveStart(
  prayerHabits: Pick<PrayerStatsTask, 'id' | 'createdAt'>[],
  log: Record<string, string[]>,
): string | null {
  const prayerHabitIds = new Set(prayerHabits.map(habit => habit.id));
  const taskStartDates = prayerHabits
    .map(habit => habit.createdAt ? toLocalDateStrFromIso(habit.createdAt) : null)
    .filter((date): date is string => Boolean(date));
  const loggedPrayerDates = Object.entries(log)
    .filter(([, taskIds]) => taskIds.some(taskId => prayerHabitIds.has(taskId)))
    .map(([date]) => date)
    .filter(date => parseLocalDateStr(date) !== null);
  const candidateDates = [...taskStartDates, ...loggedPrayerDates].sort();
  return candidateDates[0] || null;
}

function buildPrayerStatsDates(
  activeStartDate: string | null,
  referenceDateStr: string,
  month?: string,
): string[] {
  if (!activeStartDate) return [];

  const monthStart = month ? `${month}-01` : activeStartDate;
  const monthEnd = month ? getMonthEndDateStr(month) : referenceDateStr;
  const start = maxLocalDateStr(activeStartDate, monthStart);
  const end = minLocalDateStr(referenceDateStr, monthEnd);
  return enumerateLocalDateRange(start, end);
}

export function calculatePrayerStats(
  profile: GamificationProfile,
  tasks: PrayerStatsTask[],
  referenceDate: Date = new Date(),
): PrayerStatsResult {
  const prayerHabits = tasks.filter(task => isPrayerTask(task as Pick<Task, 'category' | 'title' | 'prayerName'>));
  const currentMonthKey = toMonthStr(referenceDate);
  const currentMonthLabel = formatMonthLabel(currentMonthKey);
  const emptyCurrentMonth: PrayerStatsPeriod = {
    month: currentMonthKey,
    label: currentMonthLabel,
    trackedDays: 0,
    overall: { completed: 0, total: 0, percentage: 0 },
    perPrayer: [],
  };

  if (prayerHabits.length === 0) {
    return {
      overall: { completed: 0, total: 0, percentage: 0 },
      perPrayer: [],
      trackedDays: 0,
      last30Days: [],
      currentMonth: emptyCurrentMonth,
      monthlyHistory: [emptyCurrentMonth],
    };
  }

  const log = profile.dailyLog || {};
  const referenceDateStr = toLocalDateStr(referenceDate);
  const activeStartDate = getPrayerStatsActiveStart(prayerHabits, log);
  const dates = buildPrayerStatsDates(activeStartDate, referenceDateStr);
  const allTime = buildPrayerStatsPeriod(prayerHabits, log, dates, 'all-time', 'All time');
  const currentMonthDates = buildPrayerStatsDates(activeStartDate, referenceDateStr, currentMonthKey);
  const currentMonth = buildPrayerStatsPeriod(prayerHabits, log, currentMonthDates, currentMonthKey, currentMonthLabel);

  const activeMonthKeys = activeStartDate
    ? enumerateMonthKeys(activeStartDate.slice(0, 7), currentMonthKey)
    : [];
  const monthKeys = Array.from(new Set([...activeMonthKeys, currentMonthKey]))
    .sort((left, right) => right.localeCompare(left));
  const monthlyHistory = monthKeys.map(month =>
    buildPrayerStatsPeriod(
      prayerHabits,
      log,
      buildPrayerStatsDates(activeStartDate, referenceDateStr, month),
      month,
      formatMonthLabel(month),
    )
  );

  // Last 30 days
  const last30Days: { date: string; count: number }[] = [];
  const baseDate = new Date(referenceDate);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayEntries = log[dateStr] || [];
    const count = prayerHabits.filter(h => dayEntries.includes(h.id)).length;
    last30Days.push({ date: dateStr, count });
  }

  return {
    overall: allTime.overall,
    perPrayer: allTime.perPrayer,
    trackedDays: allTime.trackedDays,
    last30Days,
    currentMonth,
    monthlyHistory,
  };
}

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

export interface CompletionContext {
  totalHabits: number;
  totalGoalsCreated: number;
  totalGoalsCompleted: number;
  totalHighPriorityCompleted: number;
  completedHabitToday: boolean;
  completedTaskToday: boolean;
  completedGoalToday: boolean;
  allHabitsDoneToday: boolean;
  goalCategories: number;
  daysSinceFirstUse: number;
  hadPriorStreak: boolean;
  // Islamic
  knowledgeEntries: number;
  knowledgeTopics: number;
  lifestyleHaramMastered: number;
  lifestyleHalalConsistent: number;
  lifestyleTotal: number;
  prayerHabitsCompleted: number;
}

export function processTaskCompletion(
  profile: GamificationProfile,
  task: Pick<Task, 'priority' | 'category'>,
  completionsToday: number,
  now: Date = new Date(),
  extCtx?: Partial<CompletionContext>,
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
    dayOfWeek: now.getDay(),
    totalHabits: extCtx?.totalHabits ?? 0,
    totalGoalsCreated: extCtx?.totalGoalsCreated ?? 0,
    totalGoalsCompleted: extCtx?.totalGoalsCompleted ?? (task.category === 'goal' ? 1 : 0),
    totalHighPriorityCompleted: extCtx?.totalHighPriorityCompleted ?? (task.priority === 'high' ? 1 : 0),
    completedHabitToday: extCtx?.completedHabitToday ?? isHabitCategory(task.category),
    completedTaskToday: extCtx?.completedTaskToday ?? task.category === 'task',
    completedGoalToday: extCtx?.completedGoalToday ?? task.category === 'goal',
    allHabitsDoneToday: extCtx?.allHabitsDoneToday ?? false,
    goalCategories: extCtx?.goalCategories ?? 0,
    daysSinceFirstUse: extCtx?.daysSinceFirstUse ?? 0,
    hadPriorStreak: extCtx?.hadPriorStreak ?? (profile.longestStreak > 0 && profile.currentStreak <= 1),
    knowledgeEntries: extCtx?.knowledgeEntries ?? 0,
    knowledgeTopics: extCtx?.knowledgeTopics ?? 0,
    lifestyleHaramMastered: extCtx?.lifestyleHaramMastered ?? 0,
    lifestyleHalalConsistent: extCtx?.lifestyleHalalConsistent ?? 0,
    lifestyleTotal: extCtx?.lifestyleTotal ?? 0,
    prayerHabitsCompleted: extCtx?.prayerHabitsCompleted ?? 0,
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
