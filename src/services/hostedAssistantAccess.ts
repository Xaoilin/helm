import { SUPABASE_ANON_KEY } from '../config';
import { LOCALHOST_HOSTNAMES } from '../config/constants';

export type HostedAssistantAccessMode = 'session_token' | 'local_project_key' | 'none';

function getWindowHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isLocalhostRuntime(): boolean {
  return LOCALHOST_HOSTNAMES.includes(getWindowHostname() as typeof LOCALHOST_HOSTNAMES[number]);
}

export function canUseHostedAssistantLocalProjectAccess(): boolean {
  return isLocalhostRuntime() && Boolean(SUPABASE_ANON_KEY.trim());
}

export function formatHostedAssistantAccessMode(mode: HostedAssistantAccessMode | null): string {
  switch (mode) {
    case 'session_token':
      return 'signed-in session token';
    case 'local_project_key':
      return 'local project access';
    default:
      return 'none';
  }
}
