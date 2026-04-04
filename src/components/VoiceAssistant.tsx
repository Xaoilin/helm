import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { parseIntent, speakWithElevenLabs, speakWithBrowserTTS, type AssistantLang } from '../services/voiceAssistant';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, DEEPGRAM_API_KEY } from '../config';
import { createRecorder, transcribeWithDeepgram, testChromeSpeechRecognition } from '../services/deepgramSTT';
import type { PrayerTimesData } from '../services/prayerTimes';

/* eslint-disable @typescript-eslint/no-explicit-any */

type AssistantState = 'idle' | 'open' | 'listening' | 'processing' | 'speaking';
type VoiceBackend = 'deepgram' | 'chrome' | 'none';

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
  const [voiceBackend, setVoiceBackend] = useState<VoiceBackend>('none');
  const [backendChecked, setBackendChecked] = useState(false);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = app.settings.assistantEnabled !== false;
  const wakeWordEnabled = app.settings.wakeWordEnabled === true;
  const hasElevenLabs = !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
  const deepgramKey = DEEPGRAM_API_KEY || app.settings.deepgramApiKey || '';
  const micDeviceId = app.settings.microphoneDeviceId;
  const lang: AssistantLang = app.settings.assistantLanguage || 'en';
  const isArabic = lang === 'ar';
  const sttLang = isArabic ? 'ar' : 'en-GB';

  // ── Detect best voice backend on mount ──
  useEffect(() => {
    if (!enabled || backendChecked) return;

    if (deepgramKey) {
      setVoiceBackend('deepgram');
      setBackendChecked(true);
      return;
    }

    // Test Chrome's SpeechRecognition
    testChromeSpeechRecognition().then(works => {
      setVoiceBackend(works ? 'chrome' : 'none');
      setBackendChecked(true);
    });
  }, [enabled, deepgramKey, backendChecked]);

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
        audio.onerror = () => { speakWithBrowserTTS(text, lang); done(); };
        await audio.play();
      } catch {
        speakWithBrowserTTS(text, lang);
        done();
      }
    } else {
      speakWithBrowserTTS(text, lang);
      setTimeout(done, 3000);
    }
  }, [hasElevenLabs]);

  // ── Process command ──
  const processTranscript = useCallback((text: string) => {
    setState('processing');
    setTranscript(text);
    setError('');

    const prayerTimes = prayerData?.prayers.map(p => ({ name: p.name, time: p.time }));
    const intent = parseIntent(text, {
      calendarEvents: app.calendarEvents,
      tasks: app.tasks,
      gamification: app.gamification,
      prayerTimes,
    }, lang);

    if (intent.type === 'navigate' && intent.surface) {
      app.navigate(intent.surface);
    }

    speak(intent.response);
  }, [app, prayerData, speak]);

  // ── Deepgram voice listening ──
  const startDeepgramListening = useCallback(async () => {
    setState('listening');
    setTranscript('');
    setResponse('');
    setError('');

    try {
      const recorder = createRecorder(micDeviceId);
      recorderRef.current = recorder;
      await recorder.start();

      // Auto-stop after 8 seconds
      setTimeout(() => {
        if (recorder.isRecording()) {
          recorder.stop();
        }
      }, 8000);
    } catch (e: any) {
      setError(e.message?.includes('Permission') || e.message?.includes('NotAllowed')
        ? 'Microphone blocked. Click 🔒 in Chrome\'s address bar to allow.'
        : `Mic error: ${e.message}`);
      setState('open');
    }
  }, [micDeviceId]);

  const stopDeepgramAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (recorder.isRecording()) {
      recorder.stop();
    }

    setState('processing');
    setTranscript('Processing audio...');

    try {
      const blob = await recorder.getBlob();
      if (blob.size < 500) {
        setError('No speech detected. Try again or type your command.');
        setState('open');
        setTranscript('');
        return;
      }

      const result = await transcribeWithDeepgram(blob, deepgramKey, sttLang);

      if (!result.transcript || result.transcript.trim() === '') {
        setError('Couldn\'t make out what you said. Try again or type your command.');
        setState('open');
        setTranscript('');
        return;
      }

      processTranscript(result.transcript);
    } catch (e: any) {
      setError(e.message || 'Transcription failed');
      setState('open');
      setTranscript('');
    }
    recorderRef.current = null;
  }, [deepgramKey, processTranscript]);

  // ── Chrome SpeechRecognition voice listening (fallback) ──
  const startChromeListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    shouldListenRef.current = false;
    if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} wakeRecognitionRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    speechSynthesis?.cancel();

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = sttLang;

    rec.onresult = (event: any) => {
      const result = event.results[0];
      if (result?.isFinal) processTranscript(result[0].transcript);
    };

    rec.onerror = (event: any) => {
      recognitionRef.current = null;
      shouldListenRef.current = true;

      if (event.error === 'no-speech' || event.error === 'aborted') {
        setState('open');
      } else if (event.error === 'network') {
        setVoiceBackend('none');
        setError('Chrome voice unavailable — get a free Deepgram API key at deepgram.com and paste it in Settings → Voice Assistant.');
        setState('open');
      } else if (event.error === 'not-allowed') {
        setError('Microphone blocked. Click 🔒 in Chrome\'s address bar to allow.');
        setState('open');
      } else {
        setError(`Mic error: ${event.error}`);
        setState('open');
      }
    };

    rec.onend = () => { recognitionRef.current = null; };

    recognitionRef.current = rec;
    setState('listening');
    setTranscript(''); setResponse(''); setError('');
    rec.start();
  }, [processTranscript]);

  // ── Unified start listening ──
  const startListening = useCallback(() => {
    if (voiceBackend === 'deepgram') {
      startDeepgramListening();
    } else if (voiceBackend === 'chrome') {
      startChromeListening();
    } else {
      setError('Voice not available. Add a Deepgram API key in Settings → Voice Assistant to enable voice input.');
      setState('open');
    }
  }, [voiceBackend, startDeepgramListening, startChromeListening]);

  // ── Unified stop listening ──
  const stopListening = useCallback(() => {
    if (voiceBackend === 'deepgram' && recorderRef.current) {
      stopDeepgramAndTranscribe();
    } else if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setState('open');
      shouldListenRef.current = true;
    }
  }, [voiceBackend, stopDeepgramAndTranscribe]);

  // ── Wake word listener (Chrome SpeechRecognition only, opt-in) ──
  useEffect(() => {
    if (!enabled || !wakeWordEnabled || voiceBackend !== 'chrome') return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    let stopped = false;

    const startWakeListener = () => {
      if (stopped || !shouldListenRef.current) return;

      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = sttLang;

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
              startListening();
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
      try { rec.start(); } catch {}
    };

    const timer = setTimeout(startWakeListener, 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wakeRecognitionRef.current) { try { wakeRecognitionRef.current.abort(); } catch {} }
    };
  }, [enabled, wakeWordEnabled, voiceBackend, processTranscript, startListening]);

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
      stopListening();
    } else if (state === 'speaking') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      speechSynthesis?.cancel();
      setState('open');
      shouldListenRef.current = true;
    } else if (state === 'open' && !transcript && !response) {
      setState('idle');
    } else {
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
        if (recorderRef.current?.isRecording()) { recorderRef.current.stop(); }
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
  const canVoice = voiceBackend !== 'none';

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, direction: isArabic ? 'rtl' : 'ltr' }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#c4a0f7' }}>لينا{!isArabic && ' Lina'}</span>
            <span style={{ fontSize: 11, color: '#6b6f85' }}>
              {state === 'listening'
                ? voiceBackend === 'deepgram'
                  ? isArabic ? '🎙️ جاري التسجيل... اضغط إيقاف' : '🎙️ Recording... click stop when done'
                  : isArabic ? '🎙️ جاري الاستماع...' : '🎙️ Listening...'
                : state === 'processing' ? isArabic ? '🤔 جاري التفكير...' : '🤔 Thinking...'
                : state === 'speaking' ? isArabic ? '🔊 جاري التحدث...' : '🔊 Speaking...'
                : isArabic ? 'اسألني أي شيء' : 'Ask me anything'}
            </span>
          </div>

          {/* Conversation area */}
          {transcript && (
            <div className="va-you" style={{ marginBottom: 6, direction: isArabic ? 'rtl' : 'ltr' }}>{isArabic ? 'أنت' : 'You'}: {transcript}</div>
          )}
          {response && (
            <div className="va-lina" style={{ marginBottom: 10, direction: isArabic ? 'rtl' : 'ltr' }}>{response}</div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8, lineHeight: 1.4 }}>{error}</div>
          )}

          {/* Text input — always visible when panel is open and not busy */}
          {state !== 'processing' && state !== 'speaking' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {state !== 'listening' && (
                <input
                  ref={inputRef}
                  className="form-input"
                  style={{ fontSize: 13, padding: '8px 10px', flex: 1, background: '#0f1117', border: '1px solid #2a2d40', borderRadius: 8, color: '#e1e4ea' }}
                  dir={isArabic ? 'rtl' : 'ltr'}
                  placeholder={isArabic
                    ? canVoice ? 'اكتب أو اضغط 🎙️ للتحدث...' : 'اكتب أمراً...'
                    : canVoice ? 'Type or click 🎙️ to speak...' : 'Type a command...'}
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleTextSubmit();
                    if (e.key === 'Escape') { setState('idle'); setTranscript(''); setResponse(''); setError(''); }
                  }}
                />
              )}
              {state === 'listening' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 8 }}>
                  <span className="va-dots"><span /><span /><span /></span>
                  <span style={{ fontSize: 12, color: '#22c55e' }}>
                    {voiceBackend === 'deepgram'
                      ? isArabic ? 'جاري التسجيل... تحدث ثم اضغط ⏹️' : 'Recording... speak then click ⏹️'
                      : isArabic ? 'جاري الاستماع...' : 'Listening...'}
                  </span>
                </div>
              )}
              {/* Mic / Stop button */}
              {canVoice && state !== 'listening' && (
                <button
                  onClick={(e) => { e.stopPropagation(); startListening(); }}
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
                  title={voiceBackend === 'deepgram' ? 'Record voice (Deepgram)' : 'Speak your command'}
                >
                  🎙️
                </button>
              )}
              {state === 'listening' && (
                <button
                  onClick={(e) => { e.stopPropagation(); stopListening(); }}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    border: '1px solid #22c55e', background: 'rgba(34, 197, 94, 0.15)',
                    cursor: 'pointer', fontSize: 14, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#22c55e',
                  }}
                  aria-label="Stop recording"
                  title="Stop and transcribe"
                >
                  ⏹️
                </button>
              )}
              {state !== 'listening' && (
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
              )}
            </div>
          )}

          {/* Quick command hints */}
          {!transcript && !response && state === 'open' && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, direction: isArabic ? 'rtl' : 'ltr' }}>
              {(isArabic
                ? ['الاجتماع القادم', 'كم مهمة', 'أوقات الصلاة', 'افتح التقويم', 'سلسلة']
                : ['next meeting', 'tasks left', 'prayer times', 'open calendar', 'my streak']
              ).map(cmd => (
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

          {/* Voice backend indicator */}
          {state === 'open' && !transcript && !response && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#4a4e63' }}>
              {voiceBackend === 'deepgram' ? '🟢 Voice: Deepgram' :
               voiceBackend === 'chrome' ? '🟡 Voice: Chrome (may be unreliable)' :
               '🔴 Voice off — add Deepgram key in Settings'}
            </div>
          )}
        </div>
      )}
    </>
  );
}
