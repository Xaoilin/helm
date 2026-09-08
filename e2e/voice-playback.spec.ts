import { expect, openApp, test } from './support/helm-fixture';

const reference = 'a0000000-0000-4000-8000-000000000001';

for (const surface of ['Life Hero', 'Lina'] as const) {
  for (const outcome of ['audio', 'paused'] as const) {
    test(`${surface} uses authenticated speech and handles ${outcome} playback`, async ({ page, scenario }) => {
      await scenario({ settings: { assistantEnabled: true, lifeHeroEnabled: true, elevenLabsVoiceId: 'publicVoice123' } });
      await page.addInitScript(secretId => {
        localStorage.setItem('helm:device:deviceSettings:v2', JSON.stringify({ elevenLabsSecretId: secretId }));
        const state = { audioPlays: 0, pauses: 0, revoked: 0, browserPlays: 0 };
        Object.assign(window, { __voiceProof: state });
        class AudioFixture {
          src: string;
          onended = null;
          onerror = null;
          constructor(src: string) { this.src = src; }
          play() { state.audioPlays += 1; return Promise.resolve(); }
          pause() { state.pauses += 1; }
        }
        class UtteranceFixture {
          onstart?: () => void;
          onend?: () => void;
        }
        Object.defineProperty(window, 'Audio', { value: AudioFixture, configurable: true });
        Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: UtteranceFixture, configurable: true });
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
          cancel() {}, getVoices: () => [],
          speak(utterance: UtteranceFixture) {
            state.browserPlays += 1;
            utterance.onstart?.();
            setTimeout(() => utterance.onend?.(), 50);
          },
        } });
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = url => { state.revoked += 1; revoke(url); };
      }, reference);
      // Planner health is paused; every provider response below is synthetic.
      await page.route('**/functions/v1/assistant-openai*', route => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'paused', message: 'Hosted AI is paused. Use the app controls directly.' }),
      }));
      const calls: Array<{ body: Record<string, unknown>; authorization: string }> = [];
      await page.route('**/functions/v1/assistant-speech', async route => {
        calls.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization });
        await route.fulfill(outcome === 'audio'
          ? { contentType: 'audio/mpeg', body: Buffer.from('ID3synthetic audio fixture') }
          : { status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'hosted_ai_paused', error: 'Hosted AI is paused.' }) });
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openApp(page);
      const heroVoice = page.getByRole('region', { name: 'Hero voice' });
      if (surface === 'Life Hero') await heroVoice.getByRole('button', { name: 'Hear encouragement' }).click();
      else {
        await page.getByRole('button', { name: 'Talk to Lina', exact: true }).click();
        await page.locator('.va-bubble input').fill('Help me plan my week');
        await page.getByRole('button', { name: 'Send command', exact: true }).click();
      }
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({ authorization: 'Bearer e2e-access-token', body: {
        text: expect.any(String), secretId: reference, voiceId: 'publicVoice123',
      } });
      if (outcome === 'audio') {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __voiceProof: { audioPlays: number } }).__voiceProof.audioPlays)).toBe(1);
        if (surface === 'Life Hero') await heroVoice.getByRole('button', { name: 'Stop', exact: true }).click();
        else await page.getByRole('button', { name: 'Close Lina', exact: true }).click();
        const proof = await page.evaluate(() => (window as unknown as { __voiceProof: { pauses: number; revoked: number; browserPlays: number } }).__voiceProof);
        expect(proof.pauses).toBe(1);
        expect(proof.revoked).toBe(1);
        expect(proof.browserPlays).toBe(0);
      } else {
        await expect(page.getByText(/browser voice played instead\./u)).toBeVisible();
        expect(await page.evaluate(() => (window as unknown as { __voiceProof: { browserPlays: number } }).__voiceProof.browserPlays)).toBe(1);
      }
    });
  }
}
