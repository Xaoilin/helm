/**
 * Settings split by owner. Settings shared across devices belong to the Spring services (prayer
 * preferences to the prayer service; location, display time zone and app preferences to the profile
 * service). The few device-only settings stay in this browser's local storage and nowhere else.
 */
import type { Settings } from '../types/domain';
import { validateIanaTimeZone } from '../services/timeZone';
import { logWarn } from '../services/logger';

const DEVICE_SETTING_FIELDS = [
  'googleOAuthClientId',
  'supabaseAnonKey',
  'supabaseUrl',
] as const satisfies readonly (keyof Settings)[];

type DeviceSettings = Pick<Settings, (typeof DEVICE_SETTING_FIELDS)[number]>;

/** Settings owned by the Spring services: loaded from, and saved to, their service. */
const SERVICE_SETTING_FIELDS = [
  'theme',
  'dataRetentionDays',
  'telemetry',
  'defaultCalendarTab',
  'goalTags',
  'prayerEnabled',
  'prayerReminderEnabled',
  'prayerReminderMinutes',
  'prayerCity',
  'prayerCountry',
  'appTimezone',
] as const satisfies readonly (keyof Settings)[];

type ServiceSettings = Pick<Settings, (typeof SERVICE_SETTING_FIELDS)[number]>;

const DEVICE_SETTING_FIELD_SET = new Set<string>(DEVICE_SETTING_FIELDS);
const SERVICE_SETTING_FIELD_SET = new Set<string>(SERVICE_SETTING_FIELDS);

/**
 * Plaintext provider keys from old builds and settings of the removed Life Hero, Lina assistant and
 * voice features. Stored browser copies may still carry them; they are dropped, never read or written.
 */
const RETIRED_SETTING_FIELDS = new Set<string>([
  'deepgramApiKey',
  'elevenLabsApiKey',
  'monzoAccessToken',
  'lifeHeroEnabled',
  'assistantEnabled',
  'assistantLanguage',
  'assistantProvider',
  'hostedModel',
  'elevenLabsVoiceId',
  'elevenLabsSecretId',
  'wakeWordEnabled',
  'microphoneDeviceId',
  'ollamaEndpoint',
  'ollamaModel',
]);

/** Current device-settings key; new writes contain only nonsecret device preferences. */
const DEVICE_SETTINGS_KEY = 'helm:device:deviceSettings:v2';
/** The original device-settings key, read once as a fallback and left unchanged. */
const LEGACY_DEVICE_SETTINGS_KEY = 'helm:device:deviceSettings';
const RETIRED_DASHBOARD_CACHE_KEYS = ['helm:dashboardFocusCache:v1', 'helm:dashboardFocusHostedReview:v1'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Splits settings into the device-only fields and the fields a service owns; anything else is dropped. */
export function splitSettings(value: unknown): { device: DeviceSettings; service: Partial<ServiceSettings> } {
  const device: DeviceSettings = {};
  const service: Partial<ServiceSettings> = {};
  if (!isRecord(value)) return { device, service };

  for (const [key, entry] of Object.entries(value)) {
    if (RETIRED_SETTING_FIELDS.has(key)) continue;
    if (DEVICE_SETTING_FIELD_SET.has(key)) {
      (device as Record<string, unknown>)[key] = entry;
    } else if (key === 'appTimezone') {
      const timeZone = validateIanaTimeZone(entry);
      if (timeZone) service.appTimezone = timeZone;
    } else if (SERVICE_SETTING_FIELD_SET.has(key)) {
      (service as Record<string, unknown>)[key] = entry;
    }
  }
  return { device, service };
}

/** This browser's device-only settings; empty when none are stored or storage is unavailable. */
export function loadDeviceSettings(): DeviceSettings {
  try {
    const raw = localStorage.getItem(DEVICE_SETTINGS_KEY) ?? localStorage.getItem(LEGACY_DEVICE_SETTINGS_KEY);
    return raw === null ? {} : splitSettings(JSON.parse(raw)).device;
  } catch {
    logWarn('DeviceSettings', 'Device settings could not be read in this browser.');
    return {};
  }
}

export function saveDeviceSettings(value: unknown): void {
  try {
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(splitSettings(value).device));
  } catch {
    logWarn('DeviceSettings', 'Device settings could not be saved in this browser.');
  }
}

/** Retire only the old recommendation caches; never read or migrate their contents. */
export function clearRetiredDashboardCaches(): void {
  for (const key of RETIRED_DASHBOARD_CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      logWarn('DeviceSettings', 'Retired dashboard cache cleanup is unavailable in this browser.');
    }
  }
}
