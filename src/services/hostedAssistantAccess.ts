import { SUPABASE_ANON_KEY } from '../config';
import { LOCALHOST_HOSTNAMES } from '../config/constants';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthSessionSnapshot } from '../store/supabase';

export type HostedAssistantAccessMode = 'user_session' | 'none';

export class HostedAssistantPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAssistantPausedError';
  }
}

export class HostedAssistantSignInRequiredError extends Error {
  constructor() {
    super('Sign in to Sabah One again to use hosted AI.');
    this.name = 'HostedAssistantSignInRequiredError';
  }
}

function getWindowHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isLocalhostRuntime(): boolean {
  return LOCALHOST_HOSTNAMES.includes(getWindowHostname() as typeof LOCALHOST_HOSTNAMES[number]);
}

export function hasHostedAssistantSession(): boolean {
  const session = getAuthSessionSnapshot();
  return Boolean(session?.accessTokenPresent && session.expiresAt && session.expiresAt > Date.now() / 1000);
}

export async function getHostedAssistantAuthHeaders(client: SupabaseClient): Promise<Record<string, string>> {
  // getSession refreshes an expiring browser token. The server independently verifies identity.
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session?.access_token || !session.user?.id || session.user.is_anonymous
    || session.access_token === SUPABASE_ANON_KEY
    || !session.expires_at || session.expires_at <= Date.now() / 1000) {
    throw new HostedAssistantSignInRequiredError();
  }
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` };
}

export function formatHostedAssistantAccessMode(mode: HostedAssistantAccessMode | null): string {
  switch (mode) {
    case 'user_session':
      return 'signed-in session';
    default:
      return 'none';
  }
}
