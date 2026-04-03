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
  const [textInput, setTextInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(true); // controls wake word restart

  const enabled = app.settings.assistantEnabled !== false;
  const wakeWordEnabled = app.settings.wakeWordEnabled === true; // off by default — opt-in
  const hasElevenLabs = !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const micDeviceId = app.settings.microphoneDeviceId;

  const activateMic = useCallback(async () => {
    if (!micDeviceId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micDeviceId } } });
      setTimeout(() => stream.getTracks().forEach(t => t.stop()), 100);
    } catch { /* fallback */ }
  }, [micDeviceId]);

  // ── Speech output ──
  const speak = useCallback(async (text: string) => {
    setState('speaking');
    setResponse(text);
    setShowBubble(true);

    const done = () => {
      setState('idle');
      setTimeout(() => setShowBubble(false), 3000);
      shouldListenRef.current = true; // resume wake word after speaking
    };

    if (hasElevenLabs) {
      try {
        const audio = await speakWithElevenLabs(text, ELEVENLABS_API_KEY!, ELEVENLABS_VOICE_ID!);
        audioRef.current = audio;
        audio.onended = done;
        audio.onerror = () => { speakWithBrowserTTS(text); done(); };
        await audio.play();
      } catch {
        speakWithBrowserTTS(text);
        done();
      }
    } else {
      speakWithBrowserTTS(text);
      setTimeout(done, 3000);
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

  // ── Command listening (after wake word or click) ──
  const startCommandListening = useCallback(() => {
    if (!speechSupported) return;
    shouldListenRef.current = false; // stop wake word while in command mode

    // Stop wake listener
    if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} wakeRecognitionRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    speechSynthesis?.cancel();

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-GB';

    rec.onresult = (event: any) => {
      const result = event.results[0];
      if (result?.isFinal) processTranscript(result[0].transcript);
    };

    rec.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') {
        setState('idle');
      } else if (event.error === 'network') {
        setError('Speech recognition needs internet (Chrome sends audio to Google). Check your connection and try again.');
        setState('error');
        setTimeout(() => setState('idle'), 5000);
      } else if (event.error === 'not-allowed') {
        setError('Microphone blocked. Click the mic icon in Chrome\'s address bar and allow access.');
        setState('error');
        setTimeout(() => setState('idle'), 5000);
      } else {
        setError(`Mic error: ${event.error}`);
        setState('error');
        setTimeout(() => setState('idle'), 3000);
      }
      shouldListenRef.current = true;
    };

    rec.onend = () => { recognitionRef.current = null; };

    recognitionRef.current = rec;
    setState('listening');
    setTranscript(''); setResponse(''); setError('');
    setShowBubble(true);
    activateMic().then(() => rec.start());
  }, [speechSupported, processTranscript, activateMic]);

  // ── Wake word listener (opt-in — uses continuous mic which can exhaust Chrome's speech service) ──
  useEffect(() => {
    if (!enabled || !speechSupported || !wakeWordEnabled) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    let stopped = false;

    const startWakeListener = () => {
      if (stopped || !shouldListenRef.current) return;

      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-GB';

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript.toLowerCase().trim();
          if (WAKE_WORDS.some(w => text.includes(w))) {
            try { rec.abort(); } catch {}
            wakeRecognitionRef.current = null;

            // Check for command after wake word
            const afterWake = text.replace(/.*(?:hey lina|hey leena|hey lena|hey liner|a lina|eileen a)\s*/i, '').trim();
            if (afterWake.length > 3 && event.results[i].isFinal) {
              setState('processing');
              setTranscript(afterWake);
              setShowBubble(true);
              processTranscript(afterWake);
            } else {
              startCommandListening();
            }
            return;
          }
        }
      };

      rec.onerror = () => {
        wakeRecognitionRef.current = null;
        if (!stopped) setTimeout(startWakeListener, 5000); // longer delay to avoid rate limiting
      };

      rec.onend = () => {
        wakeRecognitionRef.current = null;
        if (!stopped && shouldListenRef.current) setTimeout(startWakeListener, 3000); // longer delay
      };

      wakeRecognitionRef.current = rec;
      setState(prev => prev === 'idle' || prev === 'wake-listening' ? 'wake-listening' : prev);
      activateMic().then(() => { try { rec.start(); } catch {} });
    };

    // Start after a short delay to avoid immediate mic permission prompt
    const timer = setTimeout(startWakeListener, 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} }
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (audioRef.current) audioRef.current.pause();
    };
  }, [enabled, wakeWordEnabled, speechSupported, activateMic, processTranscript, startCommandListening]);

  // ── Text input submit ──
  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    processTranscript(textInput.trim());
    setTextInput('');
    setShowInput(false);
  };

  // ── Manual click ──
  const handleClick = () => {
    if (state === 'listening') {
      if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
      setState('idle'); setShowBubble(false);
      shouldListenRef.current = true;
    } else if (state === 'speaking') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      speechSynthesis?.cancel();
      setState('idle'); setShowBubble(false);
      shouldListenRef.current = true;
    } else {
      // Show text input + try voice
      setShowInput(true);
      setShowBubble(true);
      startCommandListening();
    }
  };

  if (!enabled) return null;

  const isWake = state === 'wake-listening';

  return (
    <>
      <button
        className={`va-button ${isWake ? 'idle' : state}`}
        onClick={handleClick}
        aria-label={state === 'listening' ? 'Stop listening' : 'Talk to Lina'}
        title={isWake ? 'Say "Hey Lina" or click to talk' : state === 'listening' ? 'Listening... click to cancel' : wakeWordEnabled ? 'Say "Hey Lina" or click' : 'Click to talk to Lina'}
      >
        <span className="va-avatar">L</span>
        {isWake && <span className="va-ring wake" />}
        {state === 'listening' && <><span className="va-ring" /><span className="va-ring delay" /></>}
        {state === 'speaking' && <span className="va-ring speaking" />}
      </button>

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
          {(state === 'speaking' || ((state === 'idle' || isWake) && response)) && (
            <div className="va-bubble-text response">
              {transcript && <div className="va-you">You: {transcript}</div>}
              <div className="va-lina">Lina: {response}</div>
            </div>
          )}
          {state === 'error' && <div className="va-bubble-text error">{error}</div>}
          {/* Text input fallback — always available when bubble is open */}
          {(showInput || state === 'error') && state !== 'speaking' && state !== 'processing' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
              <input
                className="form-input"
                style={{ fontSize: 12, padding: '5px 8px', flex: 1 }}
                placeholder="Type a command..."
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleTextSubmit(); if (e.key === 'Escape') { setShowInput(false); setShowBubble(false); } }}
                autoFocus
              />
              <button className="btn btn-primary btn-sm" onClick={handleTextSubmit} disabled={!textInput.trim()} style={{ fontSize: 11 }}>Go</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
