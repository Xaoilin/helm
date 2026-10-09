import { getSpeechToken } from './jevVoiceApi';

const SPEECH_STREAM = {
  url: 'wss://api.deepgram.com/v1/listen?model=nova-3&language=en&interim_results=true&punctuate=false&endpointing=300',
  protocol: 'bearer', chunkMs: 250, connectionTimeoutMs: 10_000, keepAliveMs: 5_000,
  keepAlive: JSON.stringify({ type: 'KeepAlive' }),
  mimeTypes: ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'],
  results: 'Results',
} as const;

export interface SpeechCallbacks {
  transcript: (text: string, final: boolean) => void;
  status: (status: 'connecting' | 'listening' | 'stopped') => void;
  error: (message: string) => void;
}

/** One foreground mic session. No recording, transcript or token is persisted. */
export function createDeepgramSpeech(callbacks: SpeechCallbacks) {
  let generation = 0;
  let active = false;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let socket: WebSocket | null = null;
  let controller: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let lastFinalEnd = -1;

  function stop() {
    active = false;
    generation++;
    controller?.abort();
    controller = null;
    clearTimeout(timeout);
    clearInterval(keepAlive);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    socket?.close();
    socket = null;
    callbacks.status('stopped');
  }

  function fail(message: string) { stop(); callbacks.error(message); }

  async function start(secretId: string) {
    stop();
    active = true;
    lastFinalEnd = -1;
    const current = generation;
    callbacks.status('connecting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('This browser cannot stream microphone audio. Use the typed command box.');
      }
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!active || current !== generation) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      controller = new AbortController();
      const token = await getSpeechToken(secretId, controller.signal);
      if (!active || current !== generation) return;
      socket = new WebSocket(SPEECH_STREAM.url, [SPEECH_STREAM.protocol, token]);
      const connection = socket;
      timeout = setTimeout(() => { if (active && current === generation) fail('Deepgram did not connect. Check the key and try again.'); }, SPEECH_STREAM.connectionTimeoutMs);
      connection.onopen = () => {
        if (!active || current !== generation) return;
        clearTimeout(timeout);
        const mimeType = SPEECH_STREAM.mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
        if (!mimeType) { fail('This browser has no supported microphone audio format. Use typed commands.'); return; }
        try {
          recorder = new MediaRecorder(media, { mimeType });
          recorder.ondataavailable = event => {
            if (active && current === generation && event.data.size && connection.readyState === WebSocket.OPEN) connection.send(event.data);
          };
          recorder.onerror = () => fail('Microphone recording stopped. Enable the mic to retry.');
          recorder.start(SPEECH_STREAM.chunkMs);
          keepAlive = setInterval(() => {
            if (connection.readyState === WebSocket.OPEN) connection.send(SPEECH_STREAM.keepAlive);
          }, SPEECH_STREAM.keepAliveMs);
          callbacks.status('listening');
        } catch { fail('The browser could not start microphone streaming. Use typed commands.'); }
      };
      connection.onmessage = event => {
        if (!active || current !== generation) return;
        try {
          const result = JSON.parse(String(event.data));
          const text = result.channel?.alternatives?.[0]?.transcript;
          if (result.type !== SPEECH_STREAM.results || typeof text !== 'string' || !text.trim()) return;
          const final = result.is_final === true;
          if (final && Number.isFinite(result.start) && Number.isFinite(result.duration)) {
            const end = result.start + result.duration;
            if (end <= lastFinalEnd) return;
            lastFinalEnd = end;
          }
          callbacks.transcript(text.trim(), final);
        } catch { fail('Deepgram returned an invalid transcript. Enable the mic to retry.'); }
      };
      connection.onerror = () => { if (active && current === generation) fail('Deepgram could not stream speech. Check the key and credits.'); };
      connection.onclose = () => { if (active && current === generation) fail('Speech disconnected. Enable the microphone to reconnect.'); };
    } catch (error) {
      if (active && current === generation) fail(error instanceof Error ? error.message : 'Microphone permission or speech connection failed.');
    }
  }
  return { start, stop };
}
