import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { preferencesSchema } from '../../src/services/backend/contracts';

export interface FixtureCleanupReceipt {
  authRemoved: boolean;
  authAbsenceConfirmed: boolean;
  clientRemoved: boolean;
  serviceWorkStopped: boolean;
  confirmed: boolean;
}

export interface FixtureCleanupOptions {
  admin: SupabaseClient['auth']['admin'];
  fixtureId?: string;
  directToken?: string;
  oauthClientId?: string;
  prayerBaseUrl: string;
  fetcher: typeof fetch;
  observe: (scenario: string, passed: boolean, status?: number) => void;
}

export function fixturePreferencesUrl(baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    if (base.protocol === 'https:' && ['/', '/sabah-one', '/sabah-one/'].includes(base.pathname) && !base.username && !base.password
      && !base.search && !base.hash) return `${base.origin}${base.pathname.replace(/\/$/, '')}/api/prayer/v1/preferences`;
  } catch { /* Report only the static configuration boundary. */ }
  throw new Error('Synthetic fixture cleanup requires the configured HTTPS Prayer service origin.');
}

/** Synthetic CI fixtures only; retained service history is not account deletion. */
export async function cleanupHostedFixture(options: FixtureCleanupOptions): Promise<FixtureCleanupReceipt> {
  const { admin, fixtureId, directToken, oauthClientId, observe } = options;
  const receipt: FixtureCleanupReceipt = {
    authRemoved: false, authAbsenceConfirmed: false, clientRemoved: !oauthClientId,
    serviceWorkStopped: false, confirmed: false,
  };
  let failed = false;
  async function attempt(scenario: string, action: () => Promise<boolean>) {
    let passed = false;
    try { passed = await action(); } catch { /* SDK/network bodies may contain credentials. */ }
    observe(scenario, passed);
    if (!passed) failed = true;
    return passed;
  }
  async function preferences(method: 'GET' | 'PUT', reminderMinutes?: number) {
    const response = await options.fetcher(fixturePreferencesUrl(options.prayerBaseUrl), {
      method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${directToken}`, 'Content-Type': 'application/json',
        ...(method === 'PUT' ? { 'Idempotency-Key': randomUUID() } : {}) },
      ...(method === 'PUT' ? { body: JSON.stringify({ enabled: false, reminderEnabled: false, reminderMinutes }) } : {}),
    });
    observe(`Synthetic service cleanup ${method} response`, response.status === 200, response.status);
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('Synthetic service cleanup response unconfirmed.');
    }
    return preferencesSchema.parse(await response.json());
  }
  const disabled = fixtureId && await attempt('Own synthetic worker profile disabled', async () => {
    if (!directToken) return false;
    const current = await preferences('GET');
    const saved = await preferences('PUT', current.reminderMinutes);
    return saved.enabled === false && saved.reminderEnabled === false;
  });
  // Cleanup operations remain independent: a failed service proof must never skip Auth deletion.
  if (directToken) await attempt('Synthetic Auth sessions revoked', async () => {
    return !(await admin.signOut(directToken, 'global')).error;
  });
  if (oauthClientId) receipt.clientRemoved = await attempt('Own synthetic OAuth client deleted', async () => {
    return !(await admin.oauth.deleteClient(oauthClientId)).error;
  });
  if (fixtureId) {
    receipt.authRemoved = await attempt('Own synthetic Auth user deleted; service history may remain', async () => {
      return !(await admin.deleteUser(fixtureId)).error;
    });
    receipt.authAbsenceConfirmed = await attempt('Own synthetic Auth absence read back', async () => {
      const absent = await admin.getUserById(fixtureId);
      return absent.error?.status === 404 && absent.data.user === null;
    });
    const readback = await attempt('Zero active synthetic worker profiles after Auth teardown', async () => {
      if (!directToken) return false;
      // Only this disposable fixture's short-lived JWT is retained for this final read.
      // A denied/unavailable read is missing proof, never evidence of stopped work.
      const retained = await preferences('GET');
      return retained.enabled === false && retained.reminderEnabled === false;
    });
    receipt.serviceWorkStopped = Boolean(disabled && readback);
  }
  receipt.confirmed = !failed && receipt.authRemoved && receipt.authAbsenceConfirmed
    && receipt.clientRemoved && receipt.serviceWorkStopped;
  return receipt;
}
