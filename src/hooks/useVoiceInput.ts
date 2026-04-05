/**
 * useVoiceInput — Deepgram + Chrome SpeechRecognition for voice input.
 *
 * Detects the best available backend on mount, then exposes
 * start/stop controls and the current listening state.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createRecorder, transcribeWithDeepgram, testChromeSpeechRecognition } from '../services/deepgramSTT';
import { TIMING, LIMITS } from '../config/constants';
import { logError } from '../services/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type VoiceBackend = 'deepgram' | 'chrome' | 'none';

interface UseVoiceInputOptions {
  enabled: boolean;
  deepgramKey: string;
  micDeviceId?: string;
  sttLang: string;
  onTranscript: (text: string) => void;
  /** Called when listening starts (to update parent state). */
  onListeningStart?: () => void;
  /** Called when an error occurs (to surface in UI). */
  onError?: (message: string) => void;
  /** Called when listening stops without a transcript (to reset parent state). */
  onListeningEnd?: () => void;
  /** Called when processing starts (Deepgram transcription in progress). */
  onProcessingStart?: () => void;
}

interface UseVoiceInputReturn {
  startListening: () => void;
  stopListening: () => void;
  isListening: boolean;
  voiceBackend: VoiceBackend;
}

export function useVoiceInput({
  enabled,
  deepgramKey,
  micDeviceId,
  sttLang,
  onTranscript,
  onListeningStart,
  onError,
  onListeningEnd,
  onProcessingStart,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [voiceBackend, setVoiceBackend] = useState<VoiceBackend>('none');
  const [backendChecked, setBackendChecked] = useState(false);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const recognitionRef = useRef<any>(null);

  // Store callbacks in refs to avoid re-creating listeners
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onListeningEndRef = useRef(onListeningEnd);
  onListeningEndRef.current = onListeningEnd;
  const onListeningStartRef = useRef(onListeningStart);
  onListeningStartRef.current = onListeningStart;
  const onProcessingStartRef = useRef(onProcessingStart);
  onProcessingStartRef.current = onProcessingStart;

  // ── Detect best voice backend on mount ──
  useEffect(() => {
    if (!enabled || backendChecked) return;

    if (deepgramKey) {
      setVoiceBackend('deepgram');
      setBackendChecked(true);
      return;
    }

    testChromeSpeechRecognition().then(works => {
      setVoiceBackend(works ? 'chrome' : 'none');
      setBackendChecked(true);
    });
  }, [enabled, deepgramKey, backendChecked]);

  // ── Deepgram recording ──
  const startDeepgramListening = useCallback(async () => {
    setIsListening(true);
    onListeningStartRef.current?.();

    try {
      const recorder = createRecorder(micDeviceId);
      recorderRef.current = recorder;
      await recorder.start();

      setTimeout(() => {
        if (recorder.isRecording()) {
          recorder.stop();
        }
      }, TIMING.RECORDING_MAX_DURATION);
    } catch (e: any) {
      logError('useVoiceInput', e);
      const msg = e.message?.includes('Permission') || e.message?.includes('NotAllowed')
        ? 'Microphone blocked. Click \uD83D\uDD12 in Chrome\'s address bar to allow.'
        : `Mic error: ${e.message}`;
      onErrorRef.current?.(msg);
      setIsListening(false);
      onListeningEndRef.current?.();
    }
  }, [micDeviceId]);

  const stopDeepgramAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (recorder.isRecording()) {
      recorder.stop();
    }

    setIsListening(false);
    onProcessingStartRef.current?.();

    try {
      const blob = await recorder.getBlob();
      if (blob.size < LIMITS.MIN_AUDIO_BLOB_SIZE) {
        onErrorRef.current?.('No speech detected. Try again or type your command.');
        onListeningEndRef.current?.();
        return;
      }

      const result = await transcribeWithDeepgram(blob, deepgramKey, sttLang);

      if (!result.transcript || result.transcript.trim() === '') {
        onErrorRef.current?.('Couldn\'t make out what you said. Try again or type your command.');
        onListeningEndRef.current?.();
        return;
      }

      onTranscriptRef.current(result.transcript);
    } catch (e: any) {
      logError('useVoiceInput', e);
      onErrorRef.current?.(e.message || 'Transcription failed');
      onListeningEndRef.current?.();
    }
    recorderRef.current = null;
  }, [deepgramKey, sttLang]);

  // ── Chrome SpeechRecognition (fallback) ──
  const startChromeListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = sttLang;

    rec.onresult = (event: any) => {
      const result = event.results[0];
      if (result?.isFinal) onTranscriptRef.current(result[0].transcript);
    };

    rec.onerror = (event: any) => {
      recognitionRef.current = null;
      setIsListening(false);

      if (event.error === 'no-speech' || event.error === 'aborted') {
        onListeningEndRef.current?.();
      } else if (event.error === 'network') {
        setVoiceBackend('none');
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

    rec.onend = () => { recognitionRef.current = null; };

    recognitionRef.current = rec;
    setIsListening(true);
    onListeningStartRef.current?.();
    rec.start();
  }, [sttLang]);

  // ── Unified start / stop ──
  const startListening = useCallback(() => {
    if (voiceBackend === 'deepgram') {
      startDeepgramListening();
    } else if (voiceBackend === 'chrome') {
      startChromeListening();
    } else {
      onErrorRef.current?.('Voice not available. Add a Deepgram API key in Settings \u2192 Voice Assistant to enable voice input.');
      onListeningEndRef.current?.();
    }
  }, [voiceBackend, startDeepgramListening, startChromeListening]);

  const stopListening = useCallback(() => {
    if (voiceBackend === 'deepgram' && recorderRef.current) {
      stopDeepgramAndTranscribe();
    } else if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setIsListening(false);
      onListeningEndRef.current?.();
    }
  }, [voiceBackend, stopDeepgramAndTranscribe]);

  /** Abort any active recording/recognition — used by parent for cleanup. */
  const abortAll = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    if (recorderRef.current?.isRecording()) {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    setIsListening(false);
  }, []);

  // Expose abortAll on the return as well — attach to ref pattern
  // We expose it via a stable ref the parent can call
  const abortRef = useRef(abortAll);
  abortRef.current = abortAll;

  return {
    startListening,
    stopListening,
    isListening,
    voiceBackend,
  };
}
