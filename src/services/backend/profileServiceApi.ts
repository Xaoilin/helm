/** Typed calls to the profile service (`/api/profile/v1`): account-wide settings such as location. */
import { PROFILE_BACKEND_URL } from '../../config';
import { newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import { globalSettingsSchema, type ServiceGlobalSettings } from './contracts';

const SETTINGS = '/api/profile/v1/settings';

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
