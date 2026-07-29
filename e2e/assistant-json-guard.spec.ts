import { expect, test } from './support/helm-fixture';

test('should not render malformed hosted planner JSON in chat', async ({ page, scenario }) => {
  await scenario('hosted-assistant', {
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
            text: '{"mode":"tool_calls","assistantMessage":"","toolCalls":[{"capability":"tasks.open_view"',
          },
          rawResponse: '{"mode":"tool_calls","assistantMessage":"","toolCalls":[{"capability":"tasks.open_view"',
        };
      }

      return {
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        text: JSON.stringify({
          assistantMessage: 'This narration should never be shown for an invalid planner turn.',
        }),
      };
    },
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

});
