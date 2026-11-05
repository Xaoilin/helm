import { expect, openApp, test } from './support/helm-fixture';

test('retired account Secrets and its voice prototype never request Vault or appear in navigation', async ({ page, scenario }) => {
  await scenario();
  const calls: string[] = [];
  page.on('request', request => {
    if (/\/rest\/v1\/|\/functions\/v1\/sabah-one-jev-voice/.test(request.url())) calls.push(request.url());
  });
  await page.addInitScript(() => { sessionStorage.setItem('helm:shell:surface', 'secrets'); });
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Navigate to Secrets', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Jev voice prototype' })).toHaveCount(0);
  expect(calls).toEqual([]);
});
