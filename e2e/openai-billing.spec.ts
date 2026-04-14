import { expect, test } from '@playwright/test';

const SETTINGS_KEY = 'helm:settings';

test.describe('OpenAI billing visibility', () => {
  test.beforeEach(async ({ page }) => {
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
              text: JSON.stringify({
                mode: 'reply',
                assistantMessage: 'Here is a hosted reply.',
                toolCalls: [],
              }),
            },
            rawResponse: '{"mode":"reply","assistantMessage":"Here is a hosted reply.","toolCalls":[]}',
            usage: {
              responseId: 'resp-plan',
              model: 'gpt-5.4',
              serviceTier: 'default',
              inputTokens: 1000,
              cachedTokens: 100,
              outputTokens: 200,
              reasoningTokens: 120,
              totalTokens: 1200,
            },
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
            assistantMessage: 'Here is a hosted narration.',
          }),
          usage: {
            responseId: 'resp-narration',
            model: 'gpt-5.4',
            serviceTier: 'default',
            inputTokens: 600,
            cachedTokens: 50,
            outputTokens: 120,
            reasoningTokens: 70,
            totalTokens: 720,
          },
        }),
      });
    });

    await page.route('**/functions/v1/assistant-openai-billing', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          projectId: 'proj_helm_hosted',
          fetchedAt: '2026-04-14T10:00:00.000Z',
          costs: [
            {
              startTime: 1775606400,
              endTime: 1775692800,
              amount: {
                currency: 'usd',
                value: 1.25,
              },
            },
          ],
          usage: [
            {
              startTime: 1775606400,
              endTime: 1775692800,
              results: [
                {
                  model: 'gpt-5.4',
                  serviceTier: 'default',
                  inputTokens: 1000,
                  cachedTokens: 100,
                  outputTokens: 250,
                  totalRequests: 3,
                },
              ],
            },
          ],
        }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('.sidebar');
  });

  test('shows an estimated conversation total in chat for hosted OpenAI turns only', async ({ page }) => {
    await page.addInitScript(({ conversations }) => {
      localStorage.setItem('helm:conversations', JSON.stringify(conversations));
    }, {
      conversations: [
        {
          id: 'conv-billing',
          title: 'Hosted billing conversation',
          createdAt: '2026-04-14T09:00:00.000Z',
          updatedAt: '2026-04-14T09:05:00.000Z',
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Show me my tasks.',
              timestamp: '2026-04-14T09:00:00.000Z',
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'Opening your tasks.',
              timestamp: '2026-04-14T09:00:05.000Z',
              assistantBilling: {
                provider: 'openai',
                model: 'gpt-5.4',
                requestCount: 2,
                requests: [
                  {
                    kind: 'planner',
                    responseId: 'resp-plan',
                    model: 'gpt-5.4',
                    serviceTier: 'default',
                    inputTokens: 1000,
                    cachedTokens: 100,
                    outputTokens: 200,
                    reasoningTokens: 120,
                    totalTokens: 1200,
                    estimatedUsd: 0.005275,
                  },
                  {
                    kind: 'narration',
                    responseId: 'resp-narration',
                    model: 'gpt-5.4',
                    serviceTier: 'default',
                    inputTokens: 600,
                    cachedTokens: 50,
                    outputTokens: 120,
                    reasoningTokens: 70,
                    totalTokens: 720,
                    estimatedUsd: 0.003188,
                  },
                ],
                totals: {
                  inputTokens: 1600,
                  cachedTokens: 150,
                  outputTokens: 320,
                  reasoningTokens: 190,
                  totalTokens: 1920,
                },
                estimatedUsd: 0.008463,
                estimateStatus: 'estimated_from_openai_usage',
                estimateLabel: 'Estimated from OpenAI usage',
              },
            },
            {
              id: 'msg-3',
              role: 'assistant',
              content: 'Fallback reply.',
              timestamp: '2026-04-14T09:00:08.000Z',
              assistantBilling: {
                provider: 'local',
                model: 'local-fallback',
                requestCount: 0,
                requests: [],
              },
            },
          ],
        },
      ],
    });

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.getByText('Hosted billing conversation').click();

    await expect(page.getByText('Estimated OpenAI conversation total')).toBeVisible();
    await expect(page.getByText('$0.0085')).toBeVisible();
    await expect(page.getByText('OpenAI-hosted turns only; other turns excluded.')).toBeVisible();

    await page.screenshot({
      path: 'test-results/manual-openai-billing-chat-v026.png',
      fullPage: true,
    });
  });

  test('shows latest-turn estimates and factual project billing in debug', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');
    await input.fill('What should I focus on today?');
    await input.press('Enter');

    await expect(page.locator('.chat-message.assistant').last()).toContainText('Here is a hosted reply.');

    await page.getByRole('button', { name: 'Navigate to Debug' }).click();
    await page.getByRole('button', { name: /AI Assistant/i }).click();

    const latestTurnCard = page.getByText('Latest Assistant Turn Estimate').locator('..');
    const projectCostsCard = page.getByText('Last 7 UTC Days Of Factual Project Costs').locator('..');

    await expect(page.getByText('OpenAI billing loaded')).toBeVisible();
    await expect(page.getByText(/^OpenAI Billing$/)).toBeVisible();
    await expect(page.getByText('Latest Assistant Turn Estimate')).toBeVisible();
    await expect(latestTurnCard.getByText(/^Estimated total$/).locator('..').getByText(/^\$0\.0053$/)).toBeVisible();
    await expect(projectCostsCard.getByText(/^Project ID$/).locator('..').getByText(/^proj_helm_hosted$/)).toBeVisible();
    await expect(projectCostsCard.getByText(/^2026-04-08 UTC$/).locator('..').getByText(/^\$1\.25$/)).toBeVisible();

    await page.screenshot({
      path: 'test-results/manual-openai-billing-debug-v026.png',
      fullPage: true,
    });
  });
});
