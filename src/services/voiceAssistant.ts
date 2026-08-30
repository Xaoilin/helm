import { API_TIMEOUT, TIMING, VOICE_SESSION } from '../config/constants';
import type { AssistantLang } from '../assistant/shared';

export async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<HTMLAudioElement> {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  const timeout = globalThis.setTimeout(abortRequest, API_TIMEOUT.ELEVENLABS_TTS);
  signal?.addEventListener('abort', abortRequest, { once: true });
  if (signal?.aborted) abortRequest();

  let resp: Response;
  try {
    resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
        },
      }),
    });
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }

  if (!resp.ok) {
    throw new Error(`ElevenLabs API error: ${resp.status} ${resp.statusText}`);
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  return new Audio(url);
}

export type BrowserSpeechResult = 'played' | 'unavailable' | 'cancelled' | 'failed';

export function speakWithBrowserTTS(
  text: string,
  lang: AssistantLang = 'en',
  options: { signal?: AbortSignal; onStart?: () => void } = {},
): Promise<BrowserSpeechResult> {
  return new Promise((resolve) => {
    if (
      typeof window.speechSynthesis === 'undefined'
      || typeof window.SpeechSynthesisUtterance === 'undefined'
    ) {
      resolve('unavailable');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const synth = window.speechSynthesis;
    let settled = false;
    let started = false;
    let startTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const settle = (result: BrowserSpeechResult) => {
      if (settled) return;
      settled = true;
      if (startTimeout !== null) globalThis.clearTimeout(startTimeout);
      options.signal?.removeEventListener('abort', cancel);
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      resolve(result);
    };
    const cancel = () => {
      synth.cancel();
      settle('cancelled');
    };
    startTimeout = globalThis.setTimeout(() => {
      synth.cancel();
      settle('failed');
    }, TIMING.TTS_FALLBACK_TIMEOUT);

    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-GB';
    utterance.onstart = () => {
      started = true;
      if (startTimeout !== null) globalThis.clearTimeout(startTimeout);
      options.onStart?.();
    };
    utterance.onend = () => settle('played');
    utterance.onerror = event => settle(
      options.signal?.aborted || event.error === 'canceled' || event.error === 'interrupted'
        ? 'cancelled'
        : 'failed',
    );

    const voices = synth.getVoices();
    if (lang === 'ar') {
      const arabicVoice = voices.find(voice => voice.lang.startsWith('ar'));
      if (arabicVoice) utterance.voice = arabicVoice;
    } else {
      const femaleVoice = voices.find(voice =>
        voice.name.includes('Female') || voice.name.includes('Zira') || voice.name.includes('Hazel')
      );
      if (femaleVoice) utterance.voice = femaleVoice;
    }

    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) {
      cancel();
      return;
    }

    try {
      synth.cancel();
      synth.speak(utterance);
      if (started && startTimeout !== null) globalThis.clearTimeout(startTimeout);
    } catch {
      settle('failed');
    }
  });
}

export async function playReadyTone(): Promise<void> {
  const AudioCtx = window.AudioContext || (window as Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;

  if (!AudioCtx) return;

  const audioContext = new AudioCtx();
  const durationSeconds = TIMING.VOICE_READY_TONE_DURATION / 1000;
  const fadeSeconds = Math.min(durationSeconds / 2, TIMING.VOICE_READY_TONE_FADE / 1000);

  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {});
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startAt = audioContext.currentTime;
    const endAt = startAt + durationSeconds;
    const peakGain = VOICE_SESSION.READY_TONE.GAIN;

    oscillator.type = VOICE_SESSION.READY_TONE.TYPE;
    oscillator.frequency.setValueAtTime(VOICE_SESSION.READY_TONE.FREQUENCY, startAt);

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.linearRampToValueAtTime(peakGain, startAt + fadeSeconds);
    gainNode.gain.linearRampToValueAtTime(0.0001, endAt);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    await new Promise<void>((resolve) => {
      oscillator.onended = () => resolve();
      oscillator.start(startAt);
      oscillator.stop(endAt);
    });
  } finally {
    await audioContext.close().catch(() => {});
  }
}
