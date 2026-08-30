import { getAppDate } from './appTimeZone';
import { validateIanaTimeZone } from './timeZone';

export interface TaskCompletionStamp {
  completedAt: string;
  completedLocalDate: string;
  completionTimeZone: string;
}

export function createTaskCompletionStamp(
  completedAt: Date | string,
  timeZone: string,
): TaskCompletionStamp {
  const instant = completedAt instanceof Date ? completedAt : new Date(completedAt);
  const normalizedTimeZone = validateIanaTimeZone(timeZone);
  const completedLocalDate = normalizedTimeZone ? getAppDate(instant, normalizedTimeZone) : null;
  if (!Number.isFinite(instant.getTime()) || !normalizedTimeZone || !completedLocalDate) {
    throw new RangeError('Task completion needs a valid instant and IANA time zone.');
  }
  return {
    completedAt: instant.toISOString(),
    completedLocalDate,
    completionTimeZone: normalizedTimeZone,
  };
}
