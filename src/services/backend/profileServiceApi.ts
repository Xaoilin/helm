/**
 * Typed calls to the profile service (`/api/profile/v1`): account-wide settings such as location,
 * app preferences, integration records, and the operational-event collector.
 */
import { PROFILE_BACKEND_URL } from '../../config';
import { newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import {
  appPreferencesSchema,
  globalSettingsSchema,
  integrationSchema,
  integrationsSchema,
  type ServiceAppPreferences,
  type ServiceGlobalSettings,
  type ServiceIntegration,
} from './contracts';

const SETTINGS = '/api/profile/v1/settings';
const PREFERENCES = '/api/profile/v1/preferences';
const INTEGRATIONS = '/api/profile/v1/integrations';
export const OPERATIONAL_EVENTS_PATH = '/api/profile/v1/operational-events';

export type AppPreferencesInput = Omit<ServiceAppPreferences, 'updatedAt'>;
export type IntegrationInput = Pick<ServiceIntegration, 'status' | 'configuredAt' | 'lastError'>;

export function isProfileServiceEnabled(): boolean {
  return Boolean(PROFILE_BACKEND_URL.trim());
}

export function getGlobalSettings(): Promise<ServiceGlobalSettings> {
  return callService(PROFILE_BACKEND_URL, 'GET', SETTINGS, globalSettingsSchema);
}

export function saveGlobalSettings(
  settings: Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>,
): Promise<ServiceGlobalSettings> {
  return callService(PROFILE_BACKEND_URL, 'PUT', SETTINGS, globalSettingsSchema, settings,
    { idempotencyKey: newWriteKey() });
}

export function getAppPreferences(): Promise<ServiceAppPreferences> {
  return callService(PROFILE_BACKEND_URL, 'GET', PREFERENCES, appPreferencesSchema);
}

export function saveAppPreferences(preferences: AppPreferencesInput): Promise<ServiceAppPreferences> {
  return callService(PROFILE_BACKEND_URL, 'PUT', PREFERENCES, appPreferencesSchema, preferences,
    { idempotencyKey: newWriteKey() });
}

export async function getIntegrations(): Promise<ServiceIntegration[]> {
  return (await callService(PROFILE_BACKEND_URL, 'GET', INTEGRATIONS, integrationsSchema)).integrations;
}

export function saveIntegration(provider: string, integration: IntegrationInput): Promise<ServiceIntegration> {
  return callService(PROFILE_BACKEND_URL, 'PUT', `${INTEGRATIONS}/${encodeURIComponent(provider)}`,
    integrationSchema, integration, { idempotencyKey: newWriteKey() });
}

/** Where operational events go, or null when the profile service is not configured. */
export function operationalEventsUrl(): string | null {
  const base = PROFILE_BACKEND_URL.trim().replace(/\/+$/u, '');
  return base ? `${base}${OPERATIONAL_EVENTS_PATH}` : null;
}
