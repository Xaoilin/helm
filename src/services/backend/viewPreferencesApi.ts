import { PROFILE_BACKEND_URL } from '../../config';
import type { ViewPreferenceKey } from '../../config/viewPreferences';
import { newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import { viewPreferenceSchema, viewPreferencesSchema } from './viewPreferenceContracts';

const BASE = '/api/profile/v1/view-preferences';

export function getViewPreferences() {
  return callService(PROFILE_BACKEND_URL, 'GET', BASE, viewPreferencesSchema);
}

/** Each write changes one choice, so another device's unrelated choices remain intact. */
export function saveViewPreference(key: ViewPreferenceKey, value: string) {
  return callService(PROFILE_BACKEND_URL, 'PUT', `${BASE}/${encodeURIComponent(key)}`,
    viewPreferenceSchema, { value }, { idempotencyKey: newWriteKey() });
}
