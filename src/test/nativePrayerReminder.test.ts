import {
  cancelAllPrayerReminders,
  cancelPrayerReminder,
  onPrayerReminderFired,
  requestPrayerReminderPermission,
  schedulePrayerReminder,
  sendPrayerNotification,
  type PrayerReminderFiredEvent,
  type PrayerReminderScheduleRequest,
} from '../services/nativePrayerReminder';

const notificationConstructor = vi.fn();
const requestPermission = vi.fn<() => Promise<NotificationPermission>>();

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = requestPermission;

  constructor(title: string, options?: NotificationOptions) {
    notificationConstructor(title, options);
  }
}

const baseRequest: PrayerReminderScheduleRequest = {
  prayerDate: '2026-07-28',
  prayerName: 'Fajr',
  fireAtIso: '2026-07-28T12:01:00.000Z',
  deadlineIso: '2026-07-28T12:05:00.000Z',
};

describe('nativePrayerReminder browser fallback', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    notificationConstructor.mockClear();
    requestPermission.mockReset();
    FakeNotification.permission = 'granted';
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: FakeNotification,
    });
    await cancelAllPrayerReminders();
  });

  afterEach(async () => {
    await cancelAllPrayerReminders();
    vi.useRealTimers();
  });

  it('fires an in-app event and Web Notification at the requested time', async () => {
    const listener = vi.fn<(event: PrayerReminderFiredEvent) => void>();
    const unlisten = await onPrayerReminderFired(listener);

    const result = await schedulePrayerReminder(baseRequest);
    expect(result.status).toBe('scheduled');

    await vi.advanceTimersByTimeAsync(60_000);

    expect(notificationConstructor).toHaveBeenCalledWith(
      'Fajr prayer due soon',
      { body: 'Pray Fajr before its on-time window closes.' },
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      key: '2026-07-28:Fajr:1785240300000',
      prayerName: 'Fajr',
      notificationSent: true,
      error: null,
    }));
    unlisten();
  });

  it('fires immediately when startup occurs inside the warning window', async () => {
    const listener = vi.fn<(event: PrayerReminderFiredEvent) => void>();
    const unlisten = await onPrayerReminderFired(listener);

    await schedulePrayerReminder({
      ...baseRequest,
      fireAtIso: '2026-07-28T11:59:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledOnce();
    expect(notificationConstructor).toHaveBeenCalledOnce();
    unlisten();
  });

  it('atomically replaces the same prayer/deadline timer when its fire time changes', async () => {
    const listener = vi.fn<(event: PrayerReminderFiredEvent) => void>();
    const unlisten = await onPrayerReminderFired(listener);

    await schedulePrayerReminder(baseRequest);
    await schedulePrayerReminder({
      ...baseRequest,
      fireAtIso: '2026-07-28T12:02:00.000Z',
      body: 'Updated reminder window',
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).not.toHaveBeenCalled();
    expect(notificationConstructor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).toHaveBeenCalledOnce();
    expect(notificationConstructor).toHaveBeenCalledWith(
      'Fajr prayer due soon',
      { body: 'Updated reminder window' },
    );
    unlisten();
  });

  it('labels delayed validation timers so tracking can ignore their events', async () => {
    const listener = vi.fn<(event: PrayerReminderFiredEvent) => void>();
    const unlisten = await onPrayerReminderFired(listener);

    await schedulePrayerReminder({
      ...baseRequest,
      fireAtIso: '2026-07-28T12:00:05.000Z',
      testOnly: true,
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      prayerName: 'Fajr',
      testOnly: true,
    }));
    unlisten();
  });

  it('never requests permission from a background timer', async () => {
    FakeNotification.permission = 'default';
    const listener = vi.fn<(event: PrayerReminderFiredEvent) => void>();
    const unlisten = await onPrayerReminderFired(listener);

    await schedulePrayerReminder(baseRequest);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(notificationConstructor).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      notificationSent: false,
    }));
    unlisten();
  });

  it('surfaces explicit permission denial without sending a notification', async () => {
    FakeNotification.permission = 'denied';
    requestPermission.mockResolvedValue('denied');

    await expect(requestPrayerReminderPermission()).resolves.toBe('denied');

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(notificationConstructor).not.toHaveBeenCalled();
  });

  it('sends immediate notifications only when permission is already granted', async () => {
    await expect(sendPrayerNotification({
      title: 'Test prayer reminder',
      body: 'Notification check',
    })).resolves.toBe(true);
    expect(notificationConstructor).toHaveBeenCalledWith(
      'Test prayer reminder',
      { body: 'Notification check' },
    );
    expect(requestPermission).not.toHaveBeenCalled();

    FakeNotification.permission = 'default';
    await expect(sendPrayerNotification({
      title: 'Blocked',
      body: 'No prompt',
    })).resolves.toBe(false);
    expect(notificationConstructor).toHaveBeenCalledOnce();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('cancels by date, prayer, and canonical deadline instant', async () => {
    await schedulePrayerReminder(baseRequest);

    await expect(cancelPrayerReminder({
      prayerDate: baseRequest.prayerDate,
      prayerName: baseRequest.prayerName,
      deadlineIso: '2026-07-28T13:05:00.000+01:00',
    })).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(notificationConstructor).not.toHaveBeenCalled();
  });

  it('skips reminders whose prayer deadline already passed', async () => {
    const result = await schedulePrayerReminder({
      ...baseRequest,
      fireAtIso: '2026-07-28T11:50:00.000Z',
      deadlineIso: '2026-07-28T11:59:00.000Z',
    });

    expect(result.status).toBe('expired');
    expect(notificationConstructor).not.toHaveBeenCalled();
  });
});
