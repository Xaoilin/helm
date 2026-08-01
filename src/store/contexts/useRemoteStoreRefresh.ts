import { useEffect, useRef } from 'react';
import { logWarn } from '../../services/logger';
import { subscribeStoreKey } from '../persistence';

export function useRemoteStoreRefresh(
  storeKeys: readonly string[],
  refresh: () => Promise<void>,
): void {
  const refreshRef = useRef(refresh);
  const keySignature = storeKeys.join('\u0000');

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const subscribedKeys = keySignature.split('\u0000').filter(Boolean);
    let active = true;
    let scheduled = false;
    let pending = Promise.resolve();
    const requestRefresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        pending = pending.then(async () => {
          if (active) await refreshRef.current();
        }).catch(error => {
          logWarn('Persistence', `Live store refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
    };
    const unsubscribe = subscribedKeys.map(key => subscribeStoreKey(key, requestRefresh));
    return () => {
      active = false;
      unsubscribe.forEach(remove => remove());
    };
  }, [keySignature]);
}
