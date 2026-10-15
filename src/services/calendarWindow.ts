/** Date-only markers use UTC arithmetic, independent of the browser's zone and DST. */
export interface CalendarWindow { from: string; to: string }
export type CalendarView = 'week' | 'month' | 'agenda' | 'accounts';

export function calendarWindow(date: string, view: CalendarView): CalendarWindow {
  const marker = new Date(`${date}T00:00:00Z`);
  if (view === 'month') marker.setUTCDate(1);
  if (view === 'week' || view === 'month') marker.setUTCDate(marker.getUTCDate() - marker.getUTCDay());
  const end = new Date(marker);
  const days = view === 'month' ? 42 : view === 'week' ? 7 : view === 'agenda' ? 30 : 1;
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { from: marker.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** The mobile day panel must never describe a date outside the window that was read. */
export function calendarSelectedDate(date: string, view: CalendarView, selected: string): string {
  if (view !== 'week' && view !== 'month') return selected;
  const window = calendarWindow(date, view);
  return selected < window.from || selected > window.to ? date : selected;
}
