/**
 * useVoiceOutput — ElevenLabs TTS with browser TTS fallback.
 *
 * Manages audio playback lifecycle and exposes speak/stop controls.
 */

import { useState, useRef, useCallback } from 'react';
import { speakWithElevenLabs, speakWithBrowserTTS, type AssistantLang } from '../services/voiceAssistant';
import { TIMING } from '../config/constants';
import { logError } from '../services/logger';

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

    const done = () => {
      setIsSpeaking(false);
    };

    if (hasElevenLabs && elevenLabsApiKey && elevenLabsVoiceId) {
      try {
        const audio = await speakWithElevenLabs(text, elevenLabsApiKey, elevenLabsVoiceId);
        audioRef.current = audio;
        audio.onended = done;
        audio.onerror = () => {
          logError('useVoiceOutput', 'ElevenLabs audio playback error, falling back to browser TTS');
          speakWithBrowserTTS(text, lang);
          done();
        };
        await audio.play();
      } catch (e) {
        logError('useVoiceOutput', e);
        speakWithBrowserTTS(text, lang);
        done();
      }
    } else {
      speakWithBrowserTTS(text, lang);
      setTimeout(done, TIMING.TTS_FALLBACK_TIMEOUT);
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
