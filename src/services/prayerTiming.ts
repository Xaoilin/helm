import { PRAYER_TIMING_POINTS } from '../config/prayerCompetition';
import type { PrayerCompletionStatus, PrayerOutcomeStatus, PrayerTiming } from '../types/domain';

export const PRAYER_TIMING_CHOICES = [
  { timing: 'prompt', status: 'on_time', label: 'Prayed promptly', shortLabel: 'Prompt', description: 'Within 15 minutes of the adhan', icon: '✦' },
  { timing: 'within_window', status: 'on_time', label: 'Prayed within the time window', shortLabel: 'Within time', description: 'Later, before the window ended', icon: '✓' },
  { timing: 'outside_window', status: 'late', label: 'Prayed outside the time window', shortLabel: 'Outside time', description: 'After the window ended', icon: '◷' },
] as const;

export function isPrayerTiming(value: unknown): value is PrayerTiming {
  return value === 'prompt' || value === 'within_window' || value === 'outside_window';
}

export function prayerTimingStatus(timing: PrayerTiming): PrayerCompletionStatus {
  return timing === 'outside_window' ? 'late' : 'on_time';
}

export function defaultPrayerTiming(status: PrayerOutcomeStatus): PrayerTiming | undefined {
  return status === 'on_time' ? 'within_window' : status === 'late' ? 'outside_window' : undefined;
}

export function prayerTimingMatches(status: PrayerOutcomeStatus, timing: PrayerTiming): boolean {
  return status === prayerTimingStatus(timing);
}

export function prayerTimingPoints(timing: PrayerTiming): number {
  return PRAYER_TIMING_POINTS[timing];
}
