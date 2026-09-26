import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  getPrayerReminderPermission,
  requestPrayerReminderPermission,
  type PrayerReminderPermissionRequestResult,
  type PrayerReminderPermissionState,
} from '../../../services/browserPrayerReminder';

export interface PrayerNotificationPermission {
  state: PrayerReminderPermissionState;
  /** Reads the browser's current permission and publishes it. Never prompts. */
  refresh: () => Promise<PrayerReminderPermissionState>;
  /** Asks the browser for permission; only call from a user action. */
  request: () => Promise<PrayerReminderPermissionRequestResult>;
  /**
   * Bounded reminders that came due without permission. They are not retried
   * while permission is missing, and granting it clears them.
   */
  waitingReminderKeysRef: RefObject<Set<string>>;
}

/** Owns Web Notification permission for prayer reminders. */
export function usePrayerNotificationPermission(): PrayerNotificationPermission {
  const [state, setState] = useState<PrayerReminderPermissionState>('unsupported');
  const waitingReminderKeysRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const permission = await getPrayerReminderPermission();
    setState(permission);
    return permission;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async () => {
    const result = await requestPrayerReminderPermission();
    if (result === 'granted') waitingReminderKeysRef.current.clear();
    setState(result === 'granted' ? 'granted' : result === 'unsupported' ? 'unsupported' : 'not_granted');
    return result;
  }, []);

  return { state, refresh, request, waitingReminderKeysRef };
}
