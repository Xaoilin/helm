import { expect, openApp, test, waitForMutation } from './support/helm-fixture';
import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource } from '../src/test/fixtures';

for (const width of [390, 1440]) {
  test(`Calendar Knowledge and Health controls work by keyboard at ${width}px`, async ({ page, scenario }, testInfo) => {
    const timestamp = '2026-09-08T10:00:00.000Z';
    await scenario({ now: timestamp, settings: { defaultCalendarTab: 'month' }, stores: {
      calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()],
      calendarEvents: [makeCalendarEvent({ title: 'Keyboard review', start: '2026-09-08T11:00:00.000Z', end: '2026-09-08T12:00:00.000Z' })],
      knowledgeTopics: [{ id: 'topic-notes', name: 'Notes', description: 'Synthetic topic', icon: '📖', color: '#3b82f6', sortOrder: 0, createdAt: timestamp, updatedAt: timestamp }],
      knowledgeEntries: [{ id: 'entry-notes', topicId: 'topic-notes', title: 'Keyboard note', content: 'A synthetic entry to open with a keyboard.', sources: [], tags: [], createdAt: timestamp, updatedAt: timestamp }],
      healthFastFoodEntries: [{ id: 'health-entry', venue: 'Fixture cafe', date: '2026-09-08', rating: 'mixed', symptoms: [], notes: 'Synthetic reflection.', createdAt: timestamp, updatedAt: timestamp }],
    } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['Month', 'Week', 'Agenda']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      if (view === 'Month') {
        const day = page.getByRole('button', { name: 'Select Wednesday, Sep 9', exact: true });
        const cell = day.locator('..');
        const box = await cell.boundingBox();
        await cell.click({ position: { x: box!.width - 4, y: box!.height - 4 } });
        await expect(day).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: 'Select Tuesday, Sep 8', exact: true }).click();
      }
      const event = page.getByRole('button', { name: width === 390 && view === 'Week' ? '12:00 PM Keyboard review' : 'Open Keyboard review', exact: true });
      await page.keyboard.press('Tab');
      await event.focus();
      await expect(event).toBeFocused();
      await expect(event.locator('button, a[href], input, select')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`calendar-${view.toLowerCase()}-${width}.png`) });
      await page.keyboard.press(view === 'Week' ? 'Space' : 'Enter');
      const editor = page.getByRole('dialog', { name: 'Edit Event' });
      await expect(editor).toBeVisible();
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Navigate to Knowledge', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const topic = page.getByRole('button', { name: 'Open Notes', exact: true });
    await page.keyboard.press('Tab');
    await topic.focus();
    await expect(topic.locator('button, a[href], input, select')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`knowledge-topic-${width}.png`) });
    await page.keyboard.press('Space');
    const entry = page.getByRole('button', { name: 'Open Keyboard note', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Collapse Keyboard note' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('A synthetic entry to open with a keyboard.', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`knowledge-entry-${width}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Navigate to Health', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const remove = page.getByRole('button', { name: 'Remove', exact: true });
    await remove.focus();
    page.once('dialog', prompt => { void prompt.dismiss(); });
    await page.keyboard.press('Enter');
    await expect(remove).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`health-cancel-${width}.png`) });
    const write = waitForMutation(page, 'healthFastFoodEntries');
    page.once('dialog', prompt => { void prompt.accept(); });
    await page.keyboard.press('Space');
    await write;
    await expect(remove).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`dirty editors survive dismissal and keep controls reachable at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    const editors = [
      { surface: 'Secrets', open: /Add Secret/, name: 'Add secret', field: 'Label' },
      { surface: 'Trips', open: /Plan Trip/, name: 'Plan trip', field: 'Trip Name' },
      { surface: 'Tasks', open: /Add Task/, name: 'Add Task', field: 'Title' },
    ];
    const scrollEvidence = [];
    for (const editor of editors) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: `Navigate to ${editor.surface}`, exact: true }).click();
      await page.setViewportSize({ width, height: width === 390 ? 500 : 900 });
      const opener = page.getByRole('button', { name: editor.open }).first();
      await opener.click();
      const dialog = page.getByRole('dialog', { name: editor.name, exact: true });
      const field = dialog.getByLabel(editor.field, { exact: true });
      await expect(field).toBeFocused();
      await field.fill('Retain this synthetic draft');
      if (editor.surface === 'Secrets') await dialog.getByLabel('Secret value', { exact: true }).fill('synthetic-draft-value');
      for (const dismiss of ['Escape', 'backdrop', 'Cancel']) {
        const confirmation = page.waitForEvent('dialog').then(async prompt => {
          expect(prompt.message()).toContain('Discard unsaved changes');
          await prompt.dismiss();
        });
        if (dismiss === 'Escape') await page.keyboard.press('Escape');
        else if (dismiss === 'backdrop') await page.locator('.modal-overlay').click({ position: { x: 2, y: 2 } });
        else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await confirmation;
        await expect(field).toHaveValue('Retain this synthetic draft');
        if (editor.surface === 'Secrets') await expect(dialog.getByLabel('Secret value', { exact: true })).toHaveValue('synthetic-draft-value');
      }
      const size = await dialog.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      if (width === 390) {
        expect(size.scroll).toBeGreaterThan(size.client);
        await field.focus();
        const before = await field.boundingBox();
        await dialog.hover();
        await page.mouse.wheel(0, 500);
        await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        const after = await field.boundingBox();
        expect(after!.y).toBeLessThan(before!.y);
        await dialog.evaluate(element => { element.scrollTop = 0; });
        await dialog.focus();
        await page.keyboard.press('PageDown');
        await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        scrollEvidence.push({ surface: editor.surface, ...size, beforeY: before!.y, afterY: after!.y, keyboardScrollTop: await dialog.evaluate(element => element.scrollTop) });
      }
      await field.focus();
      await expect(field).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${editor.surface.toLowerCase()}-draft-${width}.png`) });
      page.once('dialog', prompt => { void prompt.accept(); });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
    }
    await testInfo.attach('editor-scroll-evidence', { body: JSON.stringify(scrollEvidence), contentType: 'application/json' });
  });

  test(`Chat keeps a rejected quick prompt and retries once at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    // Inject a generic rejection at the runtime boundary. No model/provider is used.
    await page.route('**/src/assistant/runtime.ts*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export async function runAssistantTurn() {
        window.__kan310Sends = (window.__kan310Sends || 0) + 1;
        if (window.__kan310Sends === 1) throw new Error('Synthetic interruption');
        return { source: 'degraded', assistantMessage: 'Synthetic recovered response', dialogState: {} };
      }
      export const isOllamaAvailable = () => false;
      export const resetOllamaAvailability = () => {};`,
    }));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Chat', exact: true }).click();
    if (width === 390) await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Help me plan my week', exact: true }).click();
    const error = page.locator('.chat-main').getByRole('alert');
    await expect(error).toContainText('Synthetic interruption');
    await expect(page.getByPlaceholder('Type a message...')).toBeEnabled();
    await expect(page.locator('.chat-message.user')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`chat-retry-${width}.png`) });
    await error.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Synthetic recovered response', { exact: true })).toBeVisible();
    await expect(page.locator('.chat-message.user')).toHaveCount(1);
    expect(await page.evaluate(() => Reflect.get(window, '__kan310Sends'))).toBe(2);
    await expect(error).toBeHidden();
  });
}
