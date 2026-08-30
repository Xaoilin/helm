/**
 * useVoiceOutput — ElevenLabs TTS with browser TTS fallback.
 *
 * Manages audio playback lifecycle and exposes speak/stop controls.
 */

import { useState, useRef, useCallback } from 'react';
import { speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import { logError } from '../services/logger';
import type { AssistantLang } from '../assistant/shared';

interface UseVoiceOutputOptions {
  hasElevenLabs: boolean;
  lang: AssistantLang;
  elevenLabsApiKey: string | undefined;
  elevenLabsVoiceId: string | undefined;
  strict?: boolean;
}

interface UseVoiceOutputReturn {
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useVoiceOutput({
  hasElevenLabs,
  lang,
  elevenLabsApiKey,
  elevenLabsVoiceId,
  strict = false,
}: UseVoiceOutputOptions): UseVoiceOutputReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const speak = useCallback(async (text: string): Promise<void> => {
    setIsSpeaking(true);
    let cancelPlayback: (() => void) | null = null;
    let wasCancelled = false;
    const cancelled = new Promise<void>(resolve => {
      cancelPlayback = () => {
        wasCancelled = true;
        resolve();
      };
      cancelRef.current = cancelPlayback;
    });
    try {
      if (hasElevenLabs && elevenLabsApiKey && elevenLabsVoiceId) {
        try {
          const audio = await speakWithElevenLabs(text, elevenLabsApiKey, elevenLabsVoiceId);
          if (wasCancelled) {
            audio.pause();
            return;
          }
          audioRef.current = audio;
          const playback = new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              audioRef.current = null;
              resolve();
            };
            audio.onerror = () => {
              audioRef.current = null;
              reject(new Error('ElevenLabs audio playback failed.'));
            };
            audio.play().catch(reject);
          });
          await Promise.race([playback, cancelled]);
          return;
        } catch (error) {
          audioRef.current = null;
          if (wasCancelled) return;
          logError('useVoiceOutput', error);
        }
      }

      if (wasCancelled) return;
      await Promise.race([
        speakWithBrowserTTS(text, lang, { rejectOnError: strict }),
        cancelled,
      ]);
    } finally {
      if (cancelRef.current === cancelPlayback) cancelRef.current = null;
      setIsSpeaking(false);
    }
  }, [hasElevenLabs, elevenLabsApiKey, elevenLabsVoiceId, lang, strict]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    cancelRef.current?.();
    cancelRef.current = null;
    setIsSpeaking(false);
  }, []);

  return { speak, stopSpeaking, isSpeaking, audioRef };
}
