import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { parseIntent, speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import type { PrayerTimesData } from '../services/prayerTimes';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

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
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const enabled = app.settings.assistantEnabled !== false;
  const hasElevenLabs = !!(app.settings.elevenLabsApiKey && app.settings.elevenLabsVoiceId);

  // Check browser support
  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const speak = useCallback(async (text: string) => {
    setState('speaking');
    setResponse(text);
    setShowBubble(true);

    if (hasElevenLabs) {
      try {
        const audio = await speakWithElevenLabs(text, app.settings.elevenLabsApiKey!, app.settings.elevenLabsVoiceId!);
        audioRef.current = audio;
        audio.onended = () => { setState('idle'); setTimeout(() => setShowBubble(false), 3000); };
        audio.onerror = () => { speakWithBrowserTTS(text); setState('idle'); setTimeout(() => setShowBubble(false), 3000); };
        await audio.play();
      } catch {
        speakWithBrowserTTS(text);
        setState('idle');
        setTimeout(() => setShowBubble(false), 3000);
      }
    } else {
      speakWithBrowserTTS(text);
      setState('idle');
      setTimeout(() => setShowBubble(false), 4000);
    }
  }, [hasElevenLabs, app.settings.elevenLabsApiKey, app.settings.elevenLabsVoiceId]);

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

    // Execute navigation
    if (intent.type === 'navigate' && intent.surface) {
      app.navigate(intent.surface);
    }

    // Speak response
    speak(intent.response);
  }, [app, prayerData, speak]);

  const startListening = useCallback(() => {
    if (!speechSupported) {
      setError('Speech recognition not supported in this browser');
      setState('error');
      return;
    }

    // Stop any current audio
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
      } else {
        setError(`Mic error: ${event.error}`);
        setState('error');
        setTimeout(() => setState('idle'), 3000);
      }
    };

    recognition.onend = () => {
      if (state === 'listening') setState('idle');
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setState('listening');
    setTranscript('');
    setResponse('');
    setError('');
    setShowBubble(true);
    recognition.start();
  }, [speechSupported, processTranscript, state]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setState('idle');
    setShowBubble(false);
  }, []);

  const handleClick = () => {
    if (state === 'listening') stopListening();
    else if (state === 'speaking') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      speechSynthesis?.cancel();
      setState('idle');
      setShowBubble(false);
    }
    else if (state === 'idle' || state === 'error') startListening();
  };

  // Cleanup on unmount
  useEffect(() => () => {
    if (recognitionRef.current) recognitionRef.current.abort();
    if (audioRef.current) audioRef.current.pause();
  }, []);

  if (!enabled) return null;

  return (
    <>
      {/* Floating avatar button */}
      <button
        className={`va-button ${state}`}
        onClick={handleClick}
        aria-label={state === 'listening' ? 'Stop listening' : 'Talk to Lina'}
        title={state === 'listening' ? 'Listening... click to cancel' : 'Talk to Lina'}
      >
        <span className="va-avatar">L</span>
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
          {(state === 'speaking' || (state === 'idle' && response)) && (
            <div className="va-bubble-text response">
              {transcript && <div className="va-you">You: {transcript}</div>}
              <div className="va-lina">Lina: {response}</div>
            </div>
          )}
          {state === 'error' && (
            <div className="va-bubble-text error">{error}</div>
          )}
          {!hasElevenLabs && state === 'idle' && !response && (
            <div className="va-bubble-text hint" style={{ fontSize: 11, color: '#6b6f85' }}>
              Set up ElevenLabs in Settings for Lina's voice
            </div>
          )}
        </div>
      )}
    </>
  );
}
