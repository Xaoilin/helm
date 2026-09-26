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

  test('shows only the prayer service outcomes, never the account record copy, and re-sends nothing', async ({ page, scenario }) => {
    const control = await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
      stores: {
        // An outcome the old Supabase mirror still holds; the service never had it.
        prayerTracking: {
          schemaVersion: 1,
          trackingStartedAt: '2026-08-20T08:00:00.000Z',
          records: {
            '2026-08-29::Fajr': {
              date: '2026-08-29', prayerName: 'Fajr', status: 'late',
              recordedAt: '2026-08-29T06:00:00.000Z', rewarded: true, source: 'dashboard',
            },
          },
          reminderReceipts: {},
          boundedReminderReceipts: {},
        },
      },
    });
    control.services.tracking = {
      trackingStartedAt: '2026-08-20T08:00:00Z', activationDate: null, activationPrayers: [], importedAt: null,
    };
    // History can predate the tracking start; it must load, not be re-sent.
    control.services.outcomes.set('2026-04-02::Fajr', {
      id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', date: '2026-04-02', prayer: 'Fajr', status: 'late',
      recordedAt: '2026-08-20T08:00:00Z', source: 'migration', taskId: null, rewarded: true, deadlineAt: null,
    });
    await openApp(page);

    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    await expect(page.getByRole('button', { name: /Fajr Prayer — confirmed/u })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');

    const writes = control.services.calls.filter(call => !call.startsWith('GET '));
    expect(writes.filter(call => call.startsWith('POST /api/prayer') || call.startsWith('PATCH ') || call.startsWith('DELETE ')))
      .toEqual([]);
    expect(control.services.calls).not.toContain('POST /api/prayer/v1/import');
    // Preferences are read from the service; loading the page never writes them back.
    expect(control.services.calls).not.toContain('PUT /api/prayer/v1/preferences');
    expect(control.services.conflicts).toBe(0);
    expect(control.services.outcomes.has('2026-08-29::Fajr')).toBe(false);
  });

  test('loading, reminders, reloads and focus never delete the service outcomes', async ({ page, scenario }) => {
    // Noon: Dhuhr is current, so its reminder saves receipts while outcomes load (the live bug's setting).
    const control = await scenario({ now: NOON, settings: { prayerEnabled: true, lifeHeroEnabled: false } });
    control.services.tracking = {
      trackingStartedAt: '2026-08-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: null,
    };
    for (const [date, prayer] of [['2026-08-28', 'Fajr'], ['2026-08-28', 'Isha'], ['2026-08-29', 'Fajr']] as const) {
      control.services.outcomes.set(`${date}::${prayer}`, {
        id: crypto.randomUUID(), date, prayer, status: 'on_time', recordedAt: `${date}T05:00:00Z`,
        source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
      });
    }
    await openApp(page);
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    await expect(page.getByRole('button', { name: /Fajr Prayer — confirmed/u })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.clock.fastForward(31_000);
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');

    expect(control.services.calls.filter(call => call.startsWith('DELETE '))).toEqual([]);
    expect(control.services.outcomes.size).toBe(3);
  });

  test('uses the location saved in the profile service', async ({ page, scenario }) => {
    await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false, prayerCity: 'Bedford' },
      services: { profile: { city: 'London', country: 'United Kingdom', timeZone: null } },
    });
    const londonTimetable = page.waitForRequest(request =>
      request.url().includes('/api/prayer/v1/schedule') && new URL(request.url()).searchParams.get('city') === 'London');
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
    // Let the client's backoff run out; it then stops calling the service for a while.
    await page.clock.fastForward(20_000);

    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toContainText('Prayer data: Not synced');
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toContainText('Retrying automatically');
    // Backoff bounds the load: one read is tried at most four times, then the circuit fails fast.
    expect(control.services.calls.filter(call => call === 'GET /api/prayer/v1/dashboard').length).toBeLessThanOrEqual(4);
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

  test('a completion whose confirmation was lost is retried by the client and saved once', async ({ page, scenario }) => {
    const control = await scenario({ now: NOON, settings: { prayerEnabled: true, lifeHeroEnabled: false } });
    await openApp(page);
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');

    // The service saves the next write, but its answer never reaches the app.
    control.services.loseNextWriteResponse = true;
    await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
    await page.getByRole('button', { name: /On time/u }).click();
    await expect.poll(() => control.services.outcomes.get('2026-08-29::Dhuhr')?.status).toBe('on_time');

    // The client retries the write after a short backoff with the same Idempotency-Key.
    await page.clock.fastForward(5_000);

    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    const creates = control.services.calls.filter(call => call === 'POST /api/prayer/v1/outcomes');
    expect(creates).toHaveLength(2);
    // The retry carried the same Idempotency-Key, so the service replayed its first result.
    expect(control.services.replays).toBe(1);
    expect(control.services.conflicts).toBe(0);
    expect([...control.services.outcomes.keys()].filter(key => key.endsWith('::Dhuhr'))).toHaveLength(1);
  });

  test('a refused completion stays refused after a reload and is not sent again', async ({ page, scenario }) => {
    const control = await scenario({
      now: NOON,
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
      services: { rejectCreates: { code: 'prayer_not_started', message: 'Dhuhr has not started yet.' } },
    });
    const creates = () => control.services.calls.filter(call => call === 'POST /api/prayer/v1/outcomes').length;
    await openApp(page);

    await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
    await page.getByRole('button', { name: /On time/u }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Dhuhr on 2026-08-29 was not saved' })).toBeVisible();
    expect(creates()).toBe(1);

    await page.reload();
    await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
    await expect(page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'was not saved' })).toHaveCount(0);
    expect(creates()).toBe(1);
  });
});
