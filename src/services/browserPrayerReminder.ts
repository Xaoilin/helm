/**
 * The browser side of prayer reminders: Web Notification permission and showing one notification. The
 * prayer service decides every reminder and when it is due; nothing here schedules one.
 */
export type PrayerReminderPermissionState = 'granted' | 'not_granted' | 'unsupported';
export type PrayerReminderPermissionRequestResult = NotificationPermission | 'unsupported';

export async function getPrayerReminderPermission(): Promise<PrayerReminderPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission === 'granted' ? 'granted' : 'not_granted';
}

/** Shows a notification now; tabs showing one with the same `tag` show it once. */
export async function sendPrayerNotification(
  notification: { title: string; body: string; tag?: string },
): Promise<boolean> {
  if (
    typeof window === 'undefined'
    || !('Notification' in window)
    || window.Notification.permission !== 'granted'
  ) {
    return false;
  }
  try {
    new window.Notification(notification.title, {
      body: notification.body,
      ...(notification.tag ? { tag: notification.tag } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit user-action API. Receiving a reminder never invokes this or prompts for permission.
 */
export async function requestPrayerReminderPermission(): Promise<PrayerReminderPermissionRequestResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return window.Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}
