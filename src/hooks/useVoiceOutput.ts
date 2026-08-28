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
}: UseVoiceOutputOptions): UseVoiceOutputReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string): Promise<void> => {
    setIsSpeaking(true);
    try {
      if (hasElevenLabs && elevenLabsApiKey && elevenLabsVoiceId) {
        try {
          const audio = await speakWithElevenLabs(text, elevenLabsApiKey, elevenLabsVoiceId);
          audioRef.current = audio;
          await new Promise<void>((resolve, reject) => {
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
          return;
        } catch (error) {
          audioRef.current = null;
          logError('useVoiceOutput', error);
        }
      }

      await speakWithBrowserTTS(text, lang);
    } finally {
      setIsSpeaking(false);
    }
  }, [hasElevenLabs, elevenLabsApiKey, elevenLabsVoiceId, lang]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  return { speak, stopSpeaking, isSpeaking, audioRef };
}
