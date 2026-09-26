import { expect, openApp, test } from './support/helm-fixture';

const NOON = '2026-08-29T12:30:00.000Z'; // 13:30 in London: Dhuhr is the current prayer.

test.describe('prayer and profile services', () => {
  test('prayer outcomes come from the prayer service and completions are saved there', async ({ page, scenario }) => {
    const control = await scenario({ now: NOON, settings: { prayerEnabled: true, lifeHeroEnabled: false } });
    control.services.outcomes.set('2026-08-29::Fajr', {
      id: '0d7b7c1e-6a0a-4b1e-9d0e-3c2f1a4b5c6d',
      date: '2026-08-29',
      prayer: 'Fajr',
      status: 'late',
      recordedAt: '2026-08-29T06:00:00.000Z',
      source: 'dashboard',
      taskId: null,
      rewarded: true,
      deadlineAt: null,
    });
    await openApp(page);

    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    await expect(page.getByRole('button', { name: /Fajr Prayer — confirmed/u })).toBeVisible();

    await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
    await page.getByRole('button', { name: /On time/u }).click();
    await expect.poll(() => control.services.outcomes.get('2026-08-29::Dhuhr')?.status).toBe('on_time');

    await page.reload();
    await expect(page.getByRole('button', { name: /Dhuhr Prayer — confirmed/u })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
  });

  test('imports the existing prayer history once', async ({ page, scenario }) => {
    const control = await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
      stores: {
        prayerTracking: {
          schemaVersion: 1,
          trackingStartedAt: '2026-08-20T08:00:00.000Z',
          records: {
            '2026-08-28::Isha': {
              date: '2026-08-28', prayerName: 'Isha', status: 'on_time',
              recordedAt: '2026-08-28T20:00:00.000Z', rewarded: true, source: 'dashboard',
            },
            // History can predate the tracking start; it must load, not be re-sent.
            '2026-04-02::Fajr': {
              date: '2026-04-02', prayerName: 'Fajr', status: 'late',
              recordedAt: '2026-08-20T08:00:00.000Z', rewarded: true, source: 'migration',
            },
          },
          reminderReceipts: {},
          boundedReminderReceipts: {},
        },
      },
    });
    await openApp(page);

    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    expect(control.services.calls.filter(call => call === 'POST /api/prayer/v1/import')).toHaveLength(1);
    expect(control.services.outcomes.get('2026-08-28::Isha')?.status).toBe('on_time');
    expect(control.services.outcomes.get('2026-04-02::Fajr')?.status).toBe('late');
    expect(control.services.conflicts).toBe(0);
    expect(control.services.tracking?.trackingStartedAt).toBe('2026-08-20T08:00:00.000Z');

    await page.reload();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    expect(control.services.calls.filter(call => call === 'POST /api/prayer/v1/import')).toHaveLength(1);
    expect(control.services.conflicts).toBe(0);
  });

  test('uses the location saved in the profile service', async ({ page, scenario }) => {
    await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false, prayerCity: 'Bedford' },
      services: { profile: { city: 'London', country: 'United Kingdom', timeZone: null } },
    });
    const londonTimetable = page.waitForRequest(request =>
      request.url().includes('timingsByCity') && new URL(request.url()).searchParams.get('city') === 'London');
    await openApp(page);

    await londonTimetable;
    await expect(page.getByText(/London · Europe\/London/u)).toBeVisible();
  });

  test('keeps working and says so when the prayer service is down', async ({ page, scenario }) => {
    const control = await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
      services: { failureStatus: 503 },
    });
    await openApp(page);

    await expect(page.getByRole('status', { name: 'Prayer data sync' }))
      .toContainText('Prayer data: Not synced (Service unavailable.). Retrying automatically');
    await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
    await page.getByRole('button', { name: /On time/u }).click();
    await expect(page.getByRole('button', { name: /Dhuhr Prayer — confirmed/u })).toBeVisible();
    expect(control.services.outcomes.size).toBe(0);
  });

  test('refuses to complete a prayer before it starts and sends nothing', async ({ page, scenario }) => {
    // 02:10 in London: Fajr (05:00) and Dhuhr (13:00) have not started.
    const control = await scenario({ now: '2026-08-29T01:10:00.000Z', settings: { prayerEnabled: true, lifeHeroEnabled: false } });
    await openApp(page);
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');

    for (const prayer of ['Fajr', 'Dhuhr']) {
      await page.getByRole('button', { name: new RegExp(`Complete ${prayer} Prayer`, 'u') }).click();
      await expect(page.getByRole('alert').filter({ hasText: `${prayer} has not started yet.` })).toBeVisible();
      await expect(page.getByRole('dialog', { name: `How was ${prayer} prayed?` })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /Fajr Prayer — confirmed/u })).toHaveCount(0);
    expect(control.services.calls.filter(call => call === 'POST /api/prayer/v1/outcomes')).toEqual([]);

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'has not started yet' })).toHaveCount(0);
  });

  test('reverts and explains a completion the prayer service refuses', async ({ page, scenario }) => {
    await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
      services: { rejectCreates: { code: 'prayer_not_started', message: 'Dhuhr has not started yet.' } },
    });
    await openApp(page);

    await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
    await page.getByRole('button', { name: /On time/u }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Dhuhr on 2026-08-29 was not saved: Dhuhr has not started yet.' }))
      .toBeVisible();
    await expect(page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
  });
});
