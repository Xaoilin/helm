import { expect, test } from './support/helm-fixture';

test('should show the validated clarify reply instead of a raw hosted unsupported-action approximation', async ({
  page,
  scenario,
}) => {
  await scenario('hosted-assistant', {
    storage: {
      'helm:tasks': [
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
      ],
    },
    assistant: body => {
      if (body.action === 'health') {
        return {
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
        };
      }

      if (body.action === 'turn') {
        return {
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
        };
      }

      return {
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        text: JSON.stringify({
          assistantMessage: 'This narration should not be used for unsupported-action clarifications.',
        }),
      };
    },
  });

  await page.goto('/');
  await page.waitForSelector('.sidebar');
  await page.getByRole('button', { name: 'Navigate to Chat' }).click();
  await page.locator('.chat-main button:has-text("New conversation")').click();

  const input = page.locator('input[placeholder*="Type a message"]');
  await input.fill('Turn my internet off');
  await input.press('Enter');

  const assistantReply = page.locator('.chat-message.assistant').last();
  await expect(assistantReply).toContainText('I can help inside Sabah One, but I cannot control device or internet settings from here.');
  await expect(assistantReply).not.toContainText('mark the task');
  await expect(assistantReply).not.toContainText('as done');
});
