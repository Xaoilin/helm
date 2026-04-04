import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { parseIntent, speakWithElevenLabs, speakWithBrowserTTS } from '../services/voiceAssistant';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from '../config';
import type { PrayerTimesData } from '../services/prayerTimes';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistantState = 'idle' | 'open' | 'listening' | 'processing' | 'speaking' | 'error';

const WAKE_WORDS = ['hey lina', 'hey leena', 'hey lena', 'hey liner', 'a lina', 'eileen a'];

interface Props {
  prayerData?: PrayerTimesData | null;
}

export default function VoiceAssistant({ prayerData }: Props) {
  const app = useApp();
  const [state, setState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');
  const [voiceFailed, setVoiceFailed] = useState(false);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = app.settings.assistantEnabled !== false;
  const wakeWordEnabled = app.settings.wakeWordEnabled === true;
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

    const done = () => {
      setState('open');
      shouldListenRef.current = true;
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

  // ── Voice listening (mic button) ──
  const startVoiceListening = useCallback(() => {
    if (!speechSupported) {
      setVoiceFailed(true);
      setError('Voice not supported in this browser. Use text input instead.');
      return;
    }
    shouldListenRef.current = false;

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
      if (result?.isFinal) {
        const text = result[0].transcript;
        setTextInput(''); // clear any typed text
        processTranscript(text);
      }
    };

    rec.onerror = (event: any) => {
      recognitionRef.current = null;
      shouldListenRef.current = true;

      if (event.error === 'no-speech' || event.error === 'aborted') {
        setState('open');
      } else if (event.error === 'network') {
        setVoiceFailed(true);
        setError('Voice unavailable — Chrome can\'t reach speech servers. Use text input below.');
        setState('open');
      } else if (event.error === 'not-allowed') {
        setVoiceFailed(true);
        setError('Microphone blocked. Click the 🔒 icon in Chrome\'s address bar to allow mic access.');
        setState('open');
      } else {
        setError(`Mic error: ${event.error}. Use text input instead.`);
        setState('open');
      }
    };

    rec.onend = () => { recognitionRef.current = null; };

    recognitionRef.current = rec;
    setState('listening');
    setTranscript(''); setResponse(''); setError('');
    activateMic().then(() => rec.start());
  }, [speechSupported, processTranscript, activateMic]);

  // ── Wake word listener (opt-in) ──
  useEffect(() => {
    if (!enabled || !speechSupported || !wakeWordEnabled || voiceFailed) return;

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

            const afterWake = text.replace(/.*(?:hey lina|hey leena|hey lena|hey liner|a lina|eileen a)\s*/i, '').trim();
            if (afterWake.length > 3 && event.results[i].isFinal) {
              setState('processing');
              setTranscript(afterWake);
              processTranscript(afterWake);
            } else {
              startVoiceListening();
            }
            return;
          }
        }
      };

      rec.onerror = () => {
        wakeRecognitionRef.current = null;
        if (!stopped) setTimeout(startWakeListener, 5000);
      };

      rec.onend = () => {
        wakeRecognitionRef.current = null;
        if (!stopped && shouldListenRef.current) setTimeout(startWakeListener, 3000);
      };

      wakeRecognitionRef.current = rec;
      activateMic().then(() => { try { rec.start(); } catch {} });
    };

    const timer = setTimeout(startWakeListener, 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} }
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} }
      if (audioRef.current) audioRef.current.pause();
    };
  }, [enabled, wakeWordEnabled, speechSupported, voiceFailed, activateMic, processTranscript, startVoiceListening]);

  // ── Auto-focus text input when panel opens ──
  useEffect(() => {
    if (state === 'open' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state]);

  // ── Text input submit ──
  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    processTranscript(textInput.trim());
    setTextInput('');
  };

  // ── Toggle panel open/close ──
  const handleClick = () => {
    if (state === 'idle') {
      setState('open');
      setTranscript('');
      setResponse('');
      setError('');
    } else if (state === 'listening') {
      if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
      setState('open');
      shouldListenRef.current = true;
    } else if (state === 'speaking') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      speechSynthesis?.cancel();
      setState('open');
      shouldListenRef.current = true;
    } else if (state === 'open' && !transcript && !response) {
      // Close if nothing is shown
      setState('idle');
    } else {
      // Re-open for new command
      setState('open');
      setTranscript('');
      setResponse('');
      setError('');
    }
  };

  // ── Close on Escape ──
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state !== 'idle') {
        if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
        if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
        speechSynthesis?.cancel();
        setState('idle');
        setTranscript('');
        setResponse('');
        setError('');
        shouldListenRef.current = true;
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [state]);

  if (!enabled) return null;

  const isOpen = state !== 'idle';

  return (
    <>
      <button
        className={`va-button ${state === 'listening' ? 'listening' : state === 'speaking' ? 'speaking' : ''}`}
        onClick={handleClick}
        aria-label={isOpen ? 'Close Lina' : 'Talk to Lina'}
        title={isOpen ? 'Close (Esc)' : 'Ask Lina anything'}
      >
        <span className="va-avatar">{isOpen ? '×' : 'L'}</span>
        {state === 'listening' && <><span className="va-ring" /><span className="va-ring delay" /></>}
        {state === 'speaking' && <span className="va-ring speaking" />}
      </button>

      {isOpen && (
        <div className="va-bubble">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#c4a0f7' }}>Lina</span>
            <span style={{ fontSize: 11, color: '#6b6f85' }}>
              {state === 'listening' ? '🎙️ Listening...' :
               state === 'processing' ? '🤔 Thinking...' :
               state === 'speaking' ? '🔊 Speaking...' :
               'Ask me anything'}
            </span>
          </div>

          {/* Conversation area */}
          {transcript && (
            <div className="va-you" style={{ marginBottom: 6 }}>You: {transcript}</div>
          )}
          {response && (
            <div className="va-lina" style={{ marginBottom: 10 }}>{response}</div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8, lineHeight: 1.4 }}>{error}</div>
          )}

          {/* Text input — always visible when panel is open */}
          {state !== 'processing' && state !== 'speaking' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                ref={inputRef}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 10px', flex: 1, background: '#0f1117', border: '1px solid #2a2d40', borderRadius: 8, color: '#e1e4ea' }}
                placeholder={voiceFailed ? 'Type a command...' : 'Type or click 🎙️ to speak...'}
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleTextSubmit();
                  if (e.key === 'Escape') { setState('idle'); setTranscript(''); setResponse(''); setError(''); }
                }}
              />
              {/* Mic button — only show if voice hasn't permanently failed */}
              {!voiceFailed && speechSupported && state !== 'listening' && (
                <button
                  onClick={(e) => { e.stopPropagation(); startVoiceListening(); }}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    border: '1px solid #2a2d40', background: '#0f1117',
                    cursor: 'pointer', fontSize: 16, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#8b8fa3', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1a1d2e'; e.currentTarget.style.borderColor = '#4f5bff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#0f1117'; e.currentTarget.style.borderColor = '#2a2d40'; }}
                  aria-label="Use voice input"
                  title="Speak your command"
                >
                  🎙️
                </button>
              )}
              {state === 'listening' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (recognitionRef.current) { recognitionRef.current.abort(); recognitionRef.current = null; }
                    setState('open');
                    shouldListenRef.current = true;
                  }}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    border: '1px solid #22c55e', background: 'rgba(34, 197, 94, 0.15)',
                    cursor: 'pointer', fontSize: 14, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#22c55e', animation: 'vaDotBounce 1.2s ease-in-out infinite',
                  }}
                  aria-label="Stop listening"
                  title="Stop listening"
                >
                  ⏹️
                </button>
              )}
              <button
                onClick={handleTextSubmit}
                disabled={!textInput.trim()}
                style={{
                  width: 36, height: 36, borderRadius: 8,
                  border: 'none',
                  background: textInput.trim() ? 'linear-gradient(135deg, #4f5bff, #7c3aed)' : '#1a1d2e',
                  cursor: textInput.trim() ? 'pointer' : 'default',
                  fontSize: 14, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: textInput.trim() ? '#fff' : '#4a4e63',
                  transition: 'all 0.15s',
                }}
                aria-label="Send command"
                title="Send"
              >
                →
              </button>
            </div>
          )}

          {/* Quick command hints */}
          {!transcript && !response && state === 'open' && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {['next meeting', 'tasks left', 'prayer times', 'open calendar', 'my streak'].map(cmd => (
                <button
                  key={cmd}
                  onClick={() => { setTextInput(''); processTranscript(cmd); }}
                  style={{
                    padding: '4px 10px', borderRadius: 12,
                    border: '1px solid #2a2d40', background: '#13151c',
                    color: '#8b8fa3', fontSize: 11, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#4f5bff'; e.currentTarget.style.color = '#c4a0f7'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d40'; e.currentTarget.style.color = '#8b8fa3'; }}
                >
                  {cmd}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
