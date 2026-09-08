/**
 * useVoiceOutput — authenticated speech transport with browser TTS fallback.
 *
 * The provider secret remains in Supabase Vault. This hook only receives its
 * account-owned secret reference and public voice ID, and owns cancellation of
 * requests, blob loading, and playback.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import { logError } from '../services/logger';
import type { AssistantLang } from '../assistant/shared';

interface UseVoiceOutputOptions {
  hasElevenLabs: boolean;
  lang: AssistantLang;
  elevenLabsSecretId: string | undefined;
  elevenLabsVoiceId: string | undefined;
}

interface UseVoiceOutputReturn {
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  notice: string | null;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

function releaseAudio(audio: HTMLAudioElement): void {
  audio.pause();
  audio.onended = null;
  audio.onerror = null;
  if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Voice playback cancelled.', 'AbortError');
  }

  const error = new Error('Voice playback cancelled.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function playAudio(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      audio.onended = null;
      audio.onerror = null;
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      settle(() => reject(createAbortError()));
    };

    audio.onended = () => settle(resolve);
    audio.onerror = () => settle(() => reject(new Error('Speech audio playback failed.')));
    signal.addEventListener('abort', onAbort, { once: true });

    if (signal.aborted) {
      onAbort();
      return;
    }

    try {
      void Promise.resolve(audio.play()).catch(error => {
        settle(() => reject(error));
      });
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

export function useVoiceOutput({
  hasElevenLabs,
  lang,
  elevenLabsSecretId,
  elevenLabsVoiceId,
}: UseVoiceOutputOptions): UseVoiceOutputReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const clearAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    releaseAudio(audio);
    audioRef.current = null;
  }, []);

  const stopSpeaking = useCallback(() => {
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearAudio();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    if (mountedRef.current) {
      setIsSpeaking(false);
      setNotice(null);
    }
  }, [clearAudio]);

  const speak = useCallback(async (text: string): Promise<void> => {
    stopSpeaking();
    const attempt = attemptRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) {
      setIsSpeaking(true);
      setNotice(null);
    }

    let providerFailed = false;
    try {
      if (hasElevenLabs && elevenLabsSecretId && elevenLabsVoiceId) {
        try {
          const audio = await abortable(speakWithElevenLabs(
            text,
            elevenLabsSecretId,
            elevenLabsVoiceId,
            controller.signal,
          ), controller.signal);

          if (controller.signal.aborted || attemptRef.current !== attempt) {
            releaseAudio(audio);
            return;
          }

          audioRef.current = audio;
          await playAudio(audio, controller.signal);
          if (audioRef.current === audio) {
            releaseAudio(audio);
            audioRef.current = null;
          }
          if (controller.signal.aborted || attemptRef.current !== attempt) return;
          return;
        } catch (error) {
          if (controller.signal.aborted || attemptRef.current !== attempt || isAbortError(error)) return;
          providerFailed = true;
          clearAudio();
          logError('useVoiceOutput', error);
        }
      }

      if (controller.signal.aborted || attemptRef.current !== attempt) return;

      let result: Awaited<ReturnType<typeof speakWithBrowserTTS>>;
      try {
        result = await abortable(
          speakWithBrowserTTS(text, lang, { signal: controller.signal }),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted || attemptRef.current !== attempt || isAbortError(error)) return;
        throw error;
      }
      if (controller.signal.aborted || attemptRef.current !== attempt || result === 'cancelled') return;

      if (result === 'played') {
        if (providerFailed && mountedRef.current) {
          setNotice('ElevenLabs was unavailable, so the browser voice played instead.');
        }
        return;
      }

      throw new Error(result === 'unavailable'
        ? 'Voice playback is unavailable in this browser. Use the response above as text.'
        : 'Voice playback failed. Use the response above as text.');
    } finally {
      if (attemptRef.current === attempt) {
        abortRef.current = null;
        if (mountedRef.current) setIsSpeaking(false);
      }
    }
  }, [clearAudio, elevenLabsSecretId, elevenLabsVoiceId, hasElevenLabs, lang, stopSpeaking]);

  useEffect(() => () => {
    mountedRef.current = false;
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearAudio();
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, [clearAudio]);

  return { speak, stopSpeaking, isSpeaking, notice, audioRef };
}
