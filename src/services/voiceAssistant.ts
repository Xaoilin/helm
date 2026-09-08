import { SUPABASE_URL } from '../config';
import { API_TIMEOUT, TIMING, VOICE_SESSION } from '../config/constants';
import type { AssistantLang } from '../assistant/shared';
import { getHostedAssistantAuthHeaders } from './hostedAssistantAccess';
import { getClient } from '../store/supabase';

interface SpeechServiceErrorPayload {
  code?: unknown;
  error?: unknown;
  deploymentSha?: unknown;
}

export class SpeechServiceError extends Error {
  readonly code?: string;
  readonly deploymentSha?: string;

  constructor(message: string, payload: SpeechServiceErrorPayload = {}) {
    super(message);
    this.name = 'SpeechServiceError';
    this.code = typeof payload.code === 'string' ? payload.code : undefined;
    this.deploymentSha = typeof payload.deploymentSha === 'string' ? payload.deploymentSha : undefined;
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Voice playback cancelled.', 'AbortError');
  }

  const error = new Error('Voice playback cancelled.');
  error.name = 'AbortError';
  return error;
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

function getSpeechEndpoint(): string {
  const baseUrl = SUPABASE_URL.trim().replace(/\/+$/u, '');
  if (!baseUrl) {
    throw new Error('Speech playback is unavailable because Supabase is not configured.');
  }
  return `${baseUrl}/functions/v1/assistant-speech`;
}

async function getSpeechServiceError(response: Response): Promise<SpeechServiceError> {
  let payload: SpeechServiceErrorPayload = {};
  try {
    const value = await response.json() as unknown;
    if (value && typeof value === 'object') {
      payload = value as SpeechServiceErrorPayload;
    }
  } catch {
    // Keep a safe status-only message when an upstream response is malformed.
  }

  const message = typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.trim()
    : `Speech service error: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  return new SpeechServiceError(message, payload);
}

export async function speakWithElevenLabs(
  text: string,
  secretId: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<HTMLAudioElement> {
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  const timeout = globalThis.setTimeout(abortRequest, API_TIMEOUT.ELEVENLABS_TTS);
  signal?.addEventListener('abort', abortRequest, { once: true });

  try {
    if (signal?.aborted) throw createAbortError();
    const client = getClient();
    if (!client) {
      throw new Error('Speech playback is unavailable because Supabase is not configured.');
    }

    const headers = await abortable(getHostedAssistantAuthHeaders(client), controller.signal);
    if (controller.signal.aborted) throw createAbortError();

    const response = await abortable(fetch(getSpeechEndpoint(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, secretId, voiceId }),
    }), controller.signal);

    if (!response.ok) throw await getSpeechServiceError(response);

    const blob = await abortable(response.blob(), controller.signal);
    if (controller.signal.aborted) throw createAbortError();

    const url = URL.createObjectURL(blob);
    try {
      return new Audio(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }
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
