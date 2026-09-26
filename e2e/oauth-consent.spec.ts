import { expect, openApp, test } from './support/helm-fixture';

const client = {
  clientId: '22222222-2222-4222-8222-222222222222',
  clientName: 'Codex scheduled jobs',
  approvedAt: '2026-09-14T12:00:00.000Z',
  revokedAt: null as string | null,
};

for (const width of [1440, 390]) {
  test(`explicit Employment consent approves only Employment at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const approvals: Array<{ domain: string; body: unknown }> = [];
    await page.route('**/auth/v1/oauth/authorizations/employment-request', route => route.fulfill({
      json: {
        authorization_id: 'employment-request',
        redirect_uri: 'https://client.example.test/callback',
        scope: 'openid',
        client: { id: client.clientId, name: client.clientName, uri: '', logo_uri: '' },
        user: { id: '11111111-1111-4111-8111-111111111111', email: 'e2e@example.test' },
      },
    }));
    await page.route('**/rest/v1/rpc/approve_*_oauth_client', async route => {
      approvals.push({ domain: route.request().url().includes('approve_employment') ? 'Employment' : 'Inventory', body: route.request().postDataJSON() });
      await route.fulfill({ json: client });
    });
    await page.route('**/auth/v1/oauth/authorizations/employment-request/consent', async route => {
      expect(route.request().postDataJSON()).toEqual({ action: 'approve' });
      await route.fulfill({ json: { redirect_url: '/helm/oauth-complete' } });
    });
    await page.route('**/helm/oauth-complete', route => route.fulfill({ contentType: 'text/html', body: '<h1>Client connected</h1>' }));

    await page.goto('/helm/oauth/consent?authorization_id=employment-request');
    await expect(page.getByRole('button', { name: 'Choose an area' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Employment/ })).not.toBeChecked();
    await expect(page.getByRole('radio', { name: /Inventory/ })).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath(`consent-unselected-${width}.png`), fullPage: true });

    const employment = page.getByRole('radio', { name: /Employment/ });
    await employment.focus();
    await employment.press('Space');
    await expect(employment).toBeChecked();
    await expect(page.getByText('Read job opportunities, applications, status history and next actions.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`consent-employment-${width}.png`), fullPage: true });
    const scroller = page.getByRole('main', { name: 'Client access approval' });
    const dimensions = await scroller.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await scroller.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await scroller.focus();
    await scroller.press('Home');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
    await scroller.press('PageDown');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const allow = page.getByRole('button', { name: 'Allow Employment' });
    await allow.focus();
    await expect(allow).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`consent-actions-${width}.png`) });
    await allow.press('Enter');
    await expect(page.getByRole('heading', { name: 'Client connected' })).toBeVisible();
    expect(approvals).toEqual([{ domain: 'Employment', body: { p_client_id: client.clientId, p_client_name: client.clientName } }]);
  });

  test(`Settings revokes Employment while preserving Inventory at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    await page.setViewportSize({ width: 1440, height: 844 });
    let employmentClient = { ...client };
    const revokedDomains: string[] = [];
    let oauthGrantRevocations = 0;
    await page.route('**/rest/v1/rpc/list_inventory_oauth_clients', route => route.fulfill({ json: [client] }));
    await page.route('**/rest/v1/rpc/list_employment_oauth_clients', route => route.fulfill({ json: [employmentClient] }));
    await page.route('**/rest/v1/rpc/revoke_*_oauth_client', async route => {
      const domain = route.request().url().includes('revoke_employment') ? 'Employment' : 'Inventory';
      revokedDomains.push(domain);
      expect(route.request().postDataJSON()).toEqual({ p_client_id: client.clientId });
      employmentClient = { ...client, revokedAt: '2026-09-14T13:00:00.000Z' };
      await route.fulfill({ json: employmentClient });
    });
    await page.route('**/auth/v1/user/oauth/grants*', async route => {
      oauthGrantRevocations++;
      await route.fulfill({ json: {} });
    });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).click();
    await page.setViewportSize({ width, height: 844 });
    const panel = page.getByRole('region', { name: 'Codex Employment Access' });
    const revoke = panel.getByRole('button', { name: `Revoke Employment access for ${client.clientName}` });
    await revoke.scrollIntoViewIfNeeded();
    await expect(revoke).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`employment-access-${width}.png`) });
    await revoke.focus();
    await revoke.press('Enter');
    await expect(panel.getByRole('status')).toHaveText(/can no longer access Employment/);
    await expect(revoke).toBeDisabled();
    expect(revokedDomains).toEqual(['Employment']);
    expect(oauthGrantRevocations).toBe(0);
    const inventoryPanel = page.getByRole('region', { name: 'Codex Inventory Access' });
    await expect(inventoryPanel.getByRole('button', { name: `Revoke Inventory access for ${client.clientName}` })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`employment-revoked-${width}.png`) });
  });
}
