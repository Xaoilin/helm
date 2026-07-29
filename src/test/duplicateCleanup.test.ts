// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { cleanupDuplicateSources } from '../hooks/useGoogleSync';

describe('cleanupDuplicateSources', () => {
  function makeApp(
    accounts: { id: string }[],
    sources: { id: string; accountId: string; googleCalendarId?: string }[],
    events: { id: string; sourceId: string }[],
  ) {
    return {
      calendarAccounts: accounts,
      calendarSources: [...sources],
      calendarEvents: [...events],
      removeCalendarSource: vi.fn((id: string) => {
        const idx = sources.findIndex(s => s.id === id);
        if (idx >= 0) sources.splice(idx, 1);
      }),
      updateCalendarEvent: vi.fn(),
    };
  }

  it('should not touch sources with unique googleCalendarIds', () => {
    const app = makeApp(
      [{ id: 'acc1' }, { id: 'acc2' }],
      [
        { id: 'src1', accountId: 'acc1', googleCalendarId: 'cal-a' },
        { id: 'src2', accountId: 'acc2', googleCalendarId: 'cal-b' },
      ],
      [],
    );
    cleanupDuplicateSources(app);
    expect(app.removeCalendarSource).not.toHaveBeenCalled();
  });

  it('should remove duplicate source, keeping the one from the earliest account', () => {
    const app = makeApp(
      [{ id: 'acc1' }, { id: 'acc2' }],
      [
        { id: 'src1', accountId: 'acc1', googleCalendarId: 'holidays' },
        { id: 'src2', accountId: 'acc2', googleCalendarId: 'holidays' },
      ],
      [],
    );
    cleanupDuplicateSources(app);
    expect(app.removeCalendarSource).toHaveBeenCalledWith('src2');
    expect(app.removeCalendarSource).toHaveBeenCalledTimes(1);
  });

  it('should keep the source from the earlier account even if created later', () => {
    const app = makeApp(
      [{ id: 'acc-work' }, { id: 'acc-personal' }, { id: 'acc-lina' }],
      [
        { id: 'src-lina-family', accountId: 'acc-lina', googleCalendarId: 'family-cal' },
        { id: 'src-personal-family', accountId: 'acc-personal', googleCalendarId: 'family-cal' },
      ],
      [],
    );
    cleanupDuplicateSources(app);
    // acc-personal is index 1, acc-lina is index 2 — personal wins (earlier)
    expect(app.removeCalendarSource).toHaveBeenCalledWith('src-lina-family');
  });

  it('should re-attribute events from removed source to surviving source', () => {
    const events = [
      { id: 'ev1', sourceId: 'src2' },
      { id: 'ev2', sourceId: 'src2' },
      { id: 'ev3', sourceId: 'src1' },
    ];
    const app = makeApp(
      [{ id: 'acc1' }, { id: 'acc2' }],
      [
        { id: 'src1', accountId: 'acc1', googleCalendarId: 'shared-cal' },
        { id: 'src2', accountId: 'acc2', googleCalendarId: 'shared-cal' },
      ],
      events,
    );
    cleanupDuplicateSources(app);

    // Events on src2 should be moved to src1
    expect(app.updateCalendarEvent).toHaveBeenCalledWith('ev1', { sourceId: 'src1' });
    expect(app.updateCalendarEvent).toHaveBeenCalledWith('ev2', { sourceId: 'src1' });
    // ev3 is already on src1, should not be touched
    expect(app.updateCalendarEvent).not.toHaveBeenCalledWith('ev3', expect.anything());
  });

  it('should handle 3 duplicates across 3 accounts — keep only the earliest', () => {
    const app = makeApp(
      [{ id: 'acc1' }, { id: 'acc2' }, { id: 'acc3' }],
      [
        { id: 'src1', accountId: 'acc1', googleCalendarId: 'holidays' },
        { id: 'src2', accountId: 'acc2', googleCalendarId: 'holidays' },
        { id: 'src3', accountId: 'acc3', googleCalendarId: 'holidays' },
      ],
      [],
    );
    cleanupDuplicateSources(app);
    expect(app.removeCalendarSource).toHaveBeenCalledWith('src2');
    expect(app.removeCalendarSource).toHaveBeenCalledWith('src3');
    expect(app.removeCalendarSource).toHaveBeenCalledTimes(2);
  });

  it('should skip sources without googleCalendarId (local calendars)', () => {
    const app = makeApp(
      [{ id: 'acc1' }],
      [
        { id: 'src1', accountId: 'acc1' },  // no googleCalendarId
        { id: 'src2', accountId: 'acc1' },  // no googleCalendarId
      ],
      [],
    );
    cleanupDuplicateSources(app);
    expect(app.removeCalendarSource).not.toHaveBeenCalled();
  });

  it('should be idempotent — running twice on cleaned data has no effect', () => {
    // After cleanup, only src1 remains — no duplicates
    const accounts = [{ id: 'acc1' }, { id: 'acc2' }];
    const cleanSources = [
      { id: 'src1', accountId: 'acc1', googleCalendarId: 'shared' },
      // src2 was already removed by previous cleanup
    ];
    const app = makeApp(accounts, cleanSources, []);

    cleanupDuplicateSources(app);
    expect(app.removeCalendarSource).not.toHaveBeenCalled();
  });
});
