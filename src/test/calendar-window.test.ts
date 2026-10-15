import { expect, it } from 'vitest';
import { calendarSelectedDate, calendarWindow } from '../services/calendarWindow';

it('covers the visible week, complete six-row month, paged agenda and metadata consumers across year/DST boundaries', () => {
  expect(calendarWindow('2026-09-08', 'week')).toEqual({ from: '2026-09-06', to: '2026-09-12' });
  expect(calendarWindow('2026-09-08', 'month')).toEqual({ from: '2026-08-30', to: '2026-10-10' });
  expect(calendarWindow('2026-12-31', 'agenda')).toEqual({ from: '2026-12-31', to: '2027-01-29' });
  expect(calendarWindow('2026-10-25', 'week')).toEqual({ from: '2026-10-25', to: '2026-10-31' });
  expect(calendarWindow('2026-09-08', 'accounts')).toEqual({ from: '2026-09-08', to: '2026-09-08' });
});

it('keeps the selected day inside requested week/month dates while preserving an in-window choice', () => {
  expect(calendarSelectedDate('2026-09-15', 'week', '2026-09-08')).toBe('2026-09-15');
  expect(calendarSelectedDate('2026-09-15', 'week', '2026-09-16')).toBe('2026-09-16');
  expect(calendarSelectedDate('2026-10-01', 'month', '2026-09-08')).toBe('2026-10-01');
  expect(calendarSelectedDate('2026-10-01', 'month', '2026-09-30')).toBe('2026-09-30');
  expect(calendarSelectedDate('2026-10-01', 'accounts', '2026-09-08')).toBe('2026-09-08');
});
