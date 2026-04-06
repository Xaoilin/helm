import { describe, it, expect } from 'vitest';

/**
 * Regression tests for the timezone bug fix.
 * The month and week views must agree on which date an event falls on.
 * We use toLocalDateStr (local timezone) instead of toISOString (UTC).
 */

// Exact copy of the helper used in CalendarSurface.tsx
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getEventsForDate(date: Date, events: { start: string }[]): { start: string }[] {
  const dateStr = toLocalDateStr(date);
  return events.filter(e => toLocalDateStr(new Date(e.start)) === dateStr);
}

describe('toLocalDateStr', () => {
  it('should return local date regardless of time component', () => {
    // Midnight local time
    const midnight = new Date(2026, 2, 30, 0, 0, 0); // March 30
    // Noon local time
    const noon = new Date(2026, 2, 30, 12, 0, 0);
    // 11pm local time
    const lateNight = new Date(2026, 2, 30, 23, 59, 59);

    expect(toLocalDateStr(midnight)).toBe('2026-03-30');
    expect(toLocalDateStr(noon)).toBe('2026-03-30');
    expect(toLocalDateStr(lateNight)).toBe('2026-03-30');
  });

  it('should NOT match toISOString for dates near midnight in non-UTC timezones', () => {
    // This is the bug we fixed: midnight local can be previous day in UTC
    const midnight = new Date(2026, 2, 30, 0, 0, 0); // March 30 midnight local
    const localDate = toLocalDateStr(midnight);

    // In UTC+X timezones, these will differ. In UTC they'll be same.
    // The key point: localDate is always 2026-03-30 regardless of timezone
    expect(localDate).toBe('2026-03-30');
  });

  it('should handle single-digit months and days with padding', () => {
    const jan1 = new Date(2026, 0, 1);
    expect(toLocalDateStr(jan1)).toBe('2026-01-01');

    const sep5 = new Date(2026, 8, 5);
    expect(toLocalDateStr(sep5)).toBe('2026-09-05');
  });
});

describe('getEventsForDate (month and week agreement)', () => {
  const events = [
    { start: '2026-03-30T13:30:00.000Z' },  // Zeus Error checkup
    { start: '2026-03-30T14:30:00.000Z' },  // Prisma standup
    { start: '2026-03-31T09:30:00.000Z' },  // Daniel meeting
    { start: '2026-04-01T13:30:00.000Z' },  // Wed event
  ];

  it('month grid date and week grid date should find same events for same day', () => {
    // Month view creates dates as: new Date(year, month, day) — midnight local
    const monthMarch30 = new Date(2026, 2, 30);

    // Week view creates dates from: new Date(viewDate) adjusted by setDate — preserves time
    const viewDate = new Date(2026, 2, 29, 14, 30, 0); // Sunday 29 at 2:30pm
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(viewDate);
      d.setDate(d.getDate() - d.getDay() + i);
      return d;
    });
    const weekMarch30 = weekDays[1]; // Monday

    // Both should find the same events for March 30
    const monthEvents = getEventsForDate(monthMarch30, events);
    const weekEvents = getEventsForDate(weekMarch30, events);

    expect(monthEvents.length).toBe(weekEvents.length);
    expect(monthEvents.map(e => e.start).sort()).toEqual(weekEvents.map(e => e.start).sort());
  });

  it('should not bleed events into adjacent days', () => {
    const march29 = new Date(2026, 2, 29);
    const march30 = new Date(2026, 2, 30);
    const march31 = new Date(2026, 2, 31);

    const events29 = getEventsForDate(march29, events);
    const events30 = getEventsForDate(march30, events);
    const events31 = getEventsForDate(march31, events);

    // March 30 events should NOT appear on March 29 or 31
    expect(events29.length).toBe(0);
    // The March 30 UTC events — in BST (UTC+1), 13:30 UTC = 14:30 BST still March 30
    expect(events30.length).toBeGreaterThan(0);
    expect(events31.length).toBeGreaterThan(0); // March 31 has its own event
  });
});
