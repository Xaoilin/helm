import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceOutput } from '../hooks/useVoiceOutput';

const mocks = vi.hoisted(() => ({
  speakWithElevenLabs: vi.fn(),
  speakWithBrowserTTS: vi.fn(),
  logError: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock('../services/voiceAssistant', () => ({
  speakWithElevenLabs: mocks.speakWithElevenLabs,
  speakWithBrowserTTS: mocks.speakWithBrowserTTS,
}));

vi.mock('../services/logger', () => ({
  logError: mocks.logError,
}));

function makeAudio() {
  return {
    src: 'blob:speech',
    onended: null,
    onerror: null,
    pause: vi.fn(),
    play: vi.fn().mockReturnValue(new Promise<void>(() => {})),
  } as unknown as HTMLAudioElement;
}

beforeEach(() => {
  mocks.speakWithElevenLabs.mockReset();
  mocks.speakWithBrowserTTS.mockReset().mockResolvedValue('played');
  mocks.logError.mockReset();
  mocks.revokeObjectUrl.mockReset();
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: mocks.revokeObjectUrl,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { cancel: vi.fn() },
  });
});

describe('useVoiceOutput', () => {
  it.each([
    new Error('speech service unavailable'),
    new DOMException('request deadline exceeded', 'AbortError'),
  ])('falls back after provider failure or timeout in Strict Mode: %s', async error => {
    mocks.speakWithElevenLabs.mockRejectedValue(error);
    const { result } = renderHook(() => useVoiceOutput({
      hasElevenLabs: true,
      lang: 'en',
      elevenLabsSecretId: 'secret-uuid',
      elevenLabsVoiceId: 'voice123',
    }), { wrapper: StrictMode });

    await act(async () => { await result.current.speak('Hello'); });

    expect(mocks.speakWithElevenLabs).toHaveBeenCalledWith(
      'Hello',
      'secret-uuid',
      'voice123',
      expect.any(AbortSignal),
    );
    expect(mocks.speakWithBrowserTTS).toHaveBeenCalledWith(
      'Hello',
      'en',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.notice).toContain('browser voice played instead');
    expect(result.current.isSpeaking).toBe(false);
  });

  it('cancels provider playback, revokes its blob URL, and never starts browser fallback', async () => {
    const audio = makeAudio();
    mocks.speakWithElevenLabs.mockResolvedValue(audio);
    const { result } = renderHook(() => useVoiceOutput({
      hasElevenLabs: true,
      lang: 'en',
      elevenLabsSecretId: 'secret-uuid',
      elevenLabsVoiceId: 'voice123',
    }));

    let playback!: Promise<void>;
    act(() => { playback = result.current.speak('Hello'); });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));

    act(() => { result.current.stopSpeaking(); });
    await expect(playback).resolves.toBeUndefined();

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith('blob:speech');
    expect(mocks.speakWithBrowserTTS).not.toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });

  it('settles a pending browser fallback on stop without stale completion', async () => {
    let resolveBrowser!: (result: 'played') => void;
    mocks.speakWithElevenLabs.mockRejectedValue(new Error('speech service unavailable'));
    mocks.speakWithBrowserTTS.mockImplementation(() => new Promise(resolve => {
      resolveBrowser = resolve as (result: 'played') => void;
    }));
    const { result } = renderHook(() => useVoiceOutput({
      hasElevenLabs: true,
      lang: 'en',
      elevenLabsSecretId: 'secret-uuid',
      elevenLabsVoiceId: 'voice123',
    }));

    let playback!: Promise<void>;
    await act(async () => {
      playback = result.current.speak('Hello');
      await waitFor(() => expect(mocks.speakWithBrowserTTS).toHaveBeenCalledTimes(1));
    });
    act(() => { result.current.stopSpeaking(); });
    await expect(playback).resolves.toBeUndefined();
    resolveBrowser('played');

    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.notice).toBeNull();
  });
});
