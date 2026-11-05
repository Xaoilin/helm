/** Owner-selected competition start; historical wins before this date do not count. */
export const PRAYER_COMPETITION_RECORD = {
  startsOn: '2026-11-01',
  concurrentReads: 3,
} as const;

/** Owner-selected challenge points; separate from planner XP. */
export const PRAYER_TIMING_POINTS = { prompt: 12, within_window: 8, outside_window: 2 } as const;
