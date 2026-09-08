import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import WakeWordEngine from 'openwakeword-wasm-browser';
import { InferenceSession } from 'onnxruntime-web';

describe('supported browser wake-word model contract', () => {
  it('loads only Lina and the three shared models with the explicit app mapping', async () => {
    const createSession = vi.spyOn(InferenceSession, 'create').mockResolvedValue({} as InferenceSession);
    const root = resolve(__dirname, '../..');
    for (const path of ['src/hooks/useWakeWord.ts', 'src/components/debug/WakeWordDebug.tsx']) {
      const source = readFileSync(resolve(root, path), 'utf8');
      expect(source).toMatch(/keywords:\s*\['hey_lina'\]/u);
      expect(source).toMatch(/modelFiles:\s*\{\s*hey_lina:\s*'hey_lina.onnx',?\s*\}/u);
    }
    const names = ['melspectrogram.onnx', 'embedding_model.onnx', 'silero_vad.onnx', 'hey_lina.onnx'];
    const baseAssetUrl = '/helm/openwakeword/models';
    const engine = new WakeWordEngine({
      keywords: ['hey_lina'],
      modelFiles: { hey_lina: 'hey_lina.onnx' },
      baseAssetUrl,
    });
    try {
      await engine.load();
      expect(createSession.mock.calls.map(([url]) => url)).toEqual(names.map(name => `${baseAssetUrl}/${name}`));
    } finally {
      createSession.mockRestore();
    }
    for (const name of names) {
      expect(readFileSync(resolve(root, 'public/openwakeword/models', name)).byteLength).toBeGreaterThan(0);
    }
    expect(existsSync(resolve(root, 'public/openwakeword/models/hey_jarvis_v0.1.onnx'))).toBe(false);
  });
});
