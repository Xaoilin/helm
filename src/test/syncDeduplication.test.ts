import { describe, it, expect } from 'vitest';
import type { CalendarSource, CalendarAccount, CalendarEvent } from '../types/domain';

/**
 * Tests for the sync deduplication logic.
 * These test the pure logic that the useGoogleSync hook uses
 * to prevent duplicate calendar sources across accounts.
 */

// Simulate the deduplication logic extracted from useGoogleSync
function shouldSkipCalendar(
  googleCalendarId: string,
  currentAccountId: string,
  allSources: CalendarSource[],
): boolean {
  return allSources.some(
    s => s.googleCalendarId === googleCalendarId && s.accountId !== currentAccountId
  );
}

function getSourcesForAccount(
  accountId: string,
  allSources: CalendarSource[],
): CalendarSource[] {
  return allSources.filter(s => s.accountId === accountId);
}

// Simulate color palette assignment (same logic as CalendarSurface)
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

describe('Sync deduplication', () => {
  const sources: CalendarSource[] = [
    { id: 'src1', accountId: 'acc-work', name: 'Work', color: '#4285f4', visible: true, googleCalendarId: 'work@gmail.com' },
    { id: 'src2', accountId: 'acc-work', name: 'Holidays', color: '#33b679', visible: true, googleCalendarId: 'holidays@google.com' },
    { id: 'src3', accountId: 'acc-lina', name: 'Lina Personal', color: '#e67c73', visible: true, googleCalendarId: 'lina@gmail.com' },
    { id: 'src4', accountId: 'acc-lina', name: 'Lina Maths', color: '#7986cb', visible: true, googleCalendarId: 'maths-class@google.com' },
  ];

  describe('shouldSkipCalendar', () => {
    it('should not skip a calendar unique to the current account', () => {
      expect(shouldSkipCalendar('work@gmail.com', 'acc-work', sources)).toBe(false);
    });

    it('should skip a calendar that already exists under another account', () => {
      // If acc-personal tries to add a source for "maths-class@google.com" which belongs to acc-lina
      expect(shouldSkipCalendar('maths-class@google.com', 'acc-personal', sources)).toBe(true);
    });

    it('should not skip if the calendar belongs to the same account', () => {
      expect(shouldSkipCalendar('maths-class@google.com', 'acc-lina', sources)).toBe(false);
    });

    it('should not skip a completely new calendar', () => {
      expect(shouldSkipCalendar('brand-new@google.com', 'acc-work', sources)).toBe(false);
    });
  });

  describe('getSourcesForAccount', () => {
    it('should return only sources for the given account', () => {
      const workSources = getSourcesForAccount('acc-work', sources);
      expect(workSources).toHaveLength(2);
      expect(workSources.every(s => s.accountId === 'acc-work')).toBe(true);
    });

    it('should return empty for unknown account', () => {
      expect(getSourcesForAccount('acc-unknown', sources)).toHaveLength(0);
    });
  });
});

describe('Account color mapping', () => {
  const accounts: CalendarAccount[] = [
    { id: 'acc-work', name: 'Work', email: 'work@co.com', provider: 'google', isPrimary: true, connected: true, mocked: false },
    { id: 'acc-personal', name: 'Personal', email: 'me@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
    { id: 'acc-lina', name: 'Lina', email: 'lina@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
  ];

  const sources: CalendarSource[] = [
    { id: 'src1', accountId: 'acc-work', name: 'Work Cal', color: '#4285f4', visible: true, googleCalendarId: 'work@co.com' },
    { id: 'src2', accountId: 'acc-personal', name: 'My Cal', color: '#e67c73', visible: true, googleCalendarId: 'me@gmail.com' },
    { id: 'src3', accountId: 'acc-lina', name: 'Lina Cal', color: '#33b679', visible: true, googleCalendarId: 'lina@gmail.com' },
    { id: 'src4', accountId: 'acc-lina', name: 'Maths', color: '#7986cb', visible: true, googleCalendarId: 'maths@google.com' },
  ];

  it('should assign blue to first account (work)', () => {
    const palette = getEventPalette('src1', sources, accounts);
    expect(palette.border).toBe('#3b82f6'); // blue
  });

  it('should assign purple to second account (personal)', () => {
    const palette = getEventPalette('src2', sources, accounts);
    expect(palette.border).toBe('#a855f7'); // purple
  });

  it('should assign green to third account (lina)', () => {
    const palette = getEventPalette('src3', sources, accounts);
    expect(palette.border).toBe('#22c55e'); // green
  });

  it('should assign same color to different sources in same account', () => {
    const palette3 = getEventPalette('src3', sources, accounts);
    const palette4 = getEventPalette('src4', sources, accounts);
    expect(palette3.border).toBe(palette4.border); // both green (lina)
  });

  it('should NOT assign same color to sources from different accounts', () => {
    const work = getEventPalette('src1', sources, accounts);
    const lina = getEventPalette('src3', sources, accounts);
    expect(work.border).not.toBe(lina.border);
  });
});

describe('Source reassignment changes event color', () => {
  const accounts: CalendarAccount[] = [
    { id: 'acc-work', name: 'Work', email: 'work@co.com', provider: 'google', isPrimary: true, connected: true, mocked: false },
    { id: 'acc-personal', name: 'Personal', email: 'me@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
    { id: 'acc-lina', name: 'Lina', email: 'lina@gmail.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
  ];

  it('should change event color when source is moved to a different account', () => {
    // Source starts under personal account (purple)
    const sources: CalendarSource[] = [
      { id: 'src-maths', accountId: 'acc-personal', name: 'Maths', color: '#7986cb', visible: true, googleCalendarId: 'me@gmail.com' },
    ];

    const beforePalette = getEventPalette('src-maths', sources, accounts);
    expect(beforePalette.border).toBe('#a855f7'); // purple (personal)

    // Reassign source to Lina's account
    sources[0] = { ...sources[0], accountId: 'acc-lina' };

    const afterPalette = getEventPalette('src-maths', sources, accounts);
    expect(afterPalette.border).toBe('#22c55e'); // green (lina)
  });

  it('all events on a reassigned source inherit the new account color', () => {
    const sources: CalendarSource[] = [
      { id: 'src-a', accountId: 'acc-work', name: 'Cal A', color: '#f00', visible: true },
      { id: 'src-b', accountId: 'acc-personal', name: 'Cal B', color: '#0f0', visible: true },
    ];
    const events: CalendarEvent[] = [
      { id: 'ev1', sourceId: 'src-b', title: 'Maths class', description: '', start: '2026-04-01T18:00:00Z', end: '2026-04-01T20:00:00Z', allDay: false },
      { id: 'ev2', sourceId: 'src-b', title: 'ESOL', description: '', start: '2026-04-01T18:30:00Z', end: '2026-04-01T20:30:00Z', allDay: false },
    ];

    // Before reassignment: both events are purple (personal)
    for (const evt of events) {
      expect(getEventPalette(evt.sourceId, sources, accounts).border).toBe('#a855f7');
    }

    // Move src-b to Lina
    sources[1] = { ...sources[1], accountId: 'acc-lina' };

    // After reassignment: both events are green (lina)
    for (const evt of events) {
      expect(getEventPalette(evt.sourceId, sources, accounts).border).toBe('#22c55e');
    }
  });
});

describe('Event-to-account tracing', () => {
  it('should trace event -> source -> account correctly', () => {
    const accounts: CalendarAccount[] = [
      { id: 'acc-a', name: 'A', email: 'a@test.com', provider: 'google', isPrimary: true, connected: true, mocked: false },
      { id: 'acc-b', name: 'B', email: 'b@test.com', provider: 'google', isPrimary: false, connected: true, mocked: false },
    ];
    const sources: CalendarSource[] = [
      { id: 'src-a1', accountId: 'acc-a', name: 'Cal A', color: '#f00', visible: true, googleCalendarId: 'cal-a' },
      { id: 'src-b1', accountId: 'acc-b', name: 'Cal B', color: '#0f0', visible: true, googleCalendarId: 'cal-b' },
    ];
    const events: CalendarEvent[] = [
      { id: 'ev1', sourceId: 'src-a1', title: 'Meeting', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false, googleEventId: 'gev1' },
      { id: 'ev2', sourceId: 'src-b1', title: 'Class', description: '', start: '2026-03-30T18:00:00Z', end: '2026-03-30T19:00:00Z', allDay: false, googleEventId: 'gev2' },
    ];

    // Event ev1 -> source src-a1 -> account acc-a -> palette index 0 (blue)
    const ev1Source = sources.find(s => s.id === events[0].sourceId)!;
    const ev1AccIdx = accounts.findIndex(a => a.id === ev1Source.accountId);
    expect(ev1AccIdx).toBe(0);

    // Event ev2 -> source src-b1 -> account acc-b -> palette index 1 (purple)
    const ev2Source = sources.find(s => s.id === events[1].sourceId)!;
    const ev2AccIdx = accounts.findIndex(a => a.id === ev2Source.accountId);
    expect(ev2AccIdx).toBe(1);

    // Different accounts = different palette indices
    expect(ev1AccIdx).not.toBe(ev2AccIdx);
  });
});
