import type { Page } from '@playwright/test';
import { expect, test } from './support/helm-fixture';

test.describe('Settings', () => {
  test('should show settings page header', async ({ page, scenario }) => {
    await scenario('empty');
    await openSettings(page);
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('should contain key settings sections', async ({ page, scenario }) => {
    await scenario('empty');
    await openSettings(page);
    const content = await page.textContent('body');
    expect(content).toContain('Data Sync');
    expect(content).toContain('Calendar');
    expect(content).toContain('Voice Assistant');
  });

  test('should let you choose a hosted OpenAI model preset', async ({ page, scenario }) => {
    await scenario('empty');
    await openSettings(page);
    const hostedModelSelect = page.getByLabel('Hosted OpenAI model');
    await hostedModelSelect.selectOption('gpt-5.4-mini');
    await expect(hostedModelSelect).toHaveValue('gpt-5.4-mini');
    await expect(page.getByText('GPT-5.4 mini', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Lower-cost hosted model with strong general performance/i),
    ).toBeVisible();
  });

  test('should open a review modal for signed-in data sync drift', async ({
    page,
    scenario,
  }) => {
    await scenario('signed-in-sync', {
      userId: 'user-sync-drift',
      localStores: {
        knowledgeEntries: [
          { id: 'note-1', title: 'Device note', content: 'Local copy', topicId: 'topic-1' },
        ],
      },
      remoteStores: {
        knowledgeEntries: {
          value: [
            { id: 'note-1', title: 'Database note', content: 'Cloud copy', topicId: 'topic-1' },
          ],
        },
      },
    });

    await openSettings(page);

    const dialog = page.getByRole('dialog', { name: 'Data differences need review' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
    await expect(dialog.getByLabel(/Keep database/i)).toBeChecked();
    await expect(dialog.locator('.sync-drift-diff-list')).toContainText('Device note');
    await expect(dialog.getByText(/Title: database/)).toBeVisible();
    await dialog.getByText('Highlighted JSON diff').click();
    await expect(dialog.locator('.sync-drift-json-diff')).toContainText(
      '"title": "Database note"',
    );
    await expect(dialog.locator('.sync-drift-json-diff-row.database')).not.toHaveCount(0);
    await expect(dialog.locator('.sync-drift-json-diff-row.device')).not.toHaveCount(0);
  });

  test('should not open drift review for metadata-only integration timestamps', async ({
    page,
    scenario,
  }) => {
    await scenario('signed-in-sync', {
      userId: 'user-sync-metadata',
      localStores: {
        integrations: [
          {
            id: 'int-google',
            icon: 'calendar',
            name: 'Google Calendar',
            status: 'connected',
            provider: 'google',
            description: 'Sync Google Calendar events',
            configuredAt: '2026-04-26T18:55:19.267Z',
          },
        ],
      },
      remoteStores: {
        integrations: {
          value: [
            {
              id: 'int-google',
              icon: 'calendar',
              name: 'Google Calendar',
              status: 'connected',
              provider: 'google',
              description: 'Sync Google Calendar events',
              configuredAt: '2026-05-06T10:31:06.224Z',
            },
          ],
          updatedAt: '2026-05-06T10:31:06.224Z',
        },
      },
    });

    await openSettings(page);

    await expect(page.locator('.sync-status-title')).toHaveText('Synced with Supabase');
    await expect(
      page.getByRole('dialog', { name: 'Data differences need review' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review differences' })).toHaveCount(0);
  });
});

async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Navigate to Settings' }).click();
}
