import {
  getZonedDate,
  validateIanaTimeZone,
} from './timeZone';

export type AppTimeZoneSource = 'preference' | 'automatic' | 'utc-fallback';

export interface AppTimeZoneResolution {
  preferredTimeZone?: string;
  browserTimeZone: string;
  effectiveTimeZone: string;
  source: AppTimeZoneSource;
  invalidPreference?: string;
}

export function getBrowserTimeZone(): string {
  try {
    return validateIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return '';
  }
}

export function resolveAppTimeZone(
  preference: unknown,
  browserTimeZone: string = getBrowserTimeZone(),
): AppTimeZoneResolution {
  const rawPreference = typeof preference === 'string' ? preference.trim() : '';
  const preferredTimeZone = validateIanaTimeZone(rawPreference);
  const automaticTimeZone = validateIanaTimeZone(browserTimeZone);

  if (preferredTimeZone) {
    return {
      preferredTimeZone,
      browserTimeZone: automaticTimeZone,
      effectiveTimeZone: preferredTimeZone,
      source: 'preference',
    };
  }
  if (automaticTimeZone) {
    return {
      browserTimeZone: automaticTimeZone,
      effectiveTimeZone: automaticTimeZone,
      source: 'automatic',
      ...(rawPreference ? { invalidPreference: rawPreference } : {}),
    };
  }
  return {
    browserTimeZone: '',
    effectiveTimeZone: 'UTC',
    source: 'utc-fallback',
    ...(rawPreference ? { invalidPreference: rawPreference } : {}),
  };
}

export function getSupportedIanaTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

export function formatAppDate(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!Number.isFinite(instant.getTime()) || !validateIanaTimeZone(timeZone)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options,
    }).format(instant);
  } catch {
    return '—';
  }
}

export function formatAppTime(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!Number.isFinite(instant.getTime()) || !validateIanaTimeZone(timeZone)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(instant);
  } catch {
    return '—';
  }
}

export function getAppDate(instant: Date, timeZone: string): string | null {
  return getZonedDate(instant, timeZone);
}
