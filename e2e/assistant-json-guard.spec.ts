import { test, expect } from '@playwright/test';

const SETTINGS_KEY = 'helm:settings';

test('should not render malformed hosted planner JSON in chat', async ({ page }) => {
  await page.addInitScript(({ settingsKey }) => {
    localStorage.clear();
    localStorage.setItem(settingsKey, JSON.stringify({
      credentialSource: 'onepassword-first',
      theme: 'dark',
      dataRetentionDays: 90,
      telemetry: false,
      assistantProvider: 'hosted',
      assistantLanguage: 'en',
      supabaseUrl: 'https://helm.test.supabase.co',
      supabaseAnonKey: 'helm-test-anon-key',
    }));
  }, {
    settingsKey: SETTINGS_KEY,
  });

  await page.route('**/functions/v1/assistant-openai', async route => {
    const body = route.request().postDataJSON() as { action?: string } | null;

    if (body?.action === 'health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
        }),
      });
      return;
    }

    if (body?.action === 'turn') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
          turn: {
            type: 'text',
            text: '{"mode":"tool_calls","assistantMessage":"","toolCalls":[{"capability":"tasks.open_view"',
          },
          rawResponse: '{"mode":"tool_calls","assistantMessage":"","toolCalls":[{"capability":"tasks.open_view"',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        text: JSON.stringify({
          assistantMessage: 'This narration should never be shown for an invalid planner turn.',
        }),
      }),
    });
  });

  await page.goto('/');
  await page.waitForSelector('.sidebar');

  await page.getByRole('button', { name: 'Navigate to Chat' }).click();
  await page.locator('.chat-main button:has-text("New conversation")').click();

  const input = page.locator('input[placeholder*="Type a message"]');
  await input.fill('brainstorm my week');
  await input.press('Enter');

  const assistantReply = page.locator('.chat-message.assistant').last();
  await expect(assistantReply).toContainText('I had trouble interpreting the model response');
  await expect(assistantReply).not.toContainText('"mode":"tool_calls"');

  await page.screenshot({
    path: 'test-results/manual-hosted-json-guard-v0219.png',
    fullPage: true,
  });
});
