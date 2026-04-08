import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, DEEPGRAM_API_KEY, OLLAMA_ENDPOINT } from '../config';
import { TIMING } from '../config/constants';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import { useWakeWord } from '../hooks/useWakeWord';
import { useVoiceInput } from '../hooks/useVoiceInput';
import type { PrayerTimesData } from '../services/prayerTimes';
import { processAssistantCommand } from '../services/assistantRuntime';
import type { AssistantConversationMessage, AssistantDialogState, AssistantLang } from '../services/assistantTypes';

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
  const chatHistoryRef = useRef<AssistantConversationMessage[]>([]);
  const dialogStateRef = useRef<AssistantDialogState>({
    currentSurface: app.surface,
    recentEntities: [],
    recentPlans: [],
  });

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

  const { speak: speakRaw, stopSpeaking } = useVoiceOutput({
    hasElevenLabs,
    lang,
    elevenLabsApiKey: ELEVENLABS_API_KEY,
    elevenLabsVoiceId: ELEVENLABS_VOICE_ID,
  });

  const speak = useCallback(async (text: string) => {
    setState('speaking');
    setResponse(text);
    await speakRaw(text);
    setState('open');
  }, [speakRaw]);

  const processTranscript = useCallback(async (text: string) => {
    setState('processing');
    setTranscript(text);
    setError('');

    const prayerTimes = prayerData?.prayers.map(prayer => ({ name: prayer.name, time: prayer.time }));
    const result = await processAssistantCommand(text, {
      calendarAccounts: app.calendarAccounts,
      calendarSources: app.calendarSources,
      calendarEvents: app.calendarEvents,
      tasks: app.tasks,
      financeAccounts: app.financeAccounts,
      transactions: app.transactions,
      knowledgeEntries: app.knowledgeEntries,
      knowledgeTopics: app.knowledgeTopics,
      lifestyleItems: app.lifestyleItems,
      workspaces: app.workspaces,
      gamification: app.gamification,
      goalTags: app.settings.goalTags,
      prayerTimes,
      currentSurface: app.surface,
    }, {
      lang,
      conversationHistory: chatHistoryRef.current,
      dialogState: dialogStateRef.current,
      provider: app.settings.assistantProvider,
      endpoint: ollamaEndpoint,
      model: ollamaModel,
      handlers: {
        navigate: app.navigate,
        addTask: app.addTask,
        updateTask: app.updateTask,
        addCalendarEvent: app.addCalendarEvent,
        updateCalendarEvent: app.updateCalendarEvent,
        addTransaction: app.addTransaction,
        addKnowledgeEntry: app.addKnowledgeEntry,
        updateGamification: app.updateGamification,
      },
    });

    dialogStateRef.current = result.dialogState;

    chatHistoryRef.current = [
      ...chatHistoryRef.current,
      { role: 'user' as const, content: text },
      { role: 'assistant' as const, content: result.message },
    ].slice(-10);

    await speak(result.message);
  }, [app, lang, ollamaEndpoint, ollamaModel, prayerData, speak]);

  const { startListening, stopListening, voiceBackend } = useVoiceInput({
    enabled,
    deepgramKey,
    micDeviceId,
    sttLang,
    onTranscript: processTranscript,
    onTranscriptPreview: useCallback((text: string) => {
      setTranscript(text);
    }, []),
    onListeningStart: useCallback(() => {
      setState('listening');
      setTranscript('');
      setResponse('');
      setError('');
    }, []),
    onError: useCallback((message: string) => {
      setError(message);
    }, []),
    onListeningEnd: useCallback(() => {
      setState('open');
    }, []),
    onProcessingStart: useCallback(() => {
      setState('processing');
      setTranscript(currentTranscript => currentTranscript || 'Processing audio...');
    }, []),
  });

  useWakeWord({
    enabled,
    wakeWordEnabled,
    loaded: app.loaded,
    assistantIdle: state === 'idle',
    onWakeWordDetected: useCallback(() => {
      setState('open');
      setTranscript('');
      setResponse('');
      setError('');
      if (deepgramKey) {
        startListening();
      }
    }, [deepgramKey, startListening]),
  });

  useEffect(() => {
    if (state === 'open' && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), TIMING.INPUT_FOCUS_DELAY);
    }
  }, [state]);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    void processTranscript(textInput.trim());
    setTextInput('');
  };

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
    } else if (state === 'open' && !transcript && !response) {
      setState('idle');
    } else {
      setState('open');
      setTranscript('');
      setResponse('');
      setError('');
    }
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'L') {
        event.preventDefault();
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
        }
        return;
      }

      if (event.key === 'Escape' && state !== 'idle') {
        stopListening();
        stopSpeaking();
        setState('idle');
        setTranscript('');
        setResponse('');
        setError('');
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

          {transcript && (
            <div className="va-you" style={{ marginBottom: 6, direction: isArabic ? 'rtl' : 'ltr' }}>{isArabic ? '\u0623\u0646\u062A' : 'You'}: {transcript}</div>
          )}
          {response && (
            <div className="va-lina" style={{ marginBottom: 10, direction: isArabic ? 'rtl' : 'ltr' }}>{response}</div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#ff6b6b', marginBottom: 8, lineHeight: 1.4 }}>{error}</div>
          )}

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
                  onChange={event => setTextInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleTextSubmit();
                    if (event.key === 'Escape') { setState('idle'); setTranscript(''); setResponse(''); setError(''); }
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
              {canVoice && state !== 'listening' && (
                <button
                  onClick={(event) => { event.stopPropagation(); startListening(); }}
                  style={{
                    width: 36, height: 36, borderRadius: 8,
                    border: '1px solid #2a2d40', background: '#0f1117',
                    cursor: 'pointer', fontSize: 16, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#8b8fa3', transition: 'all 0.15s',
                  }}
                  onMouseEnter={event => { event.currentTarget.style.background = '#1a1d2e'; event.currentTarget.style.borderColor = '#4f5bff'; }}
                  onMouseLeave={event => { event.currentTarget.style.background = '#0f1117'; event.currentTarget.style.borderColor = '#2a2d40'; }}
                  aria-label="Use voice input"
                  title={voiceBackend === 'deepgram' ? 'Record voice (Deepgram)' : 'Speak your command'}
                >
                  {'\uD83C\uDF99\uFE0F'}
                </button>
              )}
              {state === 'listening' && (
                <button
                  onClick={(event) => { event.stopPropagation(); stopListening(); }}
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

          {!transcript && !response && state === 'open' && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, direction: isArabic ? 'rtl' : 'ltr' }}>
              {(isArabic
                ? ['\u0627\u0644\u0627\u062C\u062A\u0645\u0627\u0639 \u0627\u0644\u0642\u0627\u062F\u0645', '\u0643\u0645 \u0645\u0647\u0645\u0629', '\u0623\u0648\u0642\u0627\u062A \u0627\u0644\u0635\u0644\u0627\u0629', '\u0627\u0641\u062A\u062D \u0627\u0644\u062A\u0642\u0648\u064A\u0645', '\u0633\u0644\u0633\u0644\u0629']
                : ['next meeting', 'tasks left', 'prayer times', 'open calendar', 'my streak']
              ).map(command => (
                <button
                  key={command}
                  onClick={() => { setTextInput(''); void processTranscript(command); }}
                  style={{
                    padding: '4px 10px', borderRadius: 12,
                    border: '1px solid #2a2d40', background: '#13151c',
                    color: '#8b8fa3', fontSize: 11, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={event => { event.currentTarget.style.borderColor = '#4f5bff'; event.currentTarget.style.color = '#c4a0f7'; }}
                  onMouseLeave={event => { event.currentTarget.style.borderColor = '#2a2d40'; event.currentTarget.style.color = '#8b8fa3'; }}
                >
                  {command}
                </button>
              ))}
            </div>
          )}

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
