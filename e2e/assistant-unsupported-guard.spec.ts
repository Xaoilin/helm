import { test, expect } from '@playwright/test';

const SETTINGS_KEY = 'helm:settings';

test('should show the validated clarify reply instead of a raw hosted unsupported-action approximation', async ({ page }) => {
  await page.addInitScript(({ settingsKey }) => {
    localStorage.clear();
    localStorage.setItem(settingsKey, JSON.stringify({
      assistantProvider: 'hosted',
      assistantLanguage: 'en',
      theme: 'dark',
      telemetry: false,
      supabaseUrl: 'https://helm.test.supabase.co',
      supabaseAnonKey: 'helm-test-anon-key',
    }));
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-internet',
        title: 'Internet',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        progress: 0,
        emoji: '📝',
        subTasks: [],
        createdAt: '2026-04-13T09:00:00.000Z',
        updatedAt: '2026-04-13T09:00:00.000Z',
      },
    ]));
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
            text: JSON.stringify({
              mode: 'confirm',
              assistantMessage: 'Just to confirm — do you want me to mark the task “Internet” as done?',
              toolCalls: [{
                capability: 'tasks.complete_matching',
                args: {
                  taskId: 'task-internet',
                },
              }],
            }),
          },
          rawResponse: 'mock-unsupported-turn',
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
          assistantMessage: 'This narration should not be used for unsupported-action clarifications.',
        }),
      }),
    });
  });

  await page.goto('/');
  await page.waitForSelector('.sidebar');
  await page.getByRole('button', { name: 'Navigate to Chat' }).click();
  await page.locator('.chat-main button:has-text("New conversation")').click();

  const input = page.locator('input[placeholder*="Type a message"]');
  await input.fill('Turn my internet off');
  await input.press('Enter');

  const assistantReply = page.locator('.chat-message.assistant').last();
  await expect(assistantReply).toContainText('I can help inside HELM, but I cannot control device or internet settings from here.');
  await expect(assistantReply).not.toContainText('mark the task');
  await expect(assistantReply).not.toContainText('as done');
});
