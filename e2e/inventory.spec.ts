import type { Page } from '@playwright/test';
import {
  DEFAULT_INVENTORY_ITEMS,
  expect,
  test,
} from './support/helm-fixture';

test.describe('Sabah One Inventory', () => {
  test.beforeEach(async ({ scenario }) => {
    await scenario('inventory', { surface: 'inventory' });
  });

  test('@smoke filters owned stock and atomically acquires a linked need', async ({ page }) => {
    await openInventory(page);

    const inserts = inventoryCard(page, 'M3 heat-set inserts');
    await expect(inserts.getByText('Low stock', { exact: true })).toBeVisible();
    await expect(inserts.getByText('10 pcs', { exact: true })).toBeVisible();
    await expect(inserts.getByRole('img', { name: 'M3 heat-set inserts product photo' })).toBeVisible();

    await page.getByLabel('Filter inventory category').selectOption('measuring_tools');
    await expect(inventoryCard(page, 'Digital calipers')).toBeVisible();
    await expect(inventoryCard(page, 'M3 heat-set inserts')).toHaveCount(0);
    await page.getByLabel('Filter inventory category').selectOption('all');

    await page.getByLabel('Filter inventory project').selectOption('fixture:orbit-console');
    await expect(inventoryCard(page, 'Digital calipers')).toBeVisible();
    await expect(inventoryCard(page, 'M3 heat-set inserts')).toHaveCount(0);

    await page.getByLabel('Filter inventory project').selectOption('fixture:sensor-bench');
    await page.getByRole('tab', { name: 'Needed' }).click();
    const need = inventoryCard(page, 'M3 heat-set inserts');
    await need.getByRole('button', { name: 'Mark acquired' }).click();
    await expect(need.getByText('acquired', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Owned' }).click();
    await expect(inventoryCard(page, 'M3 heat-set inserts').getByText('60 pcs', { exact: true })).toBeVisible();
    await expect.poll(() => inventoryMutationCalls(page)).toBe(1);
    await expect.poll(async () => {
      const rows = await inventoryRows(page);
      return {
        itemQuantity: rows.find(row => row.collection === 'inventoryItems' && row.record_id === 'inventory-m3-inserts')?.payload.quantity,
        needStatus: rows.find(row => row.collection === 'inventoryNeeds' && row.record_id === 'need-m3-inserts')?.payload.status,
      };
    }).toEqual({ itemQuantity: 60, needStatus: 'acquired' });
  });

  test('reviews pasted candidates, warns on duplicates, and commits selected rows once', async ({ page }) => {
    await openInventory(page);
    await page.getByRole('button', { name: 'Paste and review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Paste and review' });
    await dialog.getByPlaceholder(/digital calipers/i).fill('2x Digital calipers\n100 M4 socket-head screws');
    await dialog.getByRole('button', { name: 'Review candidates' }).click();
    await expect(dialog.getByText('Likely duplicate')).toBeVisible();

    const candidates = dialog.locator('.inventory-review-row');
    await candidates.nth(0).getByRole('checkbox', { name: 'Save' }).uncheck();
    await dialog.getByRole('button', { name: 'Save selected' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(inventoryCard(page, 'M4 socket-head screws')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Digital calipers' })).toHaveCount(1);
    await expect.poll(() => inventoryMutationCalls(page)).toBe(1);
  });

  test('shows project-filtered records and links back to the global catalogue', async ({ page }) => {
    await openInventory(page);
    await page.getByRole('button', { name: 'Navigate to Projects' }).click();
    const sensorBench = page.locator('.project-catalog-card').filter({ hasText: 'Sensor Bench' });
    await sensorBench.getByRole('button', { name: 'View details' }).click();
    const details = page.getByRole('dialog', { name: 'Sensor Bench' });
    await details.getByRole('button', { name: 'Manage project' }).click();
    await page.getByRole('tab', { name: 'Inventory' }).click();

    const panel = page.getByRole('region', { name: 'Sensor Bench inventory' });
    await expect(panel.getByText('M3 heat-set inserts', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Digital calipers', { exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Open global Inventory' }).click();
    await expect(page.getByRole('heading', { name: 'Know what you have before you buy.' })).toBeVisible();
  });

  test('clears the previous account Inventory and keeps offline state read-only', async ({ context, page }) => {
    await openInventory(page);
    await expect(inventoryCard(page, 'M3 heat-set inserts')).toBeVisible();

    const secondUserId = '22222222-2222-4222-8222-222222222222';
    const secondItem = {
      ...DEFAULT_INVENTORY_ITEMS[1],
      id: 'inventory-account-two-meter',
      name: 'Account two multimeter',
      projectCatalogKeys: [],
    };
    await page.evaluate(async ({ item, userId }) => {
      await fetch('/__helm_e2e_switch_account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, stores: { inventoryItems: [item], inventoryNeeds: [] } }),
      });
      const raw = localStorage.getItem('sb-helm-auth-token');
      if (!raw) throw new Error('Missing test account session.');
      const session = JSON.parse(raw) as { user: { id: string; email: string } };
      session.user.id = userId;
      session.user.email = 'second@example.com';
      localStorage.setItem('sb-helm-auth-token', JSON.stringify(session));
    }, { item: secondItem, userId: secondUserId });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Account two multimeter' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'M3 heat-set inserts' })).toHaveCount(0);

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByTestId('sync-status-banner')).toContainText('Offline');
    await expect(page.locator('main[aria-label="inventory surface"]')).toHaveAttribute('aria-disabled', 'true');
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('sync-status-banner')).toHaveCount(0);
    await expect(page.locator('main[aria-label="inventory surface"]')).not.toHaveAttribute('aria-disabled', 'true');
  });
});

async function openInventory(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Know what you have before you buy.' })).toBeVisible();
}

function inventoryCard(page: Page, name: string) {
  return page.locator('.inventory-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

async function inventoryMutationCalls(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/__helm_e2e_metrics');
    const result = await response.json() as { inventoryMutationCalls: number };
    return result.inventoryMutationCalls;
  });
}

async function inventoryRows(page: Page): Promise<Array<{
  collection: string;
  record_id: string;
  payload: Record<string, unknown>;
}>> {
  return page.evaluate(async () => {
    const response = await fetch('/__helm_e2e_db');
    return response.json();
  });
}
