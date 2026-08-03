import { expect, test } from './support/helm-fixture';

const SECRET_ID = '99999999-9999-4999-8999-999999999999';

test.describe('Secrets', () => {
  test.beforeEach(async ({ page, scenario }) => {
    await scenario('empty', {
      surface: 'secrets',
      secrets: [{
        secretId: SECRET_ID,
        label: 'Sabah One production database password',
        kind: 'database',
        environment: 'production',
        projectCatalogKeys: ['catalog:helm'],
        value: 'e2e-sensitive-value',
        username: 'postgres',
      }],
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeVisible();
  });

  test('@smoke reveals and hides one credential without exposing it by default', async ({ page }) => {
    await expect(page.getByText('Sabah One production database password')).toBeVisible();
    await expect(page.getByText('e2e-sensitive-value')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reveal' }).click();
    await expect(page.getByText('e2e-sensitive-value')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByText('e2e-sensitive-value')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('adds, reloads, archives, and restores without local secret persistence', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Secret' }).click();
    await page.getByLabel('Label', { exact: true }).fill('Deployment API key');
    await page.getByLabel('Type', { exact: true }).selectOption('api_key');
    await page.getByLabel('Environment', { exact: true }).fill('production');
    await page.getByLabel('Secret value', { exact: true }).fill('created-e2e-sensitive-value');
    await page.getByRole('button', { name: 'Save Secret' }).click();

    await expect(page.getByText('Deployment API key saved securely.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deployment API key' })).toBeVisible();
    await expect(page.getByText('created-e2e-sensitive-value')).toHaveCount(0);
    expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => (
      key.startsWith('helm:') && value.includes('created-e2e-sensitive-value')
    )))).toBe(false);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Deployment API key' })).toBeVisible();
    await expect(page.getByText('created-e2e-sensitive-value')).toHaveCount(0);

    const deploymentCard = page.getByRole('article').filter({ hasText: 'Deployment API key' });
    await deploymentCard.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('heading', { name: 'Deployment API key' })).toHaveCount(0);

    await page.getByText('Show archived').click();
    const archivedCard = page.getByRole('article').filter({ hasText: 'Deployment API key' });
    await expect(archivedCard.getByText('Archived', { exact: true })).toBeVisible();
    await archivedCard.getByRole('button', { name: 'Restore' }).click();
    await expect(archivedCard.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  });

  test('keeps the current screen read-only, clears plaintext, and recovers automatically', async ({ page, context }) => {
    await page.getByRole('button', { name: 'Reveal' }).click();
    await expect(page.getByText('e2e-sensitive-value')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('sync-status-banner')).toContainText('Offline');
    await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sabah One is reconnecting' })).toHaveCount(0);
    await expect(page.getByText('e2e-sensitive-value')).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByTestId('sync-status-banner')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeVisible();
    await expect(page.getByText('e2e-sensitive-value')).toHaveCount(0);
  });
});
