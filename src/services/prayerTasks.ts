import type { PrayerName, Task, TaskCategory } from '../types/domain';
import type { PrayerTime } from './prayerTimes';
import {
  getPrayerZonedDate,
  prayerZonedDateTimeToInstant,
  shiftPrayerDate,
} from './prayerTimeZone';

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
  Asr: 'Maghrib',
  Maghrib: 'Isha',
  Isha: 'Midnight',
};

export interface PrayerWindow {
  prayerName: PrayerName;
  startsAt: Date;
  endsAt: Date;
  minutesRemaining: number;
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
  timeZone: string,
): PrayerWindow | null {
  const startEntry = prayers.find(prayer => prayer.name === prayerName);
  const endEntry = prayers.find(prayer => prayer.name === PRAYER_WINDOW_ENDS[prayerName]);

  if (!startEntry || !endEntry) return null;

  const date = getPrayerZonedDate(now, timeZone);
  if (!date) return null;
  const startsAt = prayerZonedDateTimeToInstant(date, startEntry.time, timeZone);
  let endsAt = prayerZonedDateTimeToInstant(date, endEntry.time, timeZone);
  if (!startsAt || !endsAt) return null;
  if (endsAt <= startsAt) {
    if (PRAYER_WINDOW_ENDS[prayerName] !== 'Midnight') return null;
    const nextDate = shiftPrayerDate(date, 1);
    endsAt = nextDate ? prayerZonedDateTimeToInstant(nextDate, endEntry.time, timeZone) : null;
    if (!endsAt || endsAt <= startsAt) return null;
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

export function getActivePrayerWindow(
  prayers: PrayerTime[],
  now: Date,
  timeZone: string,
): PrayerWindow | null {
  for (const prayerName of PRAYER_TASK_ORDER) {
    const window = getPrayerWindow(prayers, prayerName, now, timeZone);
    if (window) return window;
  }

  return null;
}

export function getRemainingPrayerNames(
  prayers: PrayerTime[],
  now: Date,
  timeZone: string,
): PrayerName[] {
  const date = getPrayerZonedDate(now, timeZone);
  if (!date) return [];
  return PRAYER_TASK_ORDER.filter(prayerName => {
    const startEntry = prayers.find(prayer => prayer.name === prayerName);
    const endEntry = prayers.find(prayer => prayer.name === PRAYER_WINDOW_ENDS[prayerName]);
    if (!startEntry || !endEntry) return false;

    const startsAt = prayerZonedDateTimeToInstant(date, startEntry.time, timeZone);
    let endsAt = prayerZonedDateTimeToInstant(date, endEntry.time, timeZone);
    if (!startsAt || !endsAt) return false;
    if (endsAt <= startsAt) {
      if (PRAYER_WINDOW_ENDS[prayerName] !== 'Midnight') return false;
      const nextDate = shiftPrayerDate(date, 1);
      endsAt = nextDate ? prayerZonedDateTimeToInstant(nextDate, endEntry.time, timeZone) : null;
      if (!endsAt || endsAt <= startsAt) return false;
    }

    return now < endsAt;
  });
}
