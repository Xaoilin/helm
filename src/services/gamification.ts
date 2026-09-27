/**
 * What the app shows of progress: level maths, titles, streak milestones and the badge catalogue (names
 * and pictures). XP, streaks and badges are worked out by the planner service, never here.
 */

import type { GamificationProfile } from '../types/domain';

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
  { id: 'first-week', name: 'First Week', emoji: '\u{1F4C5}', description: 'Use Sabah One for 7 days', rarity: 'common' },

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
  { id: 'first-month', name: 'Monthly Member', emoji: '\u{1F4C6}', description: 'Use Sabah One for 30 days', rarity: 'rare' },

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
  { id: 'three-months', name: 'Quarterly Review', emoji: '\u{1F4CA}', description: 'Use Sabah One for 90 days', rarity: 'epic' },
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
  { id: 'year-member', name: 'Founding Member', emoji: '\u{1F3F5}', description: 'Use Sabah One for 365 days', rarity: 'legendary' },
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

// ── Default profile ──

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

/** What one rewarded completion earned, as the celebration shows it. */
export interface CompletionResult {
  xpEarned: number;
  newLevel: number;
  leveledUp: boolean;
  newTitle: string;
  newBadges: BadgeDef[];
  streakCurrent: number;
  isStreakMilestone: boolean;
}
