import type { AuthChangeEvent } from '@supabase/supabase-js';

export function shouldReloadForAuthStateChange(
  event: AuthChangeEvent,
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  if (event === 'SIGNED_OUT') {
    return previousUserId !== null;
  }

  if (event === 'SIGNED_IN') {
    return nextUserId !== null && previousUserId !== nextUserId;
  }

  return false;
}
