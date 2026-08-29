import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAllPrayerReminders,
  getPrayerReminderKey,
  listScheduledPrayerReminders,
  onPrayerReminderFired,
  schedulePrayerReminder,
} from '../services/browserPrayerReminder';

const reminder = {
  prayerDate: '2026-08-29',
  prayerName: 'Fajr' as const,
  deadlineIso: '2026-08-29T10:15:00.000Z',
  fireAtIso: '2026-08-29T10:00:00.000Z',
  title: 'Fajr due soon',
  body: 'Pray Fajr before the window closes.',
  testOnly: true,
};

describe('browser prayer reminder timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T09:59:00.000Z'));
  });

  afterEach(async () => {
    await cancelAllPrayerReminders();
  });

  it('proves a scheduled reminder fires at its explicit instant and records notification fallback state', async () => {
    const fired: unknown[] = [];
    const removeListener = await onPrayerReminderFired(event => fired.push(event));
    const key = getPrayerReminderKey(reminder);
    const scheduled = await schedulePrayerReminder(reminder);

    expect(scheduled).toEqual({
      key,
      prayerDate: '2026-08-29',
      prayerName: 'Fajr',
      deadlineIso: '2026-08-29T10:15:00.000Z',
      fireAtIso: '2026-08-29T10:00:00.000Z',
      testOnly: true,
      status: 'scheduled',
    });
    expect(await listScheduledPrayerReminders()).toEqual([{
      key,
      prayerDate: '2026-08-29',
      prayerName: 'Fajr',
      deadlineIso: '2026-08-29T10:15:00.000Z',
      fireAtIso: '2026-08-29T10:00:00.000Z',
      testOnly: true,
    }]);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fired).toEqual([{
      key,
      prayerDate: '2026-08-29',
      prayerName: 'Fajr',
      deadlineIso: '2026-08-29T10:15:00.000Z',
      fireAtIso: '2026-08-29T10:00:00.000Z',
      testOnly: true,
      firedAtIso: '2026-08-29T10:00:00.000Z',
      notificationSent: false,
      error: null,
    }]);
    expect(await listScheduledPrayerReminders()).toEqual([]);
    removeListener();
  });

  it('proves expired and non-before-deadline requests cannot remain scheduled', async () => {
    vi.setSystemTime(new Date('2026-08-29T10:02:00.000Z'));
    const expired = await schedulePrayerReminder({
      ...reminder,
      fireAtIso: '2026-08-29T10:00:00.000Z',
      deadlineIso: '2026-08-29T10:01:00.000Z',
    });
    expect(expired.status).toBe('expired');
    expect(await listScheduledPrayerReminders()).toEqual([]);

    await expect(schedulePrayerReminder({
      ...reminder,
      fireAtIso: '2026-08-29T10:15:00.000Z',
    })).rejects.toThrow('before deadlineIso');
  });
});
