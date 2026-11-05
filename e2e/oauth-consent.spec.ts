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
    await page.route('**/api/access/consent/employment-request', route => route.fulfill({
      headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' },
      json: {
        authorization_id: 'employment-request',
        redirect_uri: 'https://client.example.test/callback',
        scope: 'mcp',
        client: { id: client.clientId, name: client.clientName, uri: '', logo_uri: '' },
        user: { id: '11111111-1111-4111-8111-111111111111', email: 'e2e@example.test' },
      },
    }));
    await page.route('**/api/access/agents/*/clients', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fallback(); return; }
      approvals.push({ domain: route.request().url().includes('/employment/') ? 'Employment' : 'Inventory', body: route.request().postDataJSON() });
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' }, json: client });
    });
    await page.route('**/api/access/oauth2/authorize', async route => {
      const form = new URLSearchParams(route.request().postData() || '');
      expect(form.get('client_id')).toBe(client.clientId);
      expect(form.get('state')).toBe('employment-request');
      expect(form.get('scope')).toBe('mcp');
      expect(form.get('_csrf')).toBe('fixture-csrf');
      await route.fulfill({ contentType: 'text/html', body: '<h1>Client connected</h1>' });
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
    if (width === 390) {
      const normalFontSize = await allow.evaluate(button => parseFloat(getComputedStyle(button).fontSize));
      await page.locator('.oauth-consent-card *').evaluateAll(elements => {
        const sizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
        elements.forEach((element, index) => { (element as HTMLElement).style.setProperty('font-size', `${sizes[index] * 1.25}px`, 'important'); });
      });
      await expect.poll(() => allow.evaluate(button => parseFloat(getComputedStyle(button).fontSize)))
        .toBeCloseTo(normalFontSize * 1.25, 1);
      const enlargedFontSize = await allow.evaluate(button => parseFloat(getComputedStyle(button).fontSize));
      await testInfo.attach('actual-text-size', { body: JSON.stringify({ normalFontSize, enlargedFontSize }), contentType: 'application/json' });
      await allow.scrollIntoViewIfNeeded();
      await expect(allow).toBeInViewport();
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const buttonBounds = await allow.boundingBox();
      expect(buttonBounds).not.toBeNull();
      expect(buttonBounds!.y + buttonBounds!.height).toBeLessThan(844 - 8);
      await page.screenshot({ path: testInfo.outputPath('consent-actions-large-text-390.png') });
      const gaps = await allow.evaluate(button => {
        const outer = button.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(button);
        const label = range.getBoundingClientRect();
        return { left: label.left - outer.left, right: outer.right - label.right,
          top: label.top - outer.top, bottom: outer.bottom - label.bottom };
      });
      await testInfo.attach('button-label-clearance', { body: JSON.stringify(gaps), contentType: 'application/json' });
      expect(Math.min(gaps.left, gaps.right, gaps.top, gaps.bottom)).toBeGreaterThan(7);
    }
    await allow.press('Enter');
    await expect(page.getByRole('heading', { name: 'Client connected' })).toBeVisible();
    expect(approvals).toEqual([{ domain: 'Employment', body: { clientId: client.clientId, clientName: client.clientName } }]);
  });

  test(`Settings revokes Employment without changing Inventory at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    await page.setViewportSize({ width: 1440, height: 844 });
    let employmentClient = { ...client };
    const revokedDomains: string[] = [];
    let oauthGrantRevocations = 0;
    await page.route('**/api/access/agents/inventory/clients', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' }, json: [client] }));
    await page.route('**/api/access/agents/employment/clients', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' }, json: [employmentClient] }));
    await page.route('**/api/access/agents/*/clients/*', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fallback(); return; }
      const domain = route.request().url().includes('/employment/') ? 'Employment' : 'Inventory';
      revokedDomains.push(domain);
      expect(route.request().method()).toBe('DELETE');
      expect(new URL(route.request().url()).pathname.endsWith('/' + client.clientId)).toBe(true);
      employmentClient = { ...client, revokedAt: '2026-09-14T13:00:00.000Z' };
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' }, json: employmentClient });
    });
    await page.route('**/auth/v1/user/oauth/grants*', async route => {
      oauthGrantRevocations++;
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' }, json: {} });
    });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).click();
    await page.setViewportSize({ width, height: 844 });
    const panel = page.getByRole('region', { name: 'Codex Employment Access' });
    const revoke = panel.getByRole('button', { name: `Revoke Employment access for ${client.clientName}` });
    await revoke.scrollIntoViewIfNeeded();
    await expect(revoke).toBeEnabled();
    await panel.evaluate(element => element.scrollIntoView({ block: 'center' }));
    if (width === 390) {
      const nav = await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).boundingBox();
      const bounds = await panel.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThan(nav!.y - 8);
      await testInfo.attach('approval-panel-clearance', { body: JSON.stringify({ panel: bounds, navigation: nav }), contentType: 'application/json' });
    }
    await page.screenshot({ path: testInfo.outputPath(`employment-access-${width}.png`) });
    await revoke.focus();
    await revoke.press('Enter');
    await expect(panel.getByRole('status')).toHaveText(/can no longer access Employment/);
    await expect(revoke).toBeDisabled();
    expect(revokedDomains).toEqual(['Employment']);
    expect(oauthGrantRevocations).toBe(0);
    const inventoryPanel = page.getByRole('region', { name: 'Codex Inventory Access' });
    await expect(inventoryPanel).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.evaluate(element => element.scrollIntoView({ block: 'center' }));
    if (width === 390) {
      const nav = await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).boundingBox();
      const bounds = await panel.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThan(nav!.y - 8);
      await testInfo.attach('revoked-panel-clearance', { body: JSON.stringify({ panel: bounds, navigation: nav }), contentType: 'application/json' });
    }
    await page.screenshot({ path: testInfo.outputPath(`employment-revoked-${width}.png`) });
  });
}
