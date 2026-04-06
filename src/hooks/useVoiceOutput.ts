/**
 * useVoiceOutput — ElevenLabs TTS with browser TTS fallback.
 *
 * Manages audio playback lifecycle and exposes speak/stop controls.
 */

import { useState, useRef, useCallback } from 'react';
import { speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import { TIMING } from '../config/constants';
import { logError } from '../services/logger';
import type { AssistantLang } from '../services/assistantTypes';

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
    await new Promise<void>((resolve) => {
      const done = () => {
        setIsSpeaking(false);
        resolve();
      };

      if (hasElevenLabs && elevenLabsApiKey && elevenLabsVoiceId) {
        speakWithElevenLabs(text, elevenLabsApiKey, elevenLabsVoiceId)
          .then(async (audio) => {
            audioRef.current = audio;
            audio.onended = done;
            audio.onerror = () => {
              logError('useVoiceOutput', 'ElevenLabs audio playback error, falling back to browser TTS');
              speakWithBrowserTTS(text, lang);
              setTimeout(done, TIMING.TTS_FALLBACK_TIMEOUT);
            };
            await audio.play();
          })
          .catch((error) => {
            logError('useVoiceOutput', error);
            speakWithBrowserTTS(text, lang);
            setTimeout(done, TIMING.TTS_FALLBACK_TIMEOUT);
          });
        return;
      }

      speakWithBrowserTTS(text, lang);
      setTimeout(done, TIMING.TTS_FALLBACK_TIMEOUT);
    });
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
