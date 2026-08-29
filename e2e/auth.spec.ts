import { expect, test } from './support/helm-fixture';

test.describe('account boot boundary', () => {
  test('keeps signed-out visitors behind the account gate', async ({ page, scenario }) => {
    await scenario({ authenticated: false });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Offline and anonymous data changes are not supported.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('keeps account data closed when the database snapshot is unavailable', async ({ page, scenario }) => {
    await scenario({ snapshotStatus: 503 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Connecting to Sabah One' })).toBeVisible();
    await expect(page.getByText('Loading your account from the database.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });
});
