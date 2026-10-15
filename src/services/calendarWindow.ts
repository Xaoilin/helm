/** Date-only markers use UTC arithmetic, independent of the browser's zone and DST. */
export interface CalendarWindow { from: string; to: string }

export function calendarWindow(date: string, view: 'week' | 'month' | 'agenda' | 'accounts'): CalendarWindow {
  const marker = new Date(`${date}T00:00:00Z`);
  if (view === 'month') marker.setUTCDate(1);
  if (view === 'week' || view === 'month') marker.setUTCDate(marker.getUTCDate() - marker.getUTCDay());
  const end = new Date(marker);
  const days = view === 'month' ? 42 : view === 'week' ? 7 : view === 'agenda' ? 30 : 1;
  end.setUTCDate(end.getUTCDate() + days - 1);
  return { from: marker.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
