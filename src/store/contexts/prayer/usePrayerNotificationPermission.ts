import { useCallback, useEffect, useState } from 'react';
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
}

/** Owns Web Notification permission for prayer reminders. */
export function usePrayerNotificationPermission(): PrayerNotificationPermission {
  const [state, setState] = useState<PrayerReminderPermissionState>('unsupported');

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
    setState(result === 'granted' ? 'granted' : result === 'unsupported' ? 'unsupported' : 'not_granted');
    return result;
  }, []);

  return { state, refresh, request };
}
