/**
 * useVoiceInput — Deepgram + Chrome SpeechRecognition for voice input.
 *
 * Detects the best available backend on mount, then exposes
 * start/stop controls and the current listening state.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  createDeepgramLiveSession,
  createRecorder,
  transcribeWithDeepgram,
  testChromeSpeechRecognition,
} from '../services/deepgramSTT';
import { TIMING, LIMITS } from '../config/constants';
import { logError, logWarn } from '../services/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type VoiceBackend = 'deepgram' | 'chrome' | 'none';

interface UseVoiceInputOptions {
  enabled: boolean;
  deepgramKey: string;
  micDeviceId?: string;
  sttLang: string;
  onTranscript: (text: string) => void;
  /** Called with live speech-to-text preview updates while the user is speaking. */
  onTranscriptPreview?: (text: string) => void;
  /** Called when listening starts (to update parent state). */
  onListeningStart?: () => void;
  /** Called when an error occurs (to surface in UI). */
  onError?: (message: string) => void;
  /** Called when listening stops without a transcript (to reset parent state). */
  onListeningEnd?: () => void;
  /** Called when the user never actually says anything. */
  onNoSpeech?: () => void;
  /** Called when processing starts (Deepgram transcription in progress). */
  onProcessingStart?: () => void;
}

interface UseVoiceInputReturn {
  startListening: () => void;
  stopListening: () => void;
  cancelListening: () => void;
  isListening: boolean;
  voiceBackend: VoiceBackend;
}

export function useVoiceInput({
  enabled,
  deepgramKey,
  micDeviceId,
  sttLang,
  onTranscript,
  onTranscriptPreview,
  onListeningStart,
  onError,
  onListeningEnd,
  onNoSpeech,
  onProcessingStart,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [fallbackBackend, setFallbackBackend] = useState<VoiceBackend>('none');
  const [fallbackChecked, setFallbackChecked] = useState(false);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const recognitionRef = useRef<any>(null);
  const liveSessionRef = useRef<ReturnType<typeof createDeepgramLiveSession> | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const noSpeechTimeoutRef = useRef<number | null>(null);
  const deepgramStopInFlightRef = useRef(false);
  const chromeStopRequestedRef = useRef(false);
  const chromeFinalTranscriptRef = useRef('');
  const chromeHasFinalTranscriptRef = useRef(false);
  const hasPreviewSpeechRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onTranscriptPreviewRef = useRef(onTranscriptPreview);
  const onErrorRef = useRef(onError);
  const onListeningEndRef = useRef(onListeningEnd);
  const onNoSpeechRef = useRef(onNoSpeech);
  const onListeningStartRef = useRef(onListeningStart);
  const onProcessingStartRef = useRef(onProcessingStart);
  const voiceBackend: VoiceBackend = !enabled ? 'none' : deepgramKey ? 'deepgram' : fallbackBackend;

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onTranscriptPreviewRef.current = onTranscriptPreview; }, [onTranscriptPreview]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onListeningEndRef.current = onListeningEnd; }, [onListeningEnd]);
  useEffect(() => { onNoSpeechRef.current = onNoSpeech; }, [onNoSpeech]);
  useEffect(() => { onListeningStartRef.current = onListeningStart; }, [onListeningStart]);
  useEffect(() => { onProcessingStartRef.current = onProcessingStart; }, [onProcessingStart]);

  const clearDeepgramTimers = useCallback(() => {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (noSpeechTimeoutRef.current !== null) {
      window.clearTimeout(noSpeechTimeoutRef.current);
      noSpeechTimeoutRef.current = null;
    }
  }, []);

  const closeLiveSession = useCallback(() => {
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
  }, []);

  const stopDeepgramAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || deepgramStopInFlightRef.current) return;
    deepgramStopInFlightRef.current = true;
    clearDeepgramTimers();

    if (recorder.isRecording()) {
      recorder.stop();
    }

    closeLiveSession();
    setIsListening(false);

    try {
      const blob = await recorder.getBlob();
      if (blob.size < LIMITS.MIN_AUDIO_BLOB_SIZE) {
        onNoSpeechRef.current?.();
        onListeningEndRef.current?.();
        return;
      }

      onProcessingStartRef.current?.();
      const result = await transcribeWithDeepgram(blob, deepgramKey, sttLang);

      if (!result.transcript || result.transcript.trim() === '') {
        onNoSpeechRef.current?.();
        onListeningEndRef.current?.();
        return;
      }

      onTranscriptRef.current(result.transcript);
    } catch (e: any) {
      logError('useVoiceInput', e);
      onErrorRef.current?.(e.message || 'Transcription failed');
      onListeningEndRef.current?.();
    } finally {
      recorderRef.current = null;
      hasPreviewSpeechRef.current = false;
      deepgramStopInFlightRef.current = false;
    }
  }, [clearDeepgramTimers, closeLiveSession, deepgramKey, sttLang]);

  const cancelDeepgramListening = useCallback(() => {
    const recorder = recorderRef.current;
    clearDeepgramTimers();
    closeLiveSession();
    deepgramStopInFlightRef.current = false;
    hasPreviewSpeechRef.current = false;

    if (recorder?.isRecording()) {
      recorder.stop();
    }

    recorderRef.current = null;
    setIsListening(false);
    onListeningEndRef.current?.();
  }, [clearDeepgramTimers, closeLiveSession]);

  // ── Detect best voice backend on mount ──
  useEffect(() => {
    if (!enabled || deepgramKey || fallbackChecked) return;
    let cancelled = false;

    testChromeSpeechRecognition().then(works => {
      if (cancelled) return;
      setFallbackBackend(works ? 'chrome' : 'none');
      setFallbackChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, deepgramKey, fallbackChecked]);

  // ── Deepgram recording ──
  const startDeepgramListening = useCallback(async () => {
    setIsListening(true);
    hasPreviewSpeechRef.current = false;
    deepgramStopInFlightRef.current = false;
    onListeningStartRef.current?.();

    try {
      liveSessionRef.current = createDeepgramLiveSession({
        apiKey: deepgramKey,
        language: sttLang,
        onTranscript: ({ transcript, speechFinal }) => {
          if (transcript) {
            hasPreviewSpeechRef.current = true;
            if (noSpeechTimeoutRef.current !== null) {
              window.clearTimeout(noSpeechTimeoutRef.current);
              noSpeechTimeoutRef.current = null;
            }
            onTranscriptPreviewRef.current?.(transcript);
          }

          if (speechFinal && transcript && recorderRef.current?.isRecording()) {
            void stopDeepgramAndTranscribe();
          }
        },
        onError: (error) => {
          logWarn('useVoiceInput', `Deepgram live preview unavailable: ${error.message}`);
        },
      });

      const recorder = createRecorder({
        deviceId: micDeviceId,
        onChunk: (chunk) => {
          liveSessionRef.current?.sendChunk(chunk);
        },
      });
      recorderRef.current = recorder;
      await recorder.start();

      noSpeechTimeoutRef.current = window.setTimeout(() => {
        if (!hasPreviewSpeechRef.current && recorder.isRecording()) {
          void stopDeepgramAndTranscribe();
        }
      }, TIMING.VOICE_NO_SPEECH_TIMEOUT);

      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.isRecording()) {
          void stopDeepgramAndTranscribe();
        }
      }, TIMING.RECORDING_MAX_DURATION);
    } catch (e: any) {
      logError('useVoiceInput', e);
      closeLiveSession();
      const msg = e.message?.includes('Permission') || e.message?.includes('NotAllowed')
        ? 'Microphone blocked. Click \uD83D\uDD12 in Chrome\'s address bar to allow.'
        : `Mic error: ${e.message}`;
      onErrorRef.current?.(msg);
      setIsListening(false);
      onListeningEndRef.current?.();
    }
  }, [closeLiveSession, deepgramKey, micDeviceId, sttLang, stopDeepgramAndTranscribe]);

  // ── Chrome SpeechRecognition (fallback) ──
  const startChromeListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    chromeStopRequestedRef.current = false;
    chromeFinalTranscriptRef.current = '';
    chromeHasFinalTranscriptRef.current = false;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = sttLang;

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript?.trim() || '';
        if (!transcript) continue;
        if (result.isFinal) {
          finalTranscript = [finalTranscript, transcript].filter(Boolean).join(' ');
        } else {
          interimTranscript = [interimTranscript, transcript].filter(Boolean).join(' ');
        }
      }

      const previewTranscript = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
      if (previewTranscript) {
        onTranscriptPreviewRef.current?.(previewTranscript);
      }

      if (finalTranscript && finalTranscript !== chromeFinalTranscriptRef.current) {
        chromeFinalTranscriptRef.current = finalTranscript;
        chromeHasFinalTranscriptRef.current = true;
        onTranscriptRef.current(finalTranscript);
      }
    };

    rec.onerror = (event: any) => {
      recognitionRef.current = null;
      setIsListening(false);

      if (event.error === 'aborted' && chromeStopRequestedRef.current) {
        return;
      }

      if (event.error === 'no-speech') {
        onNoSpeechRef.current?.();
        onListeningEndRef.current?.();
      } else if (event.error === 'aborted') {
        onListeningEndRef.current?.();
      } else if (event.error === 'network') {
        setFallbackBackend('none');
        onErrorRef.current?.('Chrome voice unavailable \u2014 get a free Deepgram API key at deepgram.com and paste it in Settings \u2192 Voice Assistant.');
        onListeningEndRef.current?.();
      } else if (event.error === 'not-allowed') {
        onErrorRef.current?.('Microphone blocked. Click \uD83D\uDD12 in Chrome\'s address bar to allow.');
        onListeningEndRef.current?.();
      } else {
        onErrorRef.current?.(`Mic error: ${event.error}`);
        onListeningEndRef.current?.();
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      if (!chromeStopRequestedRef.current && !chromeHasFinalTranscriptRef.current) {
        onNoSpeechRef.current?.();
        onListeningEndRef.current?.();
      }
    };

    recognitionRef.current = rec;
    setIsListening(true);
    onListeningStartRef.current?.();
    rec.start();
  }, [sttLang]);

  // ── Unified start / stop ──
  const startListening = useCallback(() => {
    if (voiceBackend === 'deepgram') {
      void startDeepgramListening();
    } else if (voiceBackend === 'chrome') {
      startChromeListening();
    } else {
      onErrorRef.current?.('Voice not available. Add a Deepgram API key in Settings \u2192 Voice Assistant to enable voice input.');
      onListeningEndRef.current?.();
    }
  }, [startChromeListening, startDeepgramListening, voiceBackend]);

  const stopListening = useCallback(() => {
    if (voiceBackend === 'deepgram' && recorderRef.current) {
      void stopDeepgramAndTranscribe();
    } else if (recognitionRef.current) {
      chromeStopRequestedRef.current = true;
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setIsListening(false);
      onListeningEndRef.current?.();
    }
  }, [stopDeepgramAndTranscribe, voiceBackend]);

  const cancelListening = useCallback(() => {
    if (voiceBackend === 'deepgram') {
      cancelDeepgramListening();
      return;
    }

    if (recognitionRef.current) {
      chromeStopRequestedRef.current = true;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    setIsListening(false);
    onListeningEndRef.current?.();
  }, [cancelDeepgramListening, voiceBackend]);

  useEffect(() => () => {
    clearDeepgramTimers();
    closeLiveSession();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (error) {
        logWarn('useVoiceInput', `SpeechRecognition cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    if (recorderRef.current?.isRecording()) {
      recorderRef.current.stop();
    }
  }, [clearDeepgramTimers, closeLiveSession]);

  return {
    startListening,
    stopListening,
    cancelListening,
    isListening,
    voiceBackend,
  };
}
