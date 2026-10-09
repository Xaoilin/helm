import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getQuranTranslation } from '../services/quranTranslation';

const fetchMock = vi.fn();
const signal = () => new AbortController().signal;

function response(verseKey: string, text: string) {
  return { ok: true, json: async () => ({
    translations: [{ resource_id: 20, verse_key: verseKey, text }],
  }) };
}

describe('Quran.com English translation', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses the published Saheeh International response rather than bundled or generated wording', async () => {
    // Verified against the public Quran.com resource 20 response on 2026-10-09.
    const text = 'For indeed, with hardship [will be] ease [i.e., relief].';
    fetchMock.mockResolvedValue(response('94:5', text));
    expect(await getQuranTranslation('94:5', signal())).toBe(text);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe('https://api.quran.com/api/v4/quran/translations/20?verse_key=94%3A5&fields=verse_key');
    expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('keeps every ayah in passage order and decodes formatting without footnote numbers', async () => {
    fetchMock.mockImplementation(async (url: URL) => (
      response(url.searchParams.get('verse_key')!, url.searchParams.get('verse_key') === '94:5'
        ? 'Full &amp; complete <i>verse</i> fixture.<sup foot_note="123">1</sup>'
        : 'Next complete verse fixture.<script>untrusted()</script>')
    ));
    expect(await getQuranTranslation('94:5-6', signal()))
      .toBe('Full & complete verse fixture.\nNext complete verse fixture.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { translations: [] },
    { translations: [{ resource_id: 131, verse_key: '94:5', text: 'Wrong edition fixture.' }] },
    { translations: [{ resource_id: 20, verse_key: '94:6', text: 'Wrong verse fixture.' }] },
    { translations: [{ resource_id: 20, verse_key: '94:5', text: '<sup>1</sup>' }] },
  ])('rejects a missing, mismatched or empty source response', async payload => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    await expect(getQuranTranslation('94:5', signal())).rejects.toThrow();
  });

  it('surfaces provider failures without substituting another translation', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(getQuranTranslation('94:5', signal())).rejects.toThrow('HTTP 503');
  });

  it('propagates cancellation to the provider request', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response('94:5', 'Complete translation fixture.'));
    await getQuranTranslation('94:5', controller.signal);
    const requestSignal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    controller.abort();
    expect(requestSignal.aborted).toBe(true);
  });
});
