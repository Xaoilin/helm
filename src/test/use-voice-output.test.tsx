import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import { speakWithBrowserTTS, speakWithElevenLabs } from '../services/voiceAssistant';

vi.mock('../services/voiceAssistant', () => ({
  speakWithBrowserTTS: vi.fn(),
  speakWithElevenLabs: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logError: vi.fn(),
}));

const browserSpeak = vi.mocked(speakWithBrowserTTS);
const elevenLabsSpeak = vi.mocked(speakWithElevenLabs);

describe('useVoiceOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserSpeak.mockResolvedValue();
  });

  it('does not start ElevenLabs audio when stopped during the provider request', async () => {
    let resolveAudio!: (audio: HTMLAudioElement) => void;
    const providerResponse = new Promise<HTMLAudioElement>(resolve => {
      resolveAudio = resolve;
    });
    const audio = {
      onended: null,
      onerror: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLAudioElement;
    elevenLabsSpeak.mockReturnValue(providerResponse);

    const { result } = renderHook(() => useVoiceOutput({
      hasElevenLabs: true,
      lang: 'en',
      elevenLabsApiKey: 'test-key',
      elevenLabsVoiceId: 'test-voice',
      strict: true,
    }));

    let request!: Promise<void>;
    act(() => {
      request = result.current.speak('Keep moving.');
    });
    act(() => result.current.stopSpeaking());

    await act(async () => {
      resolveAudio(audio);
      await request;
    });

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
    expect(browserSpeak).not.toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });
});
