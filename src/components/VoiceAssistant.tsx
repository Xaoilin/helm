import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { parseIntent, processWithLLM, isOllamaAvailable, type AssistantLang } from '../services/voiceAssistant';
import type { OllamaMessage } from '../services/ollamaApi';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, DEEPGRAM_API_KEY, OLLAMA_ENDPOINT } from '../config';
import { LIMITS, TIMING } from '../config/constants';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import { useWakeWord } from '../hooks/useWakeWord';
import { useVoiceInput } from '../hooks/useVoiceInput';
import type { PrayerTimesData } from '../services/prayerTimes';

type AssistantState = 'idle' | 'open' | 'listening' | 'processing' | 'speaking';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const chatHistoryRef = useRef<OllamaMessage[]>([]);
  const shouldListenRef = useRef(true);

  const enabled = app.settings.assistantEnabled !== false;
  const wakeWordEnabled = app.settings.wakeWordEnabled === true;
  const hasElevenLabs = !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);
  const deepgramKey = DEEPGRAM_API_KEY || app.settings.deepgramApiKey || '';
  const micDeviceId = app.settings.microphoneDeviceId;
  const lang: AssistantLang = app.settings.assistantLanguage || 'en';
  const isArabic = lang === 'ar';
  const sttLang = isArabic ? 'ar' : 'en-GB';
  const ollamaEndpoint = app.settings.ollamaEndpoint || OLLAMA_ENDPOINT;
  const ollamaModel = app.settings.ollamaModel || undefined;

  // ── Voice output hook ──
  const { speak: speakRaw, stopSpeaking, isSpeaking } = useVoiceOutput({
    hasElevenLabs,
    lang,
    elevenLabsApiKey: ELEVENLABS_API_KEY,
    elevenLabsVoiceId: ELEVENLABS_VOICE_ID,
  });

  // Wrap speak to integrate with component state machine
  const speak = useCallback(async (text: string) => {
    setState('speaking');
    setResponse(text);
    await speakRaw(text);
  }, [speakRaw]);

  // When speaking finishes, transition back to open
  useEffect(() => {
    if (!isSpeaking && state === 'speaking') {
      setState('open');
      shouldListenRef.current = true;
    }
  }, [isSpeaking, state]);

  // ── Process command (keyword-first, LLM-second) ──
  const processTranscript = useCallback(async (text: string) => {
    setState('processing');
    setTranscript(text);
    setError('');

    const prayerTimes = prayerData?.prayers.map(p => ({ name: p.name, time: p.time }));
    const context = {
      calendarEvents: app.calendarEvents,
      tasks: app.tasks,
      gamification: app.gamification,
      prayerTimes,
    };

    const intent = parseIntent(text, context, lang);

    if (intent.type !== 'unknown') {
      if (intent.type === 'navigate' && intent.surface) {
        app.navigate(intent.surface);
      }
      speak(intent.response);
      return;
    }

    const ollamaUp = await isOllamaAvailable(ollamaEndpoint);
    if (ollamaUp) {
      const llmIntent = await processWithLLM(
        text, context, lang,
        chatHistoryRef.current,
        ollamaEndpoint, ollamaModel,
      );

      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: 'user' as const, content: text },
        { role: 'assistant' as const, content: llmIntent.response },
      ].slice(-LIMITS.LLM_HISTORY_MESSAGES);

      if (llmIntent.action) {
        const a = llmIntent.action;
        if (a.type === 'navigate' && a.surface) {
          app.navigate(a.surface);
        } else if (a.type === 'add_task' && a.taskTitle) {
          const pri = ['low', 'medium', 'high'].includes(a.taskPriority || '') ? a.taskPriority as 'low' | 'medium' | 'high' : 'medium';
          const cat = ['daily', 'task', 'goal'].includes(a.taskCategory || '') ? a.taskCategory as 'daily' | 'task' | 'goal' : 'task';
          app.addTask({ title: a.taskTitle, description: '', completed: false, priority: pri, category: cat });
        } else if (a.type === 'complete_task' && a.taskTitle) {
          const match = app.tasks.find(t => !t.completed && t.title.toLowerCase().includes(a.taskTitle!.toLowerCase()));
          if (match) app.updateTask(match.id, { completed: true, completedAt: new Date().toISOString() });
        } else if (a.type === 'complete_habit' && a.taskTitle) {
          const match = app.tasks.find(t =>
            t.category === 'daily' && !t.completed &&
            t.title.toLowerCase().includes(a.taskTitle!.toLowerCase())
          );
          if (match) app.updateTask(match.id, { completed: true, completedAt: new Date().toISOString() });
        }
      }
      speak(llmIntent.response);
    } else {
      speak(intent.response);
    }
  }, [app, prayerData, speak, lang, ollamaEndpoint, ollamaModel]);

  // ── Voice input hook ──
  const { startListening, stopListening, isListening, voiceBackend } = useVoiceInput({
    enabled,
    deepgramKey,
    micDeviceId,
    sttLang,
    onTranscript: processTranscript,
    onListeningStart: useCallback(() => {
      setState('listening');
      setTranscript('');
      setResponse('');
      setError('');
      shouldListenRef.current = false;
    }, []),
    onError: useCallback((msg: string) => {
      setError(msg);
    }, []),
    onListeningEnd: useCallback(() => {
      setState('open');
      shouldListenRef.current = true;
    }, []),
    onProcessingStart: useCallback(() => {
      setState('processing');
      setTranscript('Processing audio...');
    }, []),
  });

  // ── Wake word hook ──
  useWakeWord({
    enabled,
    wakeWordEnabled,
    assistantIdle: state === 'idle',
    onWakeWordDetected: useCallback(() => {
      setState('open');
      setTranscript('');
      setResponse('');
      setError('');
      if (deepgramKey) {
        // Will start Deepgram listening via the startListening path
        startListening();
      }
    }, [deepgramKey, startListening]),
  });

  // Sync isListening state from hook to component state machine
  useEffect(() => {
    if (isListening && state !== 'listening') {
      setState('listening');
    }
  }, [isListening, state]);

  // ── Auto-focus text input when panel opens ──
  useEffect(() => {
    if (state === 'open' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), TIMING.INPUT_FOCUS_DELAY);
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
      stopSpeaking();
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

  // ── Keyboard shortcuts: Ctrl+Shift+L to open, Escape to close ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        if (state === 'idle') {
          setState('open');
          setTranscript('');
          setResponse('');
          setError('');
        } else {
          stopListening();
          stopSpeaking();
          setState('idle');
          setTranscript('');
          setResponse('');
          setError('');
          shouldListenRef.current = true;
        }
        return;
      }
      if (e.key === 'Escape' && state !== 'idle') {
        stopListening();
        stopSpeaking();
        setState('idle');
        setTranscript('');
        setResponse('');
        setError('');
        shouldListenRef.current = true;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state, stopListening, stopSpeaking]);

  if (!enabled) return null;

  const isOpen = state !== 'idle';
  const canVoice = voiceBackend !== 'none';

  return (
    <>
      <button
        className={`va-button ${state === 'listening' ? 'listening' : state === 'speaking' ? 'speaking' : ''}`}
        onClick={handleClick}
        aria-label={isOpen ? 'Close Lina' : 'Talk to Lina'}
        title={isOpen ? 'Close (Esc)' : 'Ask Lina anything (Ctrl+Shift+L)'}
      >
        <span className="va-avatar">{isOpen ? '\u00d7' : 'L'}</span>
        {state === 'listening' && <><span className="va-ring" /><span className="va-ring delay" /></>}
        {state === 'speaking' && <span className="va-ring speaking" />}
      </button>

      {isOpen && (
        <div className="va-bubble">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, direction: isArabic ? 'rtl' : 'ltr' }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: '#c4a0f7' }}>{'\u0644\u064a\u0646\u0627'}{!isArabic && ' Lina'}</span>
            <span style={{ fontSize: 11, color: '#6b6f85' }}>
              {state === 'listening'
                ? voiceBackend === 'deepgram'
                  ? isArabic ? '\uD83C\uDF99\uFE0F \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0633\u062C\u064A\u0644... \u0627\u0636\u063A\u0637 \u0625\u064A\u0642\u0627\u0641' : '\uD83C\uDF99\uFE0F Recording... click stop when done'
                  : isArabic ? '\uD83C\uDF99\uFE0F \u062C\u0627\u0631\u064A \u0627\u0644\u0627\u0633\u062A\u0645\u0627\u0639...' : '\uD83C\uDF99\uFE0F Listening...'
                : state === 'processing' ? isArabic ? '\uD83E\uDD14 \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0641\u0643\u064A\u0631...' : '\uD83E\uDD14 Thinking...'
                : state === 'speaking' ? isArabic ? '\uD83D\uDD0A \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u062F\u062B...' : '\uD83D\uDD0A Speaking...'
                : isArabic ? '\u0627\u0633\u0623\u0644\u0646\u064A \u0623\u064A \u0634\u064A\u0621' : 'Ask me anything'}
            </span>
          </div>

          {/* Conversation area */}
          {transcript && (
            <div className="va-you" style={{ marginBottom: 6, direction: isArabic ? 'rtl' : 'ltr' }}>{isArabic ? '\u0623\u0646\u062A' : 'You'}: {transcript}</div>
          )}
          {response && (
            <div className="va-lina" style={{ marginBottom: 10, direction: isArabic ? 'rtl' : 'ltr' }}>{response}</div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8, lineHeight: 1.4 }}>{error}</div>
          )}

          {/* Text input -- always visible when panel is open and not busy */}
          {state !== 'processing' && state !== 'speaking' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {state !== 'listening' && (
                <input
                  ref={inputRef}
                  className="form-input"
                  style={{ fontSize: 13, padding: '8px 10px', flex: 1, background: '#0f1117', border: '1px solid #2a2d40', borderRadius: 8, color: '#e1e4ea' }}
                  dir={isArabic ? 'rtl' : 'ltr'}
                  placeholder={isArabic
                    ? canVoice ? '\u0627\u0643\u062A\u0628 \u0623\u0648 \u0627\u0636\u063A\u0637 \uD83C\uDF99\uFE0F \u0644\u0644\u062A\u062D\u062F\u062B...' : '\u0627\u0643\u062A\u0628 \u0623\u0645\u0631\u0627\u064B...'
                    : canVoice ? 'Type or click \uD83C\uDF99\uFE0F to speak...' : 'Type a command...'}
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
                      ? isArabic ? '\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0633\u062C\u064A\u0644... \u062A\u062D\u062F\u062B \u062B\u0645 \u0627\u0636\u063A\u0637 \u23F9\uFE0F' : 'Recording... speak then click \u23F9\uFE0F'
                      : isArabic ? '\u062C\u0627\u0631\u064A \u0627\u0644\u0627\u0633\u062A\u0645\u0627\u0639...' : 'Listening...'}
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
                  {'\uD83C\uDF99\uFE0F'}
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
                  {'\u23F9\uFE0F'}
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
                  {'\u2192'}
                </button>
              )}
            </div>
          )}

          {/* Quick command hints */}
          {!transcript && !response && state === 'open' && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, direction: isArabic ? 'rtl' : 'ltr' }}>
              {(isArabic
                ? ['\u0627\u0644\u0627\u062C\u062A\u0645\u0627\u0639 \u0627\u0644\u0642\u0627\u062F\u0645', '\u0643\u0645 \u0645\u0647\u0645\u0629', '\u0623\u0648\u0642\u0627\u062A \u0627\u0644\u0635\u0644\u0627\u0629', '\u0627\u0641\u062A\u062D \u0627\u0644\u062A\u0642\u0648\u064A\u0645', '\u0633\u0644\u0633\u0644\u0629']
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
              {voiceBackend === 'deepgram' ? '\uD83D\uDFE2 Voice: Deepgram' :
               voiceBackend === 'chrome' ? '\uD83D\uDFE1 Voice: Chrome (may be unreliable)' :
               '\uD83D\uDD34 Voice off \u2014 add Deepgram key in Settings'}
            </div>
          )}
        </div>
      )}
    </>
  );
}
