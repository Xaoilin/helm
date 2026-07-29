// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeepgramLiveSession, transcribeWithDeepgram } from '../services/deepgramSTT';
import { TIMING } from '../config/constants';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sentMessages: Array<string | ArrayBuffer> = [];

  constructor(
    public url: string,
    public protocols?: string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string | ArrayBuffer) {
    this.sentMessages.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  static instances: MockWebSocket[] = [];
}

describe('deepgramSTT', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('configures the live websocket with patient voice-turn parameters', () => {
    const session = createDeepgramLiveSession({
      apiKey: 'dg-test-key',
      language: 'en-GB',
      onEvent: vi.fn(),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    const url = new URL(socket.url);

    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.get('language')).toBe('en-GB');
    expect(url.searchParams.get('interim_results')).toBe('true');
    expect(url.searchParams.get('vad_events')).toBe('true');
    expect(url.searchParams.get('endpointing')).toBe(String(TIMING.DEEPGRAM_ENDPOINTING));
    expect(url.searchParams.get('utterance_end_ms')).toBe(String(TIMING.DEEPGRAM_UTTERANCE_END_MS));

    socket.open();
    session.close();
    vi.runOnlyPendingTimers();
  });

  it('surfaces Deepgram UtteranceEnd events to callers', () => {
    const onEvent = vi.fn();
    createDeepgramLiveSession({
      apiKey: 'dg-test-key',
      language: 'en-GB',
      onEvent,
    });

    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'UtteranceEnd',
        last_word_end: 2.5,
      }),
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'utterance-end',
      lastWordEnd: 2.5,
    });
  });

  it('uses nova-3 for final file transcription requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: {
          channels: [{
            alternatives: [{
              transcript: 'hello there',
              confidence: 0.98,
            }],
          }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await transcribeWithDeepgram(new Blob([new Uint8Array(600)], { type: 'audio/webm' }), 'dg-test-key', 'en-GB');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    const requestUrl = new URL(url as string);

    expect(requestUrl.searchParams.get('model')).toBe('nova-3');
    expect(requestUrl.searchParams.get('language')).toBe('en-GB');
    expect(requestUrl.searchParams.get('smart_format')).toBe('true');
  });
});
