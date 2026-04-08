import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import type { DeepgramLiveTranscriptUpdate } from '../services/deepgramSTT';

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
  const getRecorderBlob = vi.fn().mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
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
});
