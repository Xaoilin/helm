import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantLang } from '../assistant/shared';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from '../config';
import { logError } from '../services/logger';
import {
  speakWithBrowserTTS,
  speakWithElevenLabs,
} from '../services/voiceAssistant';

export const LIFE_HERO_VOICE_COOLDOWN_MS = 4_000;

export type LifeHeroVoiceStatus = 'idle' | 'loading' | 'speaking' | 'error';

export interface LifeHeroVoiceControl {
  status: LifeHeroVoiceStatus;
  muted: boolean;
  coolingDown: boolean;
  error: string | null;
  notice: string | null;
  play: (text: string) => Promise<void>;
  stop: () => void;
  toggleMuted: () => void;
}

export function useLifeHeroVoice(lang: AssistantLang = 'en'): LifeHeroVoiceControl {
  const [status, setStatus] = useState<LifeHeroVoiceStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const attemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cooldownTimerRef = useRef<number | null>(null);

  const clearAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audioRef.current = null;
  }, []);

  const cancelActive = useCallback(() => {
    const hadActiveVoice = abortRef.current !== null || audioRef.current !== null;
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearAudio();
    if (hadActiveVoice) window.speechSynthesis?.cancel();
  }, [clearAudio]);

  const stop = useCallback(() => {
    cancelActive();
    setStatus('idle');
    setError(null);
    setNotice('Voice stopped. The encouragement remains available as text.');
  }, [cancelActive]);

  const beginCooldown = useCallback(() => {
    if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
    setCoolingDown(true);
    cooldownTimerRef.current = window.setTimeout(() => {
      cooldownTimerRef.current = null;
      setCoolingDown(false);
    }, LIFE_HERO_VOICE_COOLDOWN_MS);
  }, []);

  const play = useCallback(async (text: string) => {
    if (muted || coolingDown || status === 'loading' || status === 'speaking') return;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setError(null);
    setNotice(null);
    beginCooldown();

    let elevenLabsFailed = false;
    if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
      try {
        const audio = await speakWithElevenLabs(
          text,
          ELEVENLABS_API_KEY,
          ELEVENLABS_VOICE_ID,
          controller.signal,
        );
        if (attemptRef.current !== attempt || controller.signal.aborted) {
          if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
          return;
        }

        audioRef.current = audio;
        setStatus('speaking');
        await playAudio(audio, controller.signal);
        if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
        audioRef.current = null;
        if (attemptRef.current === attempt && !controller.signal.aborted) {
          abortRef.current = null;
          setStatus('idle');
        }
        return;
      } catch (providerError) {
        if (controller.signal.aborted || attemptRef.current !== attempt) return;
        elevenLabsFailed = true;
        clearAudio();
        logError('useLifeHeroVoice', providerError);
      }
    }

    try {
      const result = await speakWithBrowserTTS(text, lang, {
        signal: controller.signal,
        onStart: () => {
          if (attemptRef.current === attempt) setStatus('speaking');
        },
      });
      if (attemptRef.current !== attempt || controller.signal.aborted) return;

      if (result === 'played') {
        setStatus('idle');
        setNotice(elevenLabsFailed
          ? 'ElevenLabs was unavailable, so the generic browser voice played instead.'
          : null);
        return;
      }
      if (result === 'cancelled') {
        setStatus('idle');
        setNotice('Voice stopped. The encouragement remains available as text.');
        return;
      }

      setStatus('error');
      setError(elevenLabsFailed
        ? 'Voice playback failed. Check your ElevenLabs settings, or use the encouragement above as text.'
        : 'Voice playback is unavailable in this browser. Use the encouragement above as text.');
    } catch (browserError) {
      if (controller.signal.aborted || attemptRef.current !== attempt) return;
      logError('useLifeHeroVoice', browserError);
      setStatus('error');
      setError('Voice playback failed. Check your browser audio, or use the encouragement above as text.');
    } finally {
      if (attemptRef.current === attempt) abortRef.current = null;
    }
  }, [beginCooldown, clearAudio, coolingDown, lang, muted, status]);

  const toggleMuted = useCallback(() => {
    if (!muted) {
      cancelActive();
      setMuted(true);
      setStatus('idle');
      setError(null);
      setNotice('Muted. Encouragement remains available as text.');
      return;
    }
    setMuted(false);
    setNotice('Voice is on. Playback still starts only when you choose it.');
  }, [cancelActive, muted]);

  useEffect(() => () => {
    const hadActiveVoice = abortRef.current !== null || audioRef.current !== null;
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearAudio();
    if (hadActiveVoice) window.speechSynthesis?.cancel();
    if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
  }, [clearAudio]);

  return {
    status,
    muted,
    coolingDown,
    error,
    notice,
    play,
    stop,
    toggleMuted,
  };
}

function playAudio(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      audio.onended = null;
      audio.onerror = null;
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Voice playback cancelled.', 'AbortError'));
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('ElevenLabs audio playback failed.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void audio.play().catch(playError => {
      cleanup();
      reject(playError);
    });
  });
}
