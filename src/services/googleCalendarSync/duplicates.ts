/**
 * Removes duplicate calendar sources that share the same googleCalendarId across accounts.
 * Keeps the source belonging to the earliest account (by calendarAccounts array order).
 * Re-attributes events from removed sources to the surviving source.
 */
export function cleanupDuplicateSources(app: {
  calendarAccounts: { id: string }[];
  calendarSources: { id: string; accountId: string; googleCalendarId?: string }[];
  calendarEvents: { id: string; sourceId: string }[];
  removeCalendarSource: (id: string) => void;
  updateCalendarEvent: (id: string, updates: { sourceId: string }) => void;
}) {
  const accountOrder = new Map(app.calendarAccounts.map((account, index) => [account.id, index]));
  const byGoogleCalendarId = new Map<string, typeof app.calendarSources>();

  for (const source of app.calendarSources) {
    if (!source.googleCalendarId) continue;
    const group = byGoogleCalendarId.get(source.googleCalendarId) || [];
    group.push(source);
    byGoogleCalendarId.set(source.googleCalendarId, group);
  }

  for (const [, group] of byGoogleCalendarId) {
    if (group.length <= 1) continue;

    group.sort((left, right) => (accountOrder.get(left.accountId) ?? 999) - (accountOrder.get(right.accountId) ?? 999));
    const keeper = group[0];
    const duplicates = group.slice(1);

    for (const duplicate of duplicates) {
      for (const event of app.calendarEvents) {
        if (event.sourceId === duplicate.id) {
          app.updateCalendarEvent(event.id, { sourceId: keeper.id });
        }
      }
      app.removeCalendarSource(duplicate.id);
    }
  }
}

/**
 * Remove duplicate events that share the same googleEventId.
 * Keeps the first occurrence (by insertion order) and removes the rest.
 */
export function cleanupDuplicateEvents(app: {
  calendarEvents: { id: string; googleEventId?: string }[];
  removeCalendarEvent: (id: string) => void;
}) {
  const seen = new Set<string>();
  for (const event of app.calendarEvents) {
    if (!event.googleEventId) continue;
    if (seen.has(event.googleEventId)) {
      app.removeCalendarEvent(event.id);
    } else {
      seen.add(event.googleEventId);
    }
  }
}
