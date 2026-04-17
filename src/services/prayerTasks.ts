import type { PrayerName, Task, TaskCategory } from '../types/domain';
import type { PrayerTime } from './prayerTimes';

export const PRAYER_TASK_ORDER: PrayerName[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

const PRAYER_TITLE_PATTERNS: Record<PrayerName, RegExp> = {
  Fajr: /\bfajr\b/i,
  Dhuhr: /\bdhuhr\b/i,
  Asr: /\basr\b/i,
  Maghrib: /\bmaghrib\b/i,
  Isha: /\bisha\b/i,
};

const PRAYER_WINDOW_ENDS: Record<PrayerName, string> = {
  Fajr: 'Sunrise',
  Dhuhr: 'Asr',
  Asr: 'Sunset',
  Maghrib: 'Isha',
  Isha: 'Midnight',
};

export interface PrayerWindow {
  prayerName: PrayerName;
  startsAt: Date;
  endsAt: Date;
  minutesRemaining: number;
}

function parseTimeOnDate(baseDate: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const next = new Date(baseDate);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

export function inferPrayerNameFromTaskTitle(title: string): PrayerName | null {
  const normalized = title.trim();
  if (!normalized) return null;

  for (const prayerName of PRAYER_TASK_ORDER) {
    if (PRAYER_TITLE_PATTERNS[prayerName].test(normalized)) {
      return prayerName;
    }
  }

  return null;
}

export function getPrayerTaskName(task: Pick<Task, 'category' | 'title' | 'prayerName'>): PrayerName | null {
  if (task.prayerName) return task.prayerName;
  if (task.category !== 'prayer' && task.category !== 'daily') return null;
  return inferPrayerNameFromTaskTitle(task.title);
}

export function getPrayerTaskTitle(prayerName: PrayerName): string {
  return `${prayerName} Prayer`;
}

export function isPrayerTask(task: Pick<Task, 'category' | 'title' | 'prayerName'>): boolean {
  return task.category === 'prayer' || getPrayerTaskName(task) !== null;
}

export function isHabitCategory(category: TaskCategory): boolean {
  return category === 'daily' || category === 'prayer';
}

export function isHabitTask(task: Pick<Task, 'category'>): boolean {
  return isHabitCategory(task.category);
}

export function isStandardDailyTask(task: Pick<Task, 'category'>): boolean {
  return task.category === 'daily';
}

export function comparePrayerTasks(left: Pick<Task, 'title' | 'prayerName' | 'category'>, right: Pick<Task, 'title' | 'prayerName' | 'category'>): number {
  const leftPrayer = getPrayerTaskName(left);
  const rightPrayer = getPrayerTaskName(right);
  const leftIndex = leftPrayer ? PRAYER_TASK_ORDER.indexOf(leftPrayer) : Number.MAX_SAFE_INTEGER;
  const rightIndex = rightPrayer ? PRAYER_TASK_ORDER.indexOf(rightPrayer) : Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex || left.title.localeCompare(right.title);
}

export function getPrayerWindow(
  prayers: PrayerTime[],
  prayerName: PrayerName,
  now: Date,
): PrayerWindow | null {
  const startEntry = prayers.find(prayer => prayer.name === prayerName);
  const endEntry = prayers.find(prayer => prayer.name === PRAYER_WINDOW_ENDS[prayerName]);

  if (!startEntry || !endEntry) return null;

  const startsAt = parseTimeOnDate(now, startEntry.time);
  const endsAt = parseTimeOnDate(now, endEntry.time);
  if (endsAt <= startsAt) {
    endsAt.setDate(endsAt.getDate() + 1);
  }

  if (now < startsAt || now >= endsAt) {
    return null;
  }

  return {
    prayerName,
    startsAt,
    endsAt,
    minutesRemaining: Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 60000)),
  };
}

export function getActivePrayerWindow(prayers: PrayerTime[], now: Date): PrayerWindow | null {
  for (const prayerName of PRAYER_TASK_ORDER) {
    const window = getPrayerWindow(prayers, prayerName, now);
    if (window) return window;
  }

  return null;
}

export function getRemainingPrayerNames(prayers: PrayerTime[], now: Date): PrayerName[] {
  return PRAYER_TASK_ORDER.filter(prayerName => {
    const startEntry = prayers.find(prayer => prayer.name === prayerName);
    const endEntry = prayers.find(prayer => prayer.name === PRAYER_WINDOW_ENDS[prayerName]);
    if (!startEntry || !endEntry) return false;

    const endsAt = parseTimeOnDate(now, endEntry.time);
    const startsAt = parseTimeOnDate(now, startEntry.time);
    if (endsAt <= startsAt) {
      endsAt.setDate(endsAt.getDate() + 1);
    }

    return now < endsAt;
  });
}
