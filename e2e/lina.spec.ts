import { test, expect } from '@playwright/test';

test.describe('Lina Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.sidebar');
  });

  test('should show L button on dashboard', async ({ page }) => {
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel when L button clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    // Panel should appear with Lina header
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should close panel when X clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button[aria-label="Close Lina"]')).toBeVisible();
    await page.locator('button[aria-label="Close Lina"]').click();
    // Panel should be gone, L button should be back
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should close panel on Escape', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel with Ctrl+Shift+L', async ({ page }) => {
    await page.keyboard.press('Control+Shift+L');
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should show quick command chips', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button:has-text("next meeting")')).toBeVisible();
    await expect(page.locator('button:has-text("tasks left")')).toBeVisible();
    await expect(page.locator('button:has-text("prayer times")')).toBeVisible();
  });

  test('should respond to quick command chip click', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.locator('button:has-text("tasks left")').click();
    // Should show a response — either English or Arabic depending on lang setting
    await expect(page.locator('.va-lina')).toBeVisible({ timeout: 10000 });
  });

  test('should respond to text input', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    const input = page.locator('input[placeholder*="Type"]');
    await input.fill('open calendar');
    await input.press('Enter');
    // Should navigate to calendar
    await expect(page.locator('h1:has-text("Calendar")')).toBeVisible({ timeout: 5000 });
  });

  test('should create a polite task request and reveal it in All Tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');
    await input.fill('Can you add a task for me to put the mirror up on the office?');
    await input.press('Enter');

    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "put the mirror up on the office" to your tasks.');

    await input.fill('Show me that task.');
    await input.press('Enter');

    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'All Tasks' })).toHaveClass(/active/);
    await expect(page.locator('.task-row.assistant-focus')).toContainText('put the mirror up on the office');
  });

  test('should keep undated assistant-created tasks out of Today but visible in All Tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');
    await input.fill('Can you add a task for me to put the mirror up on the office?');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "put the mirror up on the office" to your tasks.');

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Today' })).toHaveClass(/active/);
    await expect(page.locator('text=Nothing for today')).toBeVisible();
    await expect(page.locator('text=put the mirror up on the office')).toHaveCount(0);

    await page.getByRole('button', { name: 'All Tasks' }).click();
    await expect(page.locator('text=put the mirror up on the office')).toBeVisible();
  });

  test('should confirm and delete all matching mirror tasks from chat', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');

    await input.fill('Add task hang up the mirror in this small office');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "hang up the mirror in this small office" to your tasks.');

    await input.fill('Add task buy mirror hooks for the hallway');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "buy mirror hooks for the hallway" to your tasks.');

    await input.fill('Delete all of the tasks related to mirrors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks matching "mirrors"');

    await input.fill('yes');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Deleted 2 tasks matching "mirrors".');

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await page.getByRole('button', { name: 'All Tasks' }).click();
    await expect(page.locator('text=hang up the mirror in this small office')).toHaveCount(0);
    await expect(page.locator('text=buy mirror hooks for the hallway')).toHaveCount(0);
  });

  test('should learn "no, I said" corrections and reuse them for later commands', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');

    await input.fill('Add task hang up the mirror in this small office');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "hang up the mirror in this small office" to your tasks.');

    await input.fill('Add task buy mirror hooks for the hallway');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "buy mirror hooks for the hallway" to your tasks.');

    await input.fill('Delete all of the tasks related to minors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText(`I couldn't find any tasks matching "minors".`);

    await input.fill('No, I said delete all of the tasks related to mirrors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText(`Thanks, I'll remember that.`);
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks matching "mirrors"');

    await input.fill('cancel');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Okay, I cancelled that.');

    await input.fill('Delete all of the tasks related to minors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks matching "mirrors"');
  });
});
