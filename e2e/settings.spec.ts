import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
  });

  test('should show settings page header', async ({ page }) => {
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('should contain key settings sections', async ({ page }) => {
    // Check page content includes these text strings (even if not visible in viewport)
    const content = await page.textContent('body');
    expect(content).toContain('Data Sync');
    expect(content).toContain('Calendar');
    expect(content).toContain('Voice Assistant');
  });

  test('should let you choose a hosted OpenAI model preset', async ({ page }) => {
    const hostedModelSelect = page.getByLabel('Hosted OpenAI model');
    await hostedModelSelect.selectOption('gpt-5.4-mini');
    await expect(hostedModelSelect).toHaveValue('gpt-5.4-mini');
    await expect(page.getByText('GPT-5.4 mini', { exact: true })).toBeVisible();
    await expect(page.getByText(/Lower-cost hosted model with strong general performance/i)).toBeVisible();
    await hostedModelSelect.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/manual-settings-model-picker-v024.png',
      fullPage: false,
    });
  });

  test('should open a review modal for signed-in data sync drift', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      const settings = {
        theme: 'dark',
        telemetry: false,
        supabaseUrl: 'https://helm.test.supabase.co',
        supabaseAnonKey: 'helm-test-anon-key',
      };
      localStorage.setItem('helm:settings', JSON.stringify(settings));
      localStorage.setItem('helm:knowledgeEntries', JSON.stringify([
        { id: 'note-1', title: 'Device note', content: 'Local copy', topicId: 'topic-1' },
      ]));
      localStorage.setItem('sb-helm-auth-token', JSON.stringify({
        access_token: 'test-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'test-refresh-token',
        user: {
          id: 'user-sync-drift',
          email: 'sync@example.com',
          app_metadata: { provider: 'google' },
          user_metadata: {},
          aud: 'authenticated',
          role: 'authenticated',
        },
      }));
    });

    await page.route('https://helm.test.supabase.co/rest/v1/kv_store**', async route => {
      const url = route.request().url();
      const method = route.request().method();
      if (method !== 'GET') {
        await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
        return;
      }

      if (url.includes('key=eq.knowledgeEntries')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            value: [{ id: 'note-1', title: 'Database note', content: 'Cloud copy', topicId: 'topic-1' }],
            updated_at: '2026-05-01T10:00:00.000Z',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 406,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'No rows found' }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Settings' }).click();

    const dialog = page.getByRole('dialog', { name: 'Data differences need review' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
    await expect(dialog.getByLabel(/Keep database/i)).toBeChecked();
    await expect(dialog.getByText('Device note', { exact: true })).toBeVisible();
    await dialog.getByText('Exact JSON').click();
    await expect(dialog.getByText('Database note')).toBeVisible();
    await page.screenshot({
      path: 'test-results/manual-settings-sync-drift-modal-v0263.png',
      fullPage: false,
    });
  });
});
