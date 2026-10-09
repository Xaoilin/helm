import { z } from 'zod';
import { API_TIMEOUT, QURAN_TRANSLATION } from '../config/constants';
import type { QuranMotivationReference } from '../types/domain';

const translationResponseSchema = z.object({
  translations: z.array(z.object({
    resource_id: z.literal(QURAN_TRANSLATION.RESOURCE_ID),
    verse_key: z.string(),
    text: z.string().min(1),
  })).length(1),
});

function translationText(html: string): string {
  // The API supplies HTML footnote markers. Render only inert text; the source
  // link provides the notes, which are not part of the verse translation.
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('sup, script, style').forEach(element => element.remove());
  const text = document.body.textContent?.trim();
  if (!text) throw new Error('Quran.com returned an empty English verse.');
  return text;
}

async function fetchVerseTranslation(verseKey: string, signal: AbortSignal): Promise<string> {
  const url = new URL(`${QURAN_TRANSLATION.API_URL}/${QURAN_TRANSLATION.RESOURCE_ID}`);
  url.searchParams.set('verse_key', verseKey);
  url.searchParams.set('fields', 'verse_key');
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`Quran.com translation request failed: HTTP ${response.status}.`);
  const { translations } = translationResponseSchema.parse(await response.json());
  const translation = translations[0]!;
  if (translation.verse_key !== verseKey) {
    throw new Error(`Quran.com returned a different verse for ${verseKey}.`);
  }
  return translationText(translation.text);
}

/** Read every complete ayah directly from Quran.com, without storing provider content. */
export async function getQuranTranslation(
  reference: QuranMotivationReference,
  signal: AbortSignal,
): Promise<string> {
  const match = /^(\d+):(\d+)(?:-(\d+))?$/u.exec(reference);
  if (!match) throw new RangeError(`Invalid Quran passage: ${reference}`);
  const chapter = match[1]!;
  const start = Number(match[2]);
  const end = Number(match[3] ?? match[2]);
  if (start < 1 || end < start) throw new RangeError(`Invalid Quran passage: ${reference}`);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT.QURAN_TRANSLATION)]);
  const verses = Array.from({ length: end - start + 1 }, (_, index) => `${chapter}:${start + index}`);
  const translations = await Promise.all(verses.map(verse => fetchVerseTranslation(verse, deadline)));
  return translations.join('\n');
}
