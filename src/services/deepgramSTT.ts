/**
 * Deepgram Speech-to-Text Service
 *
 * Bypasses Chrome's broken SpeechRecognition API by using:
 * 1. MediaRecorder API to capture audio from the mic (browser-native, no network needed)
 * 2. Deepgram REST API to transcribe the audio (reliable HTTPS endpoint)
 *
 * Get a free API key at https://console.deepgram.com (comes with $200 credit).
 */

export interface DeepgramResult {
  transcript: string;
  confidence: number;
}

/**
 * Record audio from the microphone for up to `maxMs` milliseconds.
 * Stops early if silence is detected (via `onstop` or manual stop).
 * Returns a Blob of audio data (webm/opus or ogg depending on browser).
 */
export function createRecorder(deviceId?: string): {
  start: () => Promise<void>;
  stop: () => void;
  getBlob: () => Promise<Blob>;
  isRecording: () => boolean;
} {
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

      // Pick a supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      chunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        if (resolveBlob) resolveBlob(blob);
        // Release mic
        stream?.getTracks().forEach(t => t.stop());
        stream = null;
      };

      mediaRecorder.start(250); // collect chunks every 250ms
    },

    stop() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    },

    getBlob(): Promise<Blob> {
      return new Promise((resolve) => {
        if (mediaRecorder && mediaRecorder.state === 'inactive' && chunks.length > 0) {
          resolve(new Blob(chunks, { type: mediaRecorder.mimeType }));
        } else {
          resolveBlob = resolve;
        }
      });
    },

    isRecording() {
      return mediaRecorder?.state === 'recording';
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
): Promise<DeepgramResult> {
  const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en-GB&smart_format=true', {
    method: 'POST',
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
}

/**
 * Test if the Deepgram API key is valid by making a minimal request.
 */
export async function testDeepgramKey(apiKey: string): Promise<boolean> {
  try {
    // Send a tiny silent audio blob to test the key
    const silentBlob = new Blob([new Uint8Array(100)], { type: 'audio/webm' });
    const resp = await fetch('https://api.deepgram.com/v1/listen?model=nova-2', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/webm',
      },
      body: silentBlob,
    });
    // 200 or 400 (bad audio) both mean key works. 401/403 means bad key.
    return resp.status !== 401 && resp.status !== 403;
  } catch {
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
      try { rec.abort(); } catch {}
      resolve(false); // Timeout = probably broken
    }, 5000);

    rec.onstart = () => {
      clearTimeout(timer);
      // It started successfully — give it a moment to see if network error follows
      setTimeout(() => {
        try { rec.abort(); } catch {}
        resolve(true);
      }, 1500);
    };

    rec.onerror = (e: any) => {
      clearTimeout(timer);
      resolve(e.error !== 'network' && e.error !== 'not-allowed');
    };

    try { rec.start(); } catch { resolve(false); }
  });
}
