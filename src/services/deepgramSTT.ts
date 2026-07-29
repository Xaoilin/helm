/**
 * Deepgram Speech-to-Text Service
 *
 * Uses MediaRecorder for audio capture and Deepgram for both
 * live preview transcripts and final post-stop transcription.
 *
 * Get a free API key at https://console.deepgram.com (comes with $200 credit).
 */

import { logError, logWarn } from './logger';
import { API_TIMEOUT, TIMING } from '../config/constants';
import { deepgramBreaker } from './serviceBreakers';

export interface DeepgramResult {
  transcript: string;
  confidence: number;
}

export interface DeepgramLiveTranscriptUpdate {
  type: 'transcript';
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
}

export interface DeepgramLiveUtteranceEndEvent {
  type: 'utterance-end';
  lastWordEnd: number | null;
}

export type DeepgramLiveEvent = DeepgramLiveTranscriptUpdate | DeepgramLiveUtteranceEndEvent;

interface RecorderOptions {
  deviceId?: string;
  onChunk?: (chunk: Blob) => void;
}

interface DeepgramLiveSessionOptions {
  apiKey: string;
  language?: string;
  onEvent: (event: DeepgramLiveEvent) => void;
  onError?: (error: Error) => void;
}

export interface DeepgramLiveSession {
  sendChunk: (chunk: Blob) => void;
  close: () => void;
}

function getDeepgramModel(language: string): string {
  void language;
  return 'nova-3';
}

function joinTranscriptParts(parts: string[]): string {
  return parts
    .flatMap(part => part.split(/\s+/))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Record audio from the microphone and optionally mirror chunks to a live STT stream.
 * Returns a Blob of audio data (webm/opus or ogg depending on browser).
 */
export function createRecorder(options: RecorderOptions | string = {}): {
  start: () => Promise<void>;
  stop: () => void;
  getBlob: () => Promise<Blob>;
  isRecording: () => boolean;
} {
  const { deviceId, onChunk } = typeof options === 'string' ? { deviceId: options } : options;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let resolveBlob: ((blob: Blob) => void) | null = null;
  let stream: MediaStream | null = null;

  return {
    async start() {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        chunks.push(event.data);
        onChunk?.(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        if (resolveBlob) resolveBlob(blob);
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
      };

      mediaRecorder.start(TIMING.CHUNK_INTERVAL);
    },

    stop() {
      if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
      }
    },

    getBlob(): Promise<Blob> {
      return new Promise((resolve) => {
        if (mediaRecorder?.state === 'inactive' && chunks.length > 0) {
          resolve(new Blob(chunks, { type: mediaRecorder.mimeType }));
          return;
        }
        resolveBlob = resolve;
      });
    },

    isRecording() {
      return mediaRecorder?.state === 'recording';
    },
  };
}

/**
 * Stream microphone chunks to Deepgram so the UI can show a live preview transcript.
 * Final transcript accuracy still comes from the post-stop file transcription path.
 */
export function createDeepgramLiveSession({
  apiKey,
  language = 'en-GB',
  onEvent,
  onError,
}: DeepgramLiveSessionOptions): DeepgramLiveSession {
  const params = new URLSearchParams({
    model: getDeepgramModel(language),
    language,
    smart_format: 'true',
    interim_results: 'true',
    vad_events: 'true',
    endpointing: String(TIMING.DEEPGRAM_ENDPOINTING),
    utterance_end_ms: String(TIMING.DEEPGRAM_UTTERANCE_END_MS),
  });
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['token', apiKey]);
  const pendingBuffers: ArrayBuffer[] = [];
  const finalTranscriptParts: string[] = [];
  let interimTranscript = '';
  let isClosed = false;
  let hasOpened = false;
  let sendQueue = Promise.resolve();
  const connectTimer = globalThis.setTimeout(() => {
    if (hasOpened || isClosed) return;
    onError?.(new Error('Live transcript preview timed out.'));
    try {
      socket.close();
    } catch (error) {
      logWarn('Deepgram', `Live preview close failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }, API_TIMEOUT.DEEPGRAM_LIVE_CONNECT);

  const emitTranscript = (isFinal: boolean, speechFinal: boolean) => {
    const transcript = joinTranscriptParts([...finalTranscriptParts, interimTranscript]);
    if (!transcript) return;
    onEvent({ type: 'transcript', transcript, isFinal, speechFinal });
  };

  const enqueueSend = (buffer: ArrayBuffer) => {
    sendQueue = sendQueue
      .then(() => {
        if (isClosed) return;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(buffer);
          return;
        }
        if (socket.readyState === WebSocket.CONNECTING) {
          pendingBuffers.push(buffer);
        }
      })
      .catch(error => {
        logWarn('Deepgram', `Live preview send failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
  };

  socket.onopen = () => {
    hasOpened = true;
    clearTimeout(connectTimer);
    for (const buffer of pendingBuffers.splice(0)) {
      enqueueSend(buffer);
    }
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type === 'UtteranceEnd') {
        onEvent({
          type: 'utterance-end',
          lastWordEnd: typeof payload.last_word_end === 'number' ? payload.last_word_end : null,
        });
        return;
      }

      if (payload?.type !== 'Results') return;

      const transcript = payload?.channel?.alternatives?.[0]?.transcript?.trim() || '';
      if (payload.is_final) {
        if (transcript) finalTranscriptParts.push(transcript);
        interimTranscript = '';
      } else {
        interimTranscript = transcript;
      }

      emitTranscript(Boolean(payload.is_final), Boolean(payload.speech_final));
    } catch (error) {
      logWarn('Deepgram', `Live preview message parse failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  socket.onerror = () => {
    onError?.(new Error('Live transcript preview is unavailable.'));
  };

  socket.onclose = () => {
    clearTimeout(connectTimer);
  };

  return {
    sendChunk(chunk: Blob) {
      if (isClosed || chunk.size <= 0) return;
      void chunk.arrayBuffer()
        .then(buffer => enqueueSend(buffer))
        .catch(error => {
          logWarn('Deepgram', `Live preview chunk conversion failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        });
    },

    close() {
      if (isClosed) return;
      isClosed = true;
      clearTimeout(connectTimer);
      sendQueue = sendQueue.finally(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: 'CloseStream' }));
          } catch (error) {
            logWarn('Deepgram', `Live preview close signal failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }

        globalThis.setTimeout(() => {
          if (socket.readyState === WebSocket.CLOSED) return;
          try {
            socket.close();
          } catch (error) {
            logWarn('Deepgram', `Live preview socket close failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }, TIMING.DEEPGRAM_LIVE_CLOSE_GRACE);
      });
    },
  };
}

/**
 * Transcribe an audio blob using Deepgram's REST API.
 * https://developers.deepgram.com/reference/listen-file
 */
export async function transcribeWithDeepgram(
  audioBlob: Blob,
  apiKey: string,
  language: string = 'en-GB',
): Promise<DeepgramResult> {
  const model = getDeepgramModel(language);
  const params = new URLSearchParams({
    model,
    language,
    smart_format: 'true',
  });
  return deepgramBreaker.call(async () => {
    const resp = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      signal: AbortSignal.timeout(API_TIMEOUT.DEEPGRAM_STT),
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': audioBlob.type || 'audio/webm',
      },
      body: audioBlob,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Invalid Deepgram API key. Check Settings → Voice Assistant.');
      }
      throw new Error(`Deepgram API error: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    const alt = data?.results?.channels?.[0]?.alternatives?.[0];

    return {
      transcript: alt?.transcript || '',
      confidence: alt?.confidence || 0,
    };
  });
}

/**
 * Test if the Deepgram API key is valid by making a minimal request.
 */
export async function testDeepgramKey(apiKey: string): Promise<boolean> {
  try {
    const silentBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-2', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: silentBlob,
    });
    return resp.status !== 401 && resp.status !== 403;
  } catch (error) {
    logError('Deepgram', error);
    logWarn('Deepgram', 'Key test failed');
    return false;
  }
}

/**
 * Check if Chrome's SpeechRecognition API actually works (not just exists).
 * Returns a promise that resolves to true if it works, false if network error.
 */
export function testChromeSpeechRecognition(): Promise<boolean> {
  return new Promise((resolve) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { resolve(false); return; }

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-GB';

    const timer = setTimeout(() => {
      try {
        rec.abort();
      } catch (error) {
        logWarn('Deepgram', `SpeechRecognition abort failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      resolve(false);
    }, TIMING.CHROME_STT_TIMEOUT);

    rec.onstart = () => {
      clearTimeout(timer);
      setTimeout(() => {
        try {
          rec.abort();
        } catch (error) {
          logWarn('Deepgram', `SpeechRecognition abort failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        resolve(true);
      }, TIMING.CHROME_STT_ABORT_DELAY);
    };

    rec.onerror = (e: any) => {
      clearTimeout(timer);
      resolve(e.error !== 'network' && e.error !== 'not-allowed');
    };

    try {
      rec.start();
    } catch {
      resolve(false);
    }
  });
}
