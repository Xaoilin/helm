import { useSyncExternalStore } from 'react';
import { getOnlineStatus, subscribeOnlineStatus } from '../services/networkStatus';

/** Browser network hint, overridden by an actual service response until the next network change. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnlineStatus, getOnlineStatus, () => true);
}
