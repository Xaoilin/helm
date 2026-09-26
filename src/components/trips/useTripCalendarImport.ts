import { useState } from 'react';
import { pickDefaultCalendarSource, resolveCalendarImportRange, type CalendarImportTarget } from '../../services/tripCalendarImport';
import { calendarErrorMessage, useCalendar } from '../../store/contexts/CalendarContext';

/** State for copying one trip plan or booking into a Calendar source. */
export function useTripCalendarImport() {
  const { calendarAccounts, calendarSources: allSources, addCalendarEvent } = useCalendar();
  // Read-only Google calendars cannot take new events.
  const calendarSources = allSources.filter(source => source.writable !== false);
  const [target, setTarget] = useState<CalendarImportTarget | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function open(nextTarget: CalendarImportTarget): void {
    if (calendarSources.length === 0) {
      setNotice('Add a calendar source first, then you can import trip items into Calendar.');
      return;
    }
    setNotice(null);
    setTarget(nextTarget);
    setSourceId(pickDefaultCalendarSource(calendarAccounts, calendarSources)?.id || '');
  }

  async function confirm(): Promise<void> {
    if (!target || !sourceId) return;
    const range = resolveCalendarImportRange(target);
    if (!range) {
      setNotice('The calendar dates are invalid.');
      return;
    }
    try {
      // Written to Google too when the chosen calendar is a Google calendar.
      await addCalendarEvent({
        sourceId,
        title: target.title,
        description: target.description,
        start: range.start,
        end: range.end,
        allDay: target.allDay,
        location: target.location,
      });
    } catch (error) {
      setNotice(`The trip item was not added to Calendar: ${calendarErrorMessage(error)}`);
      return;
    }
    setTarget(null);
  }

  return {
    sources: calendarSources,
    target,
    sourceId,
    notice,
    open,
    confirm,
    close: () => setTarget(null),
    selectSource: setSourceId,
  };
}

export type TripCalendarImport = ReturnType<typeof useTripCalendarImport>;
