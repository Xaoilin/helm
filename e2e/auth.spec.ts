import { expect, test } from './support/helm-fixture';

test.describe('account boot boundary', () => {
  test('keeps signed-out visitors behind the account gate', async ({ page, scenario }) => {
    await scenario({ authenticated: false });
    const releaseCheck = page.waitForRequest('**/release.json?*');
    await page.goto('/');
    await releaseCheck;

    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Offline and anonymous data changes are not supported.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('opens the signed-in account straight from its services and reads no account records from Supabase', async ({ page, scenario }) => {
    await scenario();
    const supabaseCalls: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/rest/v1/')) supabaseCalls.push(url.pathname);
    });
    const realtimeSockets: string[] = [];
    page.on('websocket', socket => {
      if (socket.url().includes('/realtime/')) realtimeSockets.push(socket.url());
    });
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'dashboard surface' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connecting to Sabah One' })).toHaveCount(0);
    expect(supabaseCalls.filter(path => /helm_records|helm_account_state|get_helm_|apply_helm_/u.test(path))).toEqual([]);
    expect(realtimeSockets).toEqual([]);
  });
});
