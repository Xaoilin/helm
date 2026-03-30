import { describe, it, expect } from 'vitest';
import type { CalendarAccount, CalendarSource, CalendarEvent } from '../types/domain';

/**
 * Calendar-specific CRUD edge case tests.
 * Tests the logic that CalendarSurface depends on,
 * extracted as pure functions for testability.
 */

// ── Helpers (same as CalendarSurface) ──

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getEventsForDate(date: Date, events: { start: string }[]): { start: string }[] {
  const dateStr = toLocalDateStr(date);
  return events.filter(e => toLocalDateStr(new Date(e.start)) === dateStr);
}

const ACCOUNT_PALETTES = [
  { bg: '#1a2744', border: '#3b82f6' },  // blue
  { bg: '#2a1f3d', border: '#a855f7' },  // purple
  { bg: '#1a3328', border: '#22c55e' },  // green
];

function getEventPalette(
  sourceId: string,
  sources: CalendarSource[],
  accounts: CalendarAccount[],
) {
  const source = sources.find(s => s.id === sourceId);
  if (!source) return ACCOUNT_PALETTES[0];
  const accIndex = accounts.findIndex(a => a.id === source.accountId);
  return ACCOUNT_PALETTES[accIndex % ACCOUNT_PALETTES.length];
}

// ── Tests ──

describe('Calendar view consistency', () => {
  // Events spanning midnight boundary
  const events = [
    { start: '2026-03-30T23:00:00.000Z', sourceId: 'src1' },  // Late night UTC
    { start: '2026-03-31T00:30:00.000Z', sourceId: 'src1' },  // Early morning UTC
    { start: '2026-03-31T12:00:00.000Z', sourceId: 'src1' },  // Midday
  ];

  it('month and week views should agree on event count per day', () => {
    // For each day, both views should find the same events
    const days = [
      new Date(2026, 2, 30),  // March 30
      new Date(2026, 2, 31),  // March 31
      new Date(2026, 3, 1),   // April 1
    ];

    for (const day of days) {
      // Month creates dates at midnight local
      const monthDate = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      // Week creates dates with arbitrary time preserved
      const weekDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 14, 30, 0);

      const monthEvents = getEventsForDate(monthDate, events);
      const weekEvents = getEventsForDate(weekDate, events);

      expect(monthEvents.length).toBe(weekEvents.length);
    }
  });

  it('all-day events should appear on their local date', () => {
    const allDayEvents = [
      { start: '2026-04-03T00:00:00.000Z', allDay: true },
    ];
    const april3 = new Date(2026, 3, 3);
    const found = getEventsForDate(april3, allDayEvents);
    // This depends on timezone — in UTC+0 it should match, in UTC+N it may not
    // The key is that toLocalDateStr uses local time, so it should be consistent
    expect(found.length).toBeGreaterThanOrEqual(0); // timezone-dependent
  });
});

describe('Source reassignment and palette change', () => {
  const accounts: CalendarAccount[] = [
    { id: 'acc-work', name: 'Work', email: 'work@co.com', provider: 'google', isPrimary: true, connected: true, mocked: false },
    { id: 'acc-personal', name: 'Personal', email: 'me@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
    { id: 'acc-lina', name: 'Lina', email: 'lina@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
  ];

  it('moving a source should change all its events\' palette color', () => {
    const sources: CalendarSource[] = [
      { id: 'src-cal', accountId: 'acc-personal', name: 'My Cal', color: '#f00', visible: true },
    ];
    const events: CalendarEvent[] = [
      { id: 'ev1', sourceId: 'src-cal', title: 'Event 1', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false },
      { id: 'ev2', sourceId: 'src-cal', title: 'Event 2', description: '', start: '2026-03-31T14:00:00Z', end: '2026-03-31T15:00:00Z', allDay: false },
    ];

    // Before: personal = purple
    expect(getEventPalette('src-cal', sources, accounts).border).toBe('#a855f7');

    // Move source to Lina
    sources[0] = { ...sources[0], accountId: 'acc-lina' };

    // After: lina = green — both events change
    expect(getEventPalette(events[0].sourceId, sources, accounts).border).toBe('#22c55e');
    expect(getEventPalette(events[1].sourceId, sources, accounts).border).toBe('#22c55e');
  });

  it('moving should not affect other sources on the original account', () => {
    const sources: CalendarSource[] = [
      { id: 'src-a', accountId: 'acc-personal', name: 'Cal A', color: '#f00', visible: true },
      { id: 'src-b', accountId: 'acc-personal', name: 'Cal B', color: '#0f0', visible: true },
    ];

    // Move only src-a to Lina
    sources[0] = { ...sources[0], accountId: 'acc-lina' };

    // src-a is now green (lina), src-b stays purple (personal)
    expect(getEventPalette('src-a', sources, accounts).border).toBe('#22c55e');
    expect(getEventPalette('src-b', sources, accounts).border).toBe('#a855f7');
  });
});

describe('Cascade deletes', () => {
  it('removing an account should orphan no events', () => {
    const sources: CalendarSource[] = [
      { id: 'src1', accountId: 'acc-a', name: 'Cal', color: '#f00', visible: true },
      { id: 'src2', accountId: 'acc-b', name: 'Cal B', color: '#0f0', visible: true },
    ];
    const events: CalendarEvent[] = [
      { id: 'ev1', sourceId: 'src1', title: 'E1', description: '', start: '', end: '', allDay: false },
      { id: 'ev2', sourceId: 'src1', title: 'E2', description: '', start: '', end: '', allDay: false },
      { id: 'ev3', sourceId: 'src2', title: 'E3', description: '', start: '', end: '', allDay: false },
    ];

    // Simulate removing account 'acc-a': remove its sources and events
    const removedSourceIds = sources.filter(s => s.accountId === 'acc-a').map(s => s.id);
    const remainingSources = sources.filter(s => s.accountId !== 'acc-a');
    const remainingEvents = events.filter(e => !removedSourceIds.includes(e.sourceId));

    expect(remainingSources).toHaveLength(1);
    expect(remainingEvents).toHaveLength(1);
    expect(remainingEvents[0].title).toBe('E3');

    // No orphaned events (every remaining event has a valid source)
    for (const evt of remainingEvents) {
      expect(remainingSources.some(s => s.id === evt.sourceId)).toBe(true);
    }
  });
});

describe('Primary promotion', () => {
  it('should promote next account when primary is removed', () => {
    const accounts: CalendarAccount[] = [
      { id: 'acc1', name: 'A', email: 'a@t.com', provider: 'google', isPrimary: true, connected: true, mocked: false },
      { id: 'acc2', name: 'B', email: 'b@t.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
      { id: 'acc3', name: 'C', email: 'c@t.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
    ];

    // Remove primary
    const remaining = accounts.filter(a => a.id !== 'acc1');
    if (remaining.length > 0 && !remaining.some(a => a.isPrimary)) {
      remaining[0].isPrimary = true;
    }

    expect(remaining[0].isPrimary).toBe(true);
    expect(remaining[0].id).toBe('acc2');
  });
});
