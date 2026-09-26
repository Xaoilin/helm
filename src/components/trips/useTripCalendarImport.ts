import { useState } from 'react';
import { pickDefaultCalendarSource, resolveCalendarImportRange, type CalendarImportTarget } from '../../services/tripCalendarImport';
import { useCalendar } from '../../store/contexts/CalendarContext';

/** State for copying one trip plan or booking into a Calendar source. */
export function useTripCalendarImport() {
  const { calendarAccounts, calendarSources, addCalendarEvent } = useCalendar();
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

  function confirm(): void {
    if (!target || !sourceId) return;
    const range = resolveCalendarImportRange(target);
    if (!range) {
      setNotice('The calendar dates are invalid.');
      return;
    }
    addCalendarEvent({
      sourceId,
      title: target.title,
      description: target.description,
      start: range.start,
      end: range.end,
      allDay: target.allDay,
      location: target.location,
    });
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
