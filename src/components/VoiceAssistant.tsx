import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { parseIntent, speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from '../config';
import type { PrayerTimesData } from '../services/prayerTimes';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistantState = 'idle' | 'wake-listening' | 'listening' | 'processing' | 'speaking' | 'error';

const WAKE_WORDS = ['hey lina', 'hey leena', 'hey lena', 'hey liner', 'a lina', 'eileen a'];

interface Props {
  prayerData?: PrayerTimesData | null;
}

export default function VoiceAssistant({ prayerData }: Props) {
  const app = useApp();
  const [state, setState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const [error, setError] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecognitionRef = useRef<any>(null);

  const enabled = app.settings.assistantEnabled !== false;
  const hasElevenLabs = !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const micDeviceId = app.settings.microphoneDeviceId;

  // Activate selected mic (Chrome SpeechRecognition uses the active getUserMedia stream's device)
  const activateMic = useCallback(async () => {
    if (!micDeviceId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: micDeviceId } }
      });
      // Keep stream alive briefly so Chrome picks it as active input
      setTimeout(() => stream.getTracks().forEach(t => t.stop()), 100);
    } catch { /* fallback to default */ }
  }, [micDeviceId]);

  // ── Speech output ──
  const speak = useCallback(async (text: string) => {
    setState('speaking');
    setResponse(text);
    setShowBubble(true);

    if (hasElevenLabs) {
      try {
        const audio = await speakWithElevenLabs(text, ELEVENLABS_API_KEY!, ELEVENLABS_VOICE_ID!);
        audioRef.current = audio;
        audio.onended = () => { setState('idle'); setTimeout(() => { setShowBubble(false); restartWakeWordListener(); }, 3000); };
        audio.onerror = () => { speakWithBrowserTTS(text); setState('idle'); setTimeout(() => { setShowBubble(false); restartWakeWordListener(); }, 3000); };
        await audio.play();
      } catch {
        speakWithBrowserTTS(text);
        setState('idle');
        setTimeout(() => { setShowBubble(false); restartWakeWordListener(); }, 3000);
      }
    } else {
      speakWithBrowserTTS(text);
      setState('idle');
      setTimeout(() => { setShowBubble(false); restartWakeWordListener(); }, 4000);
    }
  }, [hasElevenLabs]);

  // ── Process command ──
  const processTranscript = useCallback((text: string) => {
    setState('processing');
    setTranscript(text);

    const prayerTimes = prayerData?.prayers.map(p => ({ name: p.name, time: p.time }));
    const intent = parseIntent(text, {
      calendarEvents: app.calendarEvents,
      tasks: app.tasks,
      gamification: app.gamification,
      prayerTimes,
    });

    if (intent.type === 'navigate' && intent.surface) {
      app.navigate(intent.surface);
    }

    speak(intent.response);
  }, [app, prayerData, speak]);

  // ── Command listening (after wake word detected) ──
  const startCommandListening = useCallback(() => {
    if (!speechSupported) return;

    // Stop wake word listener
    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort(); } catch {}
      wakeRecognitionRef.current = null;
    }

    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    speechSynthesis?.cancel();

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-GB';

    recognition.onresult = (event: any) => {
      const result = event.results[0];
      if (result && result.isFinal) {
        const text = result[0].transcript;
        processTranscript(text);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        setState('idle');
        restartWakeWordListener();
      } else {
        setError(`Mic error: ${event.error}`);
        setState('error');
        setTimeout(() => { setState('idle'); restartWakeWordListener(); }, 3000);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setState('listening');
    setTranscript('');
    setResponse('');
    setError('');
    setShowBubble(true);
    activateMic().then(() => recognition.start());
  }, [speechSupported, processTranscript, activateMic]);

  // ── Wake word listener (continuous background) ──
  const restartWakeWordListener = useCallback(() => {
    if (!speechSupported || !enabled) return;

    // Clean up existing
    if (wakeRecognitionRef.current) {
      try { wakeRecognitionRef.current.abort(); } catch {}
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        if (WAKE_WORDS.some(w => text.includes(w))) {
          // Wake word detected!
          try { recognition.abort(); } catch {}
          wakeRecognitionRef.current = null;

          // Check if there's a command after the wake word
          const afterWake = text.replace(/.*(?:hey lina|hey leena|hey lena|hey liner|a lina|eileen a)\s*/i, '').trim();
          if (afterWake.length > 3 && event.results[i].isFinal) {
            // Command included with wake word: "Hey Lina show me calendar"
            setState('processing');
            setTranscript(afterWake);
            setShowBubble(true);
            processTranscript(afterWake);
          } else {
            // Just wake word — start command listening
            startCommandListening();
          }
          return;
        }
      }
    };

    recognition.onerror = () => {
      // Silently restart on error
      wakeRecognitionRef.current = null;
      setTimeout(restartWakeWordListener, 1000);
    };

    recognition.onend = () => {
      // Auto-restart continuous listening
      wakeRecognitionRef.current = null;
      if (enabled && state === 'idle' || state === 'wake-listening') {
        setTimeout(restartWakeWordListener, 500);
      }
    };

    wakeRecognitionRef.current = recognition;
    setWakeWordActive(true);
    setState('wake-listening');
    activateMic().then(() => { try { recognition.start(); } catch { /* already started */ } });
  }, [speechSupported, enabled, state, startCommandListening, processTranscript, activateMic]);

  // Start wake word listener on mount
  useEffect(() => {
    if (enabled && speechSupported) {
      restartWakeWordListener();
    }
    return () => {
      if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} }
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (audioRef.current) audioRef.current.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Manual click handler (fallback) ──
  const handleClick = () => {
    if (state === 'listening') {
      if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
      setState('idle');
      setShowBubble(false);
      restartWakeWordListener();
    } else if (state === 'speaking') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      speechSynthesis?.cancel();
      setState('idle');
      setShowBubble(false);
      restartWakeWordListener();
    } else {
      // Manual activation (also works)
      startCommandListening();
    }
  };

  if (!enabled) return null;

  return (
    <>
      {/* Floating avatar button */}
      <button
        className={`va-button ${state === 'wake-listening' ? 'idle' : state}`}
        onClick={handleClick}
        aria-label={state === 'listening' ? 'Stop listening' : 'Talk to Lina'}
        title={
          state === 'listening' ? 'Listening... click to cancel'
          : state === 'wake-listening' ? 'Say "Hey Lina" or click to talk'
          : 'Talk to Lina'
        }
      >
        <span className="va-avatar">L</span>
        {state === 'wake-listening' && wakeWordActive && <span className="va-ring wake" />}
        {state === 'listening' && <span className="va-ring" />}
        {state === 'listening' && <span className="va-ring delay" />}
        {state === 'speaking' && <span className="va-ring speaking" />}
      </button>

      {/* Speech bubble */}
      {showBubble && (
        <div className="va-bubble">
          {state === 'listening' && (
            <div className="va-bubble-text listening">
              <span className="va-dots"><span /><span /><span /></span>
              Listening...
            </div>
          )}
          {state === 'processing' && transcript && (
            <div className="va-bubble-text processing">
              <div className="va-you">You: {transcript}</div>
              <div className="va-thinking">Thinking...</div>
            </div>
          )}
          {(state === 'speaking' || (state === 'idle' && response) || (state === 'wake-listening' && response)) && (
            <div className="va-bubble-text response">
              {transcript && <div className="va-you">You: {transcript}</div>}
              <div className="va-lina">Lina: {response}</div>
            </div>
          )}
          {state === 'error' && (
            <div className="va-bubble-text error">{error}</div>
          )}
        </div>
      )}
    </>
  );
}
