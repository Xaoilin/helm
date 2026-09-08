import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speakWithElevenLabs, SpeechServiceError } from '../services/voiceAssistant';
import { API_TIMEOUT } from '../config/constants';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getHeaders: vi.fn(),
  createObjectUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
}));

vi.mock('../config', () => ({
  SUPABASE_URL: 'https://example.supabase.co/',
}));

vi.mock('../store/supabase', () => ({
  getClient: () => ({ id: 'synthetic-client' }),
}));

vi.mock('../services/hostedAssistantAccess', () => ({
  getHostedAssistantAuthHeaders: mocks.getHeaders,
}));

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(src: string) {
    this.src = src;
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {}
}

beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.getHeaders.mockReset().mockResolvedValue({
    apikey: 'public-key',
    Authorization: 'Bearer user-token',
  });
  mocks.createObjectUrl.mockReset().mockReturnValue('blob:speech');
  mocks.revokeObjectUrl.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal('Audio', MockAudio);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: mocks.createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: mocks.revokeObjectUrl,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authenticated assistant speech transport', () => {
  it('uses the current user headers and sends only the speech contract fields', async () => {
    mocks.fetch.mockResolvedValue(new Response('audio bytes', {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }));

    const audio = await speakWithElevenLabs('Hello there', 'secret-uuid', 'voice123');

    expect(mocks.getHeaders).toHaveBeenCalledWith({ id: 'synthetic-client' });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/assistant-speech',
      expect.objectContaining({
        method: 'POST',
        headers: {
          apikey: 'public-key',
          Authorization: 'Bearer user-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hello there', secretId: 'secret-uuid', voiceId: 'voice123' }),
      }),
    );
    expect(audio.src).toBe('blob:speech');
  });

  it('surfaces the sanitized server error without sending a provider credential', async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      code: 'speech_secret_unavailable',
      error: 'The saved voice secret is unavailable.',
      deploymentSha: 'sha-123',
    }, { status: 503 }));

    const promise = speakWithElevenLabs('Hello', 'secret-uuid', 'voice123');
    await expect(promise).rejects.toBeInstanceOf(SpeechServiceError);
    await expect(promise).rejects.toMatchObject({
      code: 'speech_secret_unavailable',
      deploymentSha: 'sha-123',
      message: 'The saved voice secret is unavailable.',
    });
    const request = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      text: 'Hello',
      secretId: 'secret-uuid',
      voiceId: 'voice123',
    });
    expect(String(request.body)).not.toContain('provider');
  });

  it('settles request and blob loading when the caller cancels', async () => {
    let resolveBlob!: (blob: Blob) => void;
    const blobPromise = new Promise<Blob>(resolve => { resolveBlob = resolve; });
    mocks.fetch.mockResolvedValue({
      ok: true,
      blob: () => blobPromise,
    });

    const controller = new AbortController();
    const promise = speakWithElevenLabs('Hello', 'secret-uuid', 'voice123', controller.signal);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.createObjectUrl).not.toHaveBeenCalled();
    resolveBlob(new Blob(['late audio']));
  });

  it('settles a stalled error body when the request deadline expires', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: () => new Promise(() => {}),
    });
    const promise = speakWithElevenLabs('Hello', 'secret-uuid', 'voice123');
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(API_TIMEOUT.ELEVENLABS_TTS);
    await assertion;
    expect(mocks.createObjectUrl).not.toHaveBeenCalled();
  });
});
