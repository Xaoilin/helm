import { expect, test } from './support/helm-fixture';

test('pasted document links wrap inside both the Knowledge preview and expanded note', async ({ page, scenario }, testInfo) => {
  const source = 'https://example.test/documents/' + 'a3b91dfe'.repeat(11);
  const dates = { createdAt: '2026-11-22T12:00:00Z', updatedAt: '2026-11-22T12:00:00Z' };
  await page.setViewportSize({ width: 320, height: 700 });
  await scenario({
    initialSurface: 'knowledge',
    stores: {
      knowledgeTopics: [{ id: 'guides', name: 'Guides', description: '', icon: '📖', color: '#8491aa', sortOrder: 0, ...dates }],
      knowledgeEntries: [{ id: 'reference', topicId: 'guides', title: 'Shared reference document', content: source,
        sources: [{ type: 'other', title: 'Reference document' }], tags: [], ...dates }],
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Open Guides/ }).click();
  const card = page.locator('.kb-entry-card');
  const header = card.getByRole('button', { name: /Shared reference document/ });
  for (const selector of ['.kb-entry-preview', '.kb-entry-content']) {
    if (selector === '.kb-entry-content') await header.click();
    const paragraph = card.locator(selector);
    await expect(paragraph).toHaveText(source);
    expect(await paragraph.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const right = element.getBoundingClientRect().right;
      return [...range.getClientRects()].every(line => line.right <= right + 1);
    }), selector).toBe(true);
  }
  await card.scrollIntoViewIfNeeded();
  const edge = (await card.boundingBox())!.y;
  const sticky = (await page.locator('.surface-header').boundingBox())!;
  await page.getByRole('main').evaluate((main, offset) => main.scrollBy(0, offset), edge - sticky.y - sticky.height - 12);
  await page.screenshot({ path: testInfo.outputPath('knowledge-note-320.png') });
});
