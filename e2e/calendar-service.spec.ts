import { expect, openApp, test } from './support/helm-fixture';
import { makeCalendarAccount, makeCalendarSource } from '../src/test/fixtures';

const NOW = '2026-09-08T10:00:00.000Z';

test('a calendar write whose token was rejected renews the session and succeeds without signing out', async ({ page, scenario }) => {
  const control = await scenario({ now: NOW, settings: { defaultCalendarTab: 'agenda' }, stores: {
    calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()],
  } });
  // The Sabah One token expired while the tab slept: the first write is refused once.
  let rejected = 0;
  await page.route('**/api/calendar/v1/events', async route => {
    if (route.request().method() === 'POST' && rejected === 0) {
      rejected += 1;
      return route.fulfill({ status: 401, json: { code: 'invalid_token', message: 'Expired.' } });
    }
    return route.fallback();
  });
  const renewals: string[] = [];
  await page.route('**/auth/v1/token?grant_type=refresh_token', async route => {
    renewals.push(route.request().url());
    const user = {
      id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test',
      app_metadata: { provider: 'google' }, user_metadata: { full_name: 'E2E User' },
    };
    await route.fulfill({ json: {
      access_token: 'renewed-access-token', refresh_token: 'renewed-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    } });
  });
  const authorizations: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/api/calendar/v1/events')) {
      authorizations.push(request.headers().authorization ?? '');
    }
  });

  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await page.getByRole('button', { name: '+ Event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add Event' });
  await editor.getByLabel('Title').fill('Dentist');
  await editor.getByRole('button', { name: 'Add Event', exact: true }).click();

  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open Dentist', exact: true })).toBeVisible();
  expect(renewals).toHaveLength(1);
  expect(authorizations).toEqual(['Bearer e2e-access-token', 'Bearer renewed-access-token']);
  expect(control.services.calendar.events.map(event => event.title)).toEqual(['Dentist']);
  await expect(page.getByText(/Sign in/)).toHaveCount(0);
});

test('a Google account that needs reconnecting explains itself and leaves the user signed in', async ({ page, scenario }) => {
  const account = makeCalendarAccount({
    id: 'account-google', provider: 'google', email: 'sabah@example.test', name: 'Sabah', authStatus: 'connected',
    lastSyncTime: NOW,
  });
  await scenario({ now: NOW, settings: { defaultCalendarTab: 'agenda' }, stores: {
    calendarAccounts: [account],
    calendarSources: [makeCalendarSource({ id: 'source-google', accountId: account.id, googleCalendarId: account.email, accessRole: 'owner' })],
  } });
  await page.route('**/api/calendar/v1/events', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 409, json: {
      code: 'google_reconnect_required', message: 'Google refresh token expired or was revoked. Reconnect this account.',
    } })
    : route.fallback());

  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await page.getByRole('button', { name: '+ Event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add Event' });
  await editor.getByLabel('Title').fill('Lunch');
  await editor.getByRole('button', { name: 'Add Event', exact: true }).click();

  await expect(editor.getByRole('alert')).toContainText('Google Calendar was not changed');
  await expect(editor.getByRole('alert')).toContainText('Reconnect it in Integrations; your Sabah One session is not affected.');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByText(/Sign in/)).toHaveCount(0);
});
