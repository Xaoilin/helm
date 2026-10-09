import type { Page } from '@playwright/test';

// Synthetic provider text: these fixtures are not Quran translations.
export function quranVerseFixture(verseKey: string): string {
  return `Quran.com translation fixture for verse ${verseKey}. `.repeat(12).trim();
}

export function quranPassageFixture(reference: string): string {
  const [chapter, range] = reference.split(':');
  const [start, end = start] = range!.split('-').map(Number);
  return Array.from({ length: end! - start! + 1 }, (_, index) => (
    quranVerseFixture(`${chapter}:${start! + index}`)
  )).join('\n');
}

export async function installQuranRoute(page: Page): Promise<void> {
  await page.route(/^https:\/\/api\.quran\.com\/api\/v4\/quran\/translations\/20\?/u, route => {
    const verseKey = new URL(route.request().url()).searchParams.get('verse_key')!;
    return route.fulfill({ json: {
      translations: [{ resource_id: 20, verse_key: verseKey, text: quranVerseFixture(verseKey) }],
      meta: { translation_name: 'Saheeh International', author_name: 'Saheeh International' },
    } });
  });
}
