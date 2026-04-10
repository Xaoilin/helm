import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import type { DeepgramLiveTranscriptUpdate } from '../services/deepgramSTT';
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
let liveTranscriptHandler: ((update: DeepgramLiveTranscriptUpdate) => void) | null = null;

vi.mock('../services/deepgramSTT', () => ({
  createRecorder: createRecorderMock,
  transcribeWithDeepgram: transcribeWithDeepgramMock,
  testChromeSpeechRecognition: testChromeSpeechRecognitionMock,
  createDeepgramLiveSession: (...args: Parameters<typeof createDeepgramLiveSessionMock>) => createDeepgramLiveSessionMock(...args),
}));

describe('useVoiceInput', () => {
  beforeEach(() => {
    liveTranscriptHandler = null;
    startRecorder.mockClear();
    stopRecorder.mockClear();
    getRecorderBlob.mockClear();
    isRecorderRecording.mockReset().mockReturnValue(true);
    createRecorderMock.mockClear();
    transcribeWithDeepgramMock.mockReset();
    testChromeSpeechRecognitionMock.mockReset();
    createDeepgramLiveSessionMock.mockReset().mockImplementation(({ onTranscript }) => {
      liveTranscriptHandler = onTranscript;
      return {
        sendChunk: vi.fn(),
        close: vi.fn(),
      };
    });
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

    expect(liveTranscriptHandler).not.toBeNull();

    act(() => {
      liveTranscriptHandler?.({
        transcript: 'book a review with Sam tomorrow',
        isFinal: false,
        speechFinal: false,
      });
    });

    expect(onTranscriptPreview).toHaveBeenCalledWith('book a review with Sam tomorrow');
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('auto-stops and transcribes when Deepgram marks speech as final', async () => {
    const onTranscript = vi.fn();
    const onTranscriptPreview = vi.fn();
    transcribeWithDeepgramMock.mockResolvedValue({
      transcript: 'book a review with Sam tomorrow',
      confidence: 0.99,
    });

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
    });

    act(() => {
      liveTranscriptHandler?.({
        transcript: 'book a review with Sam tomorrow',
        isFinal: true,
        speechFinal: true,
      });
    });

    await waitFor(() => {
      expect(stopRecorder).toHaveBeenCalledTimes(1);
      expect(transcribeWithDeepgramMock).toHaveBeenCalledTimes(1);
      expect(onTranscript).toHaveBeenCalledWith('book a review with Sam tomorrow');
    });
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

    vi.useRealTimers();
  });
});
