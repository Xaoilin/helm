import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { TIMING } from '../config/constants';

const {
  startRecorder,
  stopRecorder,
  getRecorderBlob,
  isRecorderRecording,
  createRecorderMock,
  transcribeWithDeepgramMock,
  testChromeSpeechRecognitionMock,
  createDeepgramLiveSessionMock,
} = vi.hoisted(() => {
  const startRecorder = vi.fn().mockResolvedValue(undefined);
  const stopRecorder = vi.fn();
  const getRecorderBlob = vi.fn().mockResolvedValue(new Blob([new Uint8Array(600)], { type: 'audio/webm' }));
  const isRecorderRecording = vi.fn().mockReturnValue(true);
  const createRecorderMock = vi.fn(() => ({
    start: startRecorder,
    stop: stopRecorder,
    getBlob: getRecorderBlob,
    isRecording: isRecorderRecording,
  }));
  const transcribeWithDeepgramMock = vi.fn();
  const testChromeSpeechRecognitionMock = vi.fn();
  const createDeepgramLiveSessionMock = vi.fn();

  return {
    startRecorder,
    stopRecorder,
    getRecorderBlob,
    isRecorderRecording,
    createRecorderMock,
    transcribeWithDeepgramMock,
    testChromeSpeechRecognitionMock,
    createDeepgramLiveSessionMock,
  };
});

let liveEventHandler: ((event: Record<string, unknown>) => void) | null = null;

vi.mock('../services/deepgramSTT', () => ({
  createRecorder: createRecorderMock,
  transcribeWithDeepgram: transcribeWithDeepgramMock,
  testChromeSpeechRecognition: testChromeSpeechRecognitionMock,
  createDeepgramLiveSession: (...args: Parameters<typeof createDeepgramLiveSessionMock>) => createDeepgramLiveSessionMock(...args),
}));

describe('useVoiceInput', () => {
  beforeEach(() => {
    liveEventHandler = null;
    startRecorder.mockReset().mockResolvedValue(undefined);
    stopRecorder.mockReset();
    getRecorderBlob.mockReset().mockResolvedValue(new Blob([new Uint8Array(600)], { type: 'audio/webm' }));
    isRecorderRecording.mockReset().mockReturnValue(true);
    createRecorderMock.mockClear();
    transcribeWithDeepgramMock.mockReset();
    testChromeSpeechRecognitionMock.mockReset();
    createDeepgramLiveSessionMock.mockReset().mockImplementation(({ onEvent }) => {
      liveEventHandler = onEvent;
      return {
        sendChunk: vi.fn(),
        close: vi.fn(),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits until the Deepgram recorder is actually live before firing the ready callback', async () => {
    let resolveStart: (() => void) | null = null;
    startRecorder.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveStart = resolve;
    }));
    const onListeningPreparing = vi.fn();
    const onListeningStart = vi.fn();

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript: vi.fn(),
      onListeningPreparing,
      onListeningStart,
    }));

    act(() => {
      result.current.startListening();
    });

    expect(onListeningPreparing).toHaveBeenCalledTimes(1);
    expect(onListeningStart).not.toHaveBeenCalled();

    resolveStart?.();

    await waitFor(() => {
      expect(onListeningStart).toHaveBeenCalledTimes(1);
    });
  });

  it('waits for the browser speech engine onstart event before firing the ready callback', async () => {
    testChromeSpeechRecognitionMock.mockResolvedValue(true);
    class FakeSpeechRecognition {
      static latestInstance: FakeSpeechRecognition | null = null;

      continuous = false;
      interimResults = false;
      lang = '';
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        FakeSpeechRecognition.latestInstance = this;
      }

      start() {
        return undefined;
      }

      abort() {
        this.onend?.();
      }
    }

    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);

    const onListeningPreparing = vi.fn();
    const onListeningStart = vi.fn();

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: '',
      sttLang: 'en-GB',
      onTranscript: vi.fn(),
      onListeningPreparing,
      onListeningStart,
    }));

    await waitFor(() => {
      expect(result.current.voiceBackend).toBe('chrome');
    });

    act(() => {
      result.current.startListening();
    });

    expect(onListeningPreparing).toHaveBeenCalledTimes(1);
    expect(onListeningStart).not.toHaveBeenCalled();

    act(() => {
      FakeSpeechRecognition.latestInstance?.onstart?.();
    });

    expect(onListeningStart).toHaveBeenCalledTimes(1);
  });

  it('surfaces live Deepgram transcript preview updates while recording', async () => {
    const onTranscript = vi.fn();
    const onTranscriptPreview = vi.fn();

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript,
      onTranscriptPreview,
    }));

    act(() => {
      result.current.startListening();
    });

    await waitFor(() => {
      expect(createDeepgramLiveSessionMock).toHaveBeenCalledTimes(1);
      expect(createRecorderMock).toHaveBeenCalledTimes(1);
    });

    expect(liveEventHandler).not.toBeNull();

    act(() => {
      liveEventHandler?.({
        type: 'transcript',
        transcript: 'book a review with Sam tomorrow',
        isFinal: false,
        speechFinal: false,
      });
    });

    expect(onTranscriptPreview).toHaveBeenCalledWith('book a review with Sam tomorrow');
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('does not finalize the turn when Deepgram only marks speech as final', async () => {
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript,
    }));

    act(() => {
      result.current.startListening();
    });

    await waitFor(() => {
      expect(createDeepgramLiveSessionMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      liveEventHandler?.({
        type: 'transcript',
        transcript: 'book a review with Sam tomorrow',
        isFinal: true,
        speechFinal: true,
      });
    });

    expect(stopRecorder).not.toHaveBeenCalled();
    expect(transcribeWithDeepgramMock).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('finalizes after UtteranceEnd and the local settle window', async () => {
    vi.useFakeTimers();
    const onTranscript = vi.fn();
    transcribeWithDeepgramMock.mockResolvedValue({
      transcript: 'book a review with Sam tomorrow',
      confidence: 0.99,
    });

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript,
    }));

    await act(async () => {
      result.current.startListening();
      await Promise.resolve();
    });

    act(() => {
      liveEventHandler?.({
        type: 'transcript',
        transcript: 'book a review with Sam tomorrow',
        isFinal: true,
        speechFinal: true,
      });
      liveEventHandler?.({
        type: 'utterance-end',
        lastWordEnd: 2.4,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(TIMING.VOICE_TURN_END_SETTLE_DELAY - 50);
      await Promise.resolve();
    });

    expect(stopRecorder).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopRecorder).toHaveBeenCalledTimes(1);
    expect(transcribeWithDeepgramMock).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('book a review with Sam tomorrow');
  });

  it('cancels a pending finalize when new transcript activity resumes', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript: vi.fn(),
    }));

    await act(async () => {
      result.current.startListening();
      await Promise.resolve();
    });

    act(() => {
      liveEventHandler?.({
        type: 'transcript',
        transcript: 'book a review',
        isFinal: true,
        speechFinal: true,
      });
      liveEventHandler?.({
        type: 'utterance-end',
        lastWordEnd: 1.2,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(TIMING.VOICE_TURN_END_SETTLE_DELAY / 2);
      await Promise.resolve();
    });

    act(() => {
      liveEventHandler?.({
        type: 'transcript',
        transcript: 'book a review with Sam tomorrow',
        isFinal: false,
        speechFinal: false,
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(TIMING.VOICE_TURN_END_SETTLE_DELAY + 20);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopRecorder).not.toHaveBeenCalled();
    expect(transcribeWithDeepgramMock).not.toHaveBeenCalled();
  });

  it('treats silent Deepgram turns as no-speech instead of a generic error', async () => {
    vi.useFakeTimers();
    const onTranscript = vi.fn();
    const onNoSpeech = vi.fn();
    getRecorderBlob.mockResolvedValueOnce(new Blob(['x'], { type: 'audio/webm' }));

    const { result } = renderHook(() => useVoiceInput({
      enabled: true,
      deepgramKey: 'dg-test-key',
      sttLang: 'en-GB',
      onTranscript,
      onNoSpeech,
    }));

    await act(async () => {
      result.current.startListening();
      await Promise.resolve();
    });

    expect(createRecorderMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(TIMING.VOICE_NO_SPEECH_TIMEOUT + 50);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onNoSpeech).toHaveBeenCalledTimes(1);
    expect(onTranscript).not.toHaveBeenCalled();
  });
});
