import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepgramSpeech } from '../services/deepgramSpeech';
import { getSpeechToken } from '../services/jevVoiceApi';

vi.mock('../services/jevVoiceApi', () => ({ getSpeechToken: vi.fn() }));
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string, public protocols: string[]) { FakeSocket.instances.push(this); }
}
class FakeRecorder {
  static isTypeSupported = () => true;
  static instances: FakeRecorder[] = [];
  state = 'recording';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => { this.state = 'inactive'; });
  constructor() { FakeRecorder.instances.push(this); }
}

describe('Deepgram foreground speech session', () => {
  const trackStop = vi.fn();
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn();
  const callbacks = { transcript: vi.fn(), status: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    FakeSocket.instances = []; FakeRecorder.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    getUserMedia.mockResolvedValue(stream);
    vi.mocked(getSpeechToken).mockResolvedValue('synthetic-short-lived-token');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses browser bearer authentication, forwards final speech once and releases every resource', async () => {
    const speech = createDeepgramSpeech(callbacks);
    await speech.start('deepgram-secret-id');
    const socket = FakeSocket.instances[0];
    expect(socket.protocols).toEqual(['bearer', 'synthetic-short-lived-token']);
    socket.onopen?.();
    const message = { type: 'Results', is_final: true, start: 0, duration: 1,
      channel: { alternatives: [{ transcript: 'Hey Sabah open Calendar over' }] } };
    socket.onmessage?.({ data: JSON.stringify(message) });
    socket.onmessage?.({ data: JSON.stringify(message) });
    expect(callbacks.transcript).toHaveBeenCalledTimes(1);
    expect(callbacks.transcript).toHaveBeenCalledWith('Hey Sabah open Calendar over', true);
    speech.stop();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    socket.onmessage?.({ data: JSON.stringify({ ...message, start: 1 }) });
    expect(callbacks.transcript).toHaveBeenCalledTimes(1);
  });
  it('releases a microphone permission granted after Stop without opening a socket', async () => {
    let allow!: (media: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>(resolve => { allow = resolve; }));
    const speech = createDeepgramSpeech(callbacks);
    const starting = speech.start('key');
    speech.stop(); allow(stream); await starting;
    expect(trackStop).toHaveBeenCalledOnce();
    expect(getSpeechToken).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);
  });
  it('aborts token exchange on Stop and ignores a late token', async () => {
    let grant!: (token: string) => void;
    vi.mocked(getSpeechToken).mockReturnValue(new Promise<string>(resolve => { grant = resolve; }));
    const speech = createDeepgramSpeech(callbacks);
    const starting = speech.start('key');
    await vi.waitFor(() => expect(getSpeechToken).toHaveBeenCalled());
    const signal = vi.mocked(getSpeechToken).mock.calls[0][1];
    speech.stop(); grant('late-token'); await starting;
    expect(signal.aborted).toBe(true);
    expect(trackStop).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(0);
  });
  it('shows a connection error and stops without an automatic reconnect', async () => {
    const speech = createDeepgramSpeech(callbacks);
    await speech.start('key');
    FakeSocket.instances[0].onerror?.();
    expect(callbacks.error).toHaveBeenCalledWith(expect.stringContaining('Check the key and credits'));
    expect(trackStop).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
