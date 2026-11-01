import { expect, test } from './support/helm-fixture';

test.describe('account boot boundary', () => {
  test('Google sign-in requests identity without Calendar access or repeated consent', async ({ page, scenario }) => {
    await scenario({ authenticated: false });
    await page.route('**/auth/v1/authorize?*', route => route.fulfill({
      contentType: 'text/html',
      body: '<h1>Google sign-in handoff</h1>',
    }));
    await page.goto('/');
    const appUrl = page.url();

    const authorization = page.waitForRequest('**/auth/v1/authorize?*');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const params = new URL((await authorization).url()).searchParams;

    expect(params.get('provider')).toBe('google');
    expect(params.get('scopes')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(params.get('include_granted_scopes')).toBe('false');
    expect(params.has('prompt')).toBe(false);
    expect(params.has('access_type')).toBe(false);
    expect(params.get('redirect_to')).toBe(new URL('/helm/', appUrl).href);
    await expect(page.getByRole('heading', { name: 'Google sign-in handoff' })).toBeVisible();
  });

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
