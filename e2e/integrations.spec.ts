import type { Page } from '@playwright/test';
import { expect, openApp, test } from './support/helm-fixture';
import { makeCalendarAccount } from '../src/test/fixtures';
import type { Integration } from '../src/types/domain';

const configuredAt = '2026-07-01T12:00:00.000Z';
const google: Integration = {
  id: 'saved-google', provider: 'google', name: 'Saved Calendar', description: 'Historical copy',
  status: 'error', icon: 'calendar', configuredAt,
};
const github: Integration = {
  ...google, id: 'saved-github', provider: 'github', name: 'Saved GitHub',
};

async function openIntegrations(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  if (width === 390) {
    await page.getByRole('button', { name: 'Open more navigation', exact: true }).click();
    await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Integrations', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Navigate to Integrations', exact: true }).click();
  }
  await expect(page.getByRole('main', { name: 'integrations surface' })).toBeVisible();
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
}

for (const width of [390, 1440]) {
  test(`empty integrations offer supported setup and recover from provider failure at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    const actions: string[] = [];
    await page.route('**/functions/v1/github-life-hero*', async route => {
      const { action } = route.request().postDataJSON();
      actions.push(action);
      await route.fulfill({ json: action === 'get_status'
        ? { ok: true, result: { status: 'disconnected', connection: null } }
        : { ok: false, error: 'not_configured', message: 'GitHub setup is temporarily unavailable. Try again later.' } });
    });
    await page.route('**/functions/v1/google-calendar-oauth*', route => route.fulfill({ json: { ok: true, result: [] } }));
    await openIntegrations(page, width);
    const surface = page.getByRole('main', { name: 'integrations surface' });
    const googleCard = surface.locator('.card').filter({ has: page.getByRole('heading', { name: /^Google Calendar/ }) });
    // The GitHub App only fed Life Hero, which was removed with it.
    await expect(surface.locator('.card')).toHaveCount(1);
    await expect(googleCard).toBeVisible();
    await expect(surface.getByRole('heading', { name: /^GitHub/ })).toHaveCount(0);
    await expect(surface.getByText('Slack and Linear connections are unavailable.', { exact: false })).toBeVisible();
    await expect(surface.getByRole('button', { name: /Simulate|Disconnect/ })).toHaveCount(0);
    const configure = googleCard.getByRole('button', { name: /Configure|Add Account/ });
    await configure.focus();
    await page.keyboard.press('Enter');
    await expect(googleCard.getByRole('button', { name: 'Connect Google Calendar', exact: true })).toBeDisabled();
    await expect(googleCard.getByText(/Ask the site operator to configure Google Calendar/)).toBeVisible();
    await expect(googleCard.getByRole('button', { name: 'Go to Settings', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`integrations-empty-setup-${width}.png`) });
    await googleCard.getByRole('button', { name: 'Cancel', exact: true }).click();

    expect(actions).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`integrations-provider-error-${width}.png`) });
  });

  test(`historical records keep one supported card and explicit account reconnect at ${width}px`, async ({ page, scenario }, testInfo) => {
    const historical = [
      { ...google, id: 'duplicate-google' },
      { ...google, id: 'old-slack', provider: 'slack', name: 'Slack', status: 'mocked' },
      { ...google, id: 'old-linear', provider: 'linear', name: 'Linear', status: 'connected' },
      { ...google, id: 'old-unknown', provider: 'unknown' },
    ];
    const accounts = ['personal', 'work'].map((name, index) => makeCalendarAccount({
      id: `account-${name}`, email: `${name}@example.test`, name, provider: 'google',
      isPrimary: index === 0, authProvider: 'google-oauth', authStatus: 'needs_reconnect',
    }));
    // Integrations are saved in the profile service, which keeps one connection record per provider.
    const control = await scenario({ stores: { integrations: [google, github, ...historical], calendarAccounts: accounts } });
    const integrationWrites = () => control.services.calls.filter(call => call.startsWith('PUT /api/profile/v1/integrations'));
    const googleActions: string[] = [];
    await page.route('**/functions/v1/google-calendar-oauth*', async route => {
      const { action } = route.request().postDataJSON();
      googleActions.push(action);
      await route.fulfill({ json: { ok: true, result: action === 'revoke_account' ? { revoked: true } : accounts.map(account => ({
        accountEmail: account.email, serverCredentialPresent: true, credentialHealth: 'needs_reconnect',
      })) } });
    });
    const calendarDeletes: string[] = [];
    page.on('request', request => {
      if (request.method() === 'DELETE' && request.url().includes('/api/calendar/v1/accounts/')) calendarDeletes.push(request.url());
    });
    const githubActions: string[] = [];
    await page.route('**/functions/v1/github-life-hero*', async route => {
      githubActions.push(route.request().postDataJSON().action);
      await route.fulfill({ json: { ok: true, result: { status: 'revoked', connection: {
        githubUserId: 123, selectedRepositoryIds: [456], apiVersion: '2022-11-28',
        authorizedAt: configuredAt, lastSyncStatus: 'revoked',
      } } } });
    });
    await openIntegrations(page, width);
    const surface = page.getByRole('main', { name: 'integrations surface' });
    await expect(surface.locator('.card')).toHaveCount(1);
    await expect(surface.getByText('(2 accounts)', { exact: true })).toBeVisible();
    await expect(surface.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(2);
    await expect(surface.getByRole('button', { name: /GitHub App/ })).toHaveCount(0);
    await expect(surface.getByRole('button', { name: /Simulate|Sync GitHub evidence|Choose repositories/ })).toHaveCount(0);
    await expect(surface.getByRole('heading', { name: /Slack|Linear/ })).toHaveCount(0);
    // The browser never calls the Google credential function: the calendar service does.
    expect(googleActions).toEqual([]);
    expect(githubActions).toEqual([]);
    expect(integrationWrites()).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`integrations-reconnect-${width}.png`) });
    if (width === 390) {
      // One supported card remains, so a shorter phone viewport proves the surface still scrolls.
      await page.setViewportSize({ width: 390, height: 480 });
      const scroller = surface;
      const size = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      expect(size.scroll).toBeGreaterThan(size.client);
      const anchor = surface.getByRole('heading', { name: /^Google Calendar/ });
      const before = await anchor.boundingBox();
      await scroller.hover();
      await page.mouse.wheel(0, 600);
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect((await anchor.boundingBox())!.y).toBeLessThan(before!.y);
      await surface.getByRole('button', { name: 'Reconnect', exact: true }).first().focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await surface.getByRole('button', { name: 'Reconnect', exact: true }).last().focus();
      await page.screenshot({ path: testInfo.outputPath('integrations-reconnect-scrolled-390.png') });
      await testInfo.attach('integration-scroll', { contentType: 'application/json', body: JSON.stringify({ width, ...size, offset: await scroller.evaluate(element => element.scrollTop) }) });
    }
    // Explicit account removal keeps the other account, then disconnects the saved provider ID.
    for (const remaining of [1, 0]) {
      await surface.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
      await surface.getByRole('button', { name: 'Yes', exact: true }).click();
      await expect(surface.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(remaining);
    }
    // Google's status is derived from the calendar service, never saved: open tabs holding different
    // copies of the calendar used to overwrite each other's saved status in an endless write loop.
    await expect(surface.locator('.card').first().getByRole('status').first()).toHaveText('disconnected');
    expect(integrationWrites()).toEqual([]);
    await testInfo.attach('integration-writes', { contentType: 'application/json', body: JSON.stringify(integrationWrites()) });
    // Each disconnect asks the calendar service, which revokes the stored Google credential.
    expect(calendarDeletes).toHaveLength(2);
    expect(googleActions).toEqual([]);
  });
}
