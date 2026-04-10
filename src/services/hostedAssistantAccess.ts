import { SUPABASE_ANON_KEY } from '../config';
import { LOCALHOST_HOSTNAMES } from '../config/constants';

export type HostedAssistantAccessMode = 'project_key' | 'none';

function getWindowHostname(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

export function isLocalhostRuntime(): boolean {
  return LOCALHOST_HOSTNAMES.includes(getWindowHostname() as typeof LOCALHOST_HOSTNAMES[number]);
}

export function canUseHostedAssistantProjectAccess(): boolean {
  return Boolean(SUPABASE_ANON_KEY.trim());
}

export function formatHostedAssistantAccessMode(mode: HostedAssistantAccessMode | null): string {
  switch (mode) {
    case 'project_key':
      return 'project access key';
    default:
      return 'none';
  }
}
