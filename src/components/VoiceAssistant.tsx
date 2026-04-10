import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, DEEPGRAM_API_KEY, OLLAMA_ENDPOINT } from '../config';
import { TIMING, VOICE_SESSION } from '../config/constants';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import { useWakeWord } from '../hooks/useWakeWord';
import { useVoiceInput } from '../hooks/useVoiceInput';
import type { PrayerTimesData } from '../services/prayerTimes';
import { processAssistantCommand } from '../services/assistantRuntime';
import type { AssistantConversationMessage, AssistantDialogState, AssistantLang } from '../services/assistantTypes';
import { logError } from '../services/logger';

type AssistantState = 'idle' | 'open' | 'listening' | 'processing' | 'speaking';
type VoiceSessionMode = 'manual' | 'handsfree';
type InputMode = 'voice' | 'text';
type ListeningMode = 'initial' | 'followup';

interface Props {
  prayerData?: PrayerTimesData | null;
}

function normaliseVoicePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?؟،]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVoiceStopPhrase(text: string, lang: AssistantLang): boolean {
  const normalized = normaliseVoicePhrase(text);
  return VOICE_SESSION.STOP_PHRASES[lang].some(phrase => normalized.includes(phrase));
}

export default function VoiceAssistant({ prayerData }: Props) {
  const app = useApp();
  const [state, setState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [textInput, setTextInput] = useState('');
  const [voiceSessionMode, setVoiceSessionModeState] = useState<VoiceSessionMode>('manual');
  const [listeningMode, setListeningMode] = useState<ListeningMode>('initial');
  const inputRef = useRef<HTMLInputElement>(null);
  const chatHistoryRef = useRef<AssistantConversationMessage[]>([]);
  const dialogStateRef = useRef<AssistantDialogState>({
    currentSurface: app.surface,
    recentEntities: [],
    recentPlans: [],
  });
  const sessionIdRef = useRef(0);
  const voiceSessionModeRef = useRef<VoiceSessionMode>('manual');
  const handsFreeSessionActiveRef = useRef(false);
  const preserveResponseOnNextListeningRef = useRef(false);
  const nextListeningTimerRef = useRef<number | null>(null);
  const processTranscriptRef = useRef<(text: string, inputMode: InputMode) => Promise<void>>(async () => {});

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

  const setVoiceSessionMode = useCallback((mode: VoiceSessionMode) => {
    voiceSessionModeRef.current = mode;
    setVoiceSessionModeState(mode);
  }, []);

  const clearScheduledListening = useCallback(() => {
    if (nextListeningTimerRef.current !== null) {
      window.clearTimeout(nextListeningTimerRef.current);
      nextListeningTimerRef.current = null;
    }
  }, []);

  const clearAssistantUi = useCallback((options: { preserveResponse?: boolean } = {}) => {
    setTranscript('');
    if (!options.preserveResponse) {
      setResponse('');
    }
    setError('');
  }, []);

  const { speak: speakRaw, stopSpeaking } = useVoiceOutput({
    hasElevenLabs,
    lang,
    elevenLabsApiKey: ELEVENLABS_API_KEY,
    elevenLabsVoiceId: ELEVENLABS_VOICE_ID,
  });

  const {
    startListening,
    stopListening,
    cancelListening,
    voiceBackend,
  } = useVoiceInput({
    enabled,
    deepgramKey,
    micDeviceId,
    sttLang,
    onTranscript: useCallback((text: string) => {
      void processTranscriptRef.current(text, 'voice');
    }, []),
    onTranscriptPreview: useCallback((text: string) => {
      setTranscript(text);
    }, []),
    onListeningStart: useCallback(() => {
      setState('listening');
      setTranscript('');
      if (!preserveResponseOnNextListeningRef.current) {
        setResponse('');
      }
      setError('');
      preserveResponseOnNextListeningRef.current = false;
    }, []),
    onError: useCallback((message: string) => {
      setError(message);
      if (handsFreeSessionActiveRef.current) {
        handsFreeSessionActiveRef.current = false;
        setVoiceSessionMode('manual');
        setListeningMode('initial');
        clearScheduledListening();
      }
      setState('open');
    }, [clearScheduledListening, setVoiceSessionMode]),
    onListeningEnd: useCallback(() => {
      setState(current => current === 'processing' ? current : 'open');
    }, []),
    onNoSpeech: useCallback(() => {
      if (handsFreeSessionActiveRef.current) {
        sessionIdRef.current += 1;
        handsFreeSessionActiveRef.current = false;
        setVoiceSessionMode('manual');
        setListeningMode('initial');
        clearScheduledListening();
        setState('idle');
        setTranscript('');
        setResponse('');
        setError('');
        return;
      }

      setError('No speech detected. Try again or type your command.');
      setState('open');
    }, [clearScheduledListening, setVoiceSessionMode]),
    onProcessingStart: useCallback(() => {
      setState('processing');
      setTranscript(currentTranscript => currentTranscript || 'Processing audio...');
    }, []),
  });

  const speakMessage = useCallback(async (text: string, sessionId?: number) => {
    setState('speaking');
    setResponse(text);
    await speakRaw(text);

    if (sessionId !== undefined && sessionIdRef.current !== sessionId) {
      return false;
    }

    setState('open');
    return true;
  }, [speakRaw]);

  const endHandsFreeSession = useCallback(async (options: { closingMessage?: string } = {}) => {
    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    handsFreeSessionActiveRef.current = false;
    setVoiceSessionMode('manual');
    setListeningMode('initial');
    clearScheduledListening();
    cancelListening();

    if (options.closingMessage) {
      setState('speaking');
      setResponse(options.closingMessage);
      await speakRaw(options.closingMessage);
      if (sessionIdRef.current !== sessionId) {
        return;
      }
    }

    setState('idle');
    setTranscript('');
    setResponse('');
    setError('');
  }, [cancelListening, clearScheduledListening, setVoiceSessionMode, speakRaw]);

  const scheduleHandsFreeListening = useCallback((mode: ListeningMode, sessionId: number) => {
    if (voiceBackend === 'none') {
      handsFreeSessionActiveRef.current = false;
      setVoiceSessionMode('manual');
      setListeningMode('initial');
      setState('open');
      setError('Voice input is unavailable. Add a Deepgram key in Settings → Voice Assistant to use hands-free mode.');
      return;
    }

    clearScheduledListening();
    setListeningMode(mode);
    preserveResponseOnNextListeningRef.current = true;

    nextListeningTimerRef.current = window.setTimeout(() => {
      if (sessionIdRef.current !== sessionId || !handsFreeSessionActiveRef.current) {
        return;
      }

      startListening();
    }, TIMING.VOICE_SESSION_RESUME_DELAY);
  }, [clearScheduledListening, setVoiceSessionMode, startListening, voiceBackend]);

  const openAssistantPanel = useCallback(() => {
    sessionIdRef.current += 1;
    handsFreeSessionActiveRef.current = false;
    setVoiceSessionMode('manual');
    setListeningMode('initial');
    clearScheduledListening();
    setState('open');
    clearAssistantUi();
  }, [clearAssistantUi, clearScheduledListening, setVoiceSessionMode]);

  const closeAssistant = useCallback(() => {
    sessionIdRef.current += 1;
    handsFreeSessionActiveRef.current = false;
    setVoiceSessionMode('manual');
    setListeningMode('initial');
    clearScheduledListening();
    cancelListening();
    stopSpeaking();
    setState('idle');
    setTranscript('');
    setResponse('');
    setError('');
  }, [cancelListening, clearScheduledListening, setVoiceSessionMode, stopSpeaking]);

  const beginHandsFreeSession = useCallback(() => {
    if (voiceBackend === 'none') {
      openAssistantPanel();
      setError('Voice input is unavailable. Add a Deepgram key in Settings → Voice Assistant to use hands-free mode.');
      return;
    }

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    handsFreeSessionActiveRef.current = true;
    setVoiceSessionMode('handsfree');
    setListeningMode('initial');
    clearScheduledListening();
    cancelListening();
    stopSpeaking();
    setState('open');
    setTranscript('');
    setError('');
    setResponse('');

    void (async () => {
      const stillActive = await speakMessage(VOICE_SESSION.GREETING[lang], sessionId);
      if (!stillActive || !handsFreeSessionActiveRef.current) {
        return;
      }

      scheduleHandsFreeListening('initial', sessionId);
    })();
  }, [cancelListening, clearScheduledListening, lang, openAssistantPanel, scheduleHandsFreeListening, setVoiceSessionMode, speakMessage, stopSpeaking, voiceBackend]);

  const processTranscript = useCallback(async (text: string, inputMode: InputMode) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const requestSessionId = sessionIdRef.current;

    if (inputMode === 'voice' && handsFreeSessionActiveRef.current && isVoiceStopPhrase(trimmed, lang)) {
      setTranscript(trimmed);
      setError('');
      await endHandsFreeSession({ closingMessage: VOICE_SESSION.STOP_RESPONSE[lang] });
      return;
    }

    setState('processing');
    setTranscript(trimmed);
    setError('');

    const prayerTimes = prayerData?.prayers.map(prayer => ({ name: prayer.name, time: prayer.time }));

    try {
      const result = await processAssistantCommand(trimmed, {
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

      if (sessionIdRef.current !== requestSessionId) {
        return;
      }

      dialogStateRef.current = result.dialogState;

      chatHistoryRef.current = [
        ...chatHistoryRef.current,
        { role: 'user' as const, content: trimmed },
        { role: 'assistant' as const, content: result.message },
      ].slice(-10);

      const sessionId = sessionIdRef.current;
      const continueHandsFree = inputMode === 'voice' && handsFreeSessionActiveRef.current;
      const finishedSpeaking = await speakMessage(result.message, continueHandsFree ? sessionId : undefined);

      if (continueHandsFree && finishedSpeaking) {
        scheduleHandsFreeListening('followup', sessionId);
      }
    } catch (processingError) {
      logError('VoiceAssistant', processingError);
      const message = processingError instanceof Error
        ? processingError.message
        : 'Lina hit an unexpected problem while handling that request.';

      if (sessionIdRef.current !== requestSessionId) {
        return;
      }

      setError(message);
      setState('open');
      if (handsFreeSessionActiveRef.current) {
        handsFreeSessionActiveRef.current = false;
        setVoiceSessionMode('manual');
        setListeningMode('initial');
        clearScheduledListening();
      }
    }
  }, [
    app,
    clearScheduledListening,
    endHandsFreeSession,
    lang,
    ollamaEndpoint,
    ollamaModel,
    prayerData,
    scheduleHandsFreeListening,
    setVoiceSessionMode,
    speakMessage,
  ]);

  useEffect(() => {
    processTranscriptRef.current = processTranscript;
  }, [processTranscript]);

  useEffect(() => {
    dialogStateRef.current = {
      ...dialogStateRef.current,
      currentSurface: app.surface,
    };
  }, [app.surface]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    (window as Window & {
      __helmVoiceAssistantDebug?: {
        startHandsFreeSession: () => void;
        closeAssistant: () => void;
        submitVoiceTranscript: (text: string) => void;
      };
    }).__helmVoiceAssistantDebug = {
      startHandsFreeSession: beginHandsFreeSession,
      closeAssistant,
      submitVoiceTranscript: (text: string) => {
        void processTranscript(text, 'voice');
      },
    };

    return () => {
      delete (window as Window & {
        __helmVoiceAssistantDebug?: unknown;
      }).__helmVoiceAssistantDebug;
    };
  }, [beginHandsFreeSession, closeAssistant, processTranscript]);

  useEffect(() => {
    if (state === 'open' && inputRef.current && voiceSessionModeRef.current === 'manual') {
      setTimeout(() => inputRef.current?.focus(), TIMING.INPUT_FOCUS_DELAY);
    }
  }, [state]);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    void processTranscript(textInput.trim(), 'text');
    setTextInput('');
  };

  const handleClick = () => {
    if (state === 'idle') {
      openAssistantPanel();
      return;
    }

    closeAssistant();
  };

  useWakeWord({
    enabled,
    wakeWordEnabled,
    loaded: app.loaded,
    assistantIdle: state === 'idle',
    onWakeWordDetected: beginHandsFreeSession,
  });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'L') {
        event.preventDefault();
        if (state === 'idle') {
          openAssistantPanel();
        } else {
          closeAssistant();
        }
        return;
      }

      if (event.key === 'Escape' && state !== 'idle') {
        closeAssistant();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [closeAssistant, openAssistantPanel, state]);

  useEffect(() => () => {
    clearScheduledListening();
  }, [clearScheduledListening]);

  if (!enabled) return null;

  const isOpen = state !== 'idle';
  const canVoice = voiceBackend !== 'none';
  const showPromptSuggestions = state === 'open' && !transcript && !response && voiceSessionMode === 'manual';
  const headerStatus = state === 'listening'
    ? listeningMode === 'followup'
      ? isArabic ? '\uD83C\uDF99\uFE0F \u0623\u0633\u062A\u0645\u0639 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629...' : '\uD83C\uDF99\uFE0F Listening for follow-up...'
      : isArabic ? '\uD83C\uDF99\uFE0F \u0623\u0633\u062A\u0645\u0639...' : '\uD83C\uDF99\uFE0F Listening...'
    : state === 'processing'
      ? isArabic ? '\uD83E\uDD14 \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0641\u0643\u064A\u0631...' : '\uD83E\uDD14 Thinking...'
      : state === 'speaking'
        ? isArabic ? '\uD83D\uDD0A \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u062F\u062B...' : '\uD83D\uDD0A Speaking...'
        : voiceSessionMode === 'handsfree'
          ? isArabic ? '\u062C\u0644\u0633\u0629 \u0635\u0648\u062A\u064A\u0629 \u0628\u062F\u0648\u0646 \u0644\u0645\u0633 \u0646\u0634\u0637\u0629' : 'Hands-free voice session active'
          : isArabic ? '\u0627\u0633\u0623\u0644\u0646\u064A \u0623\u064A \u0634\u064A\u0621' : 'Ask me anything';
  const listeningPrompt = listeningMode === 'followup'
    ? isArabic ? '\u0623\u0633\u062A\u0645\u0639 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629...' : 'Listening for follow-up...'
    : isArabic ? '\u0623\u0633\u062A\u0645\u0639... \u062A\u062D\u062F\u062B \u0628\u0634\u0643\u0644 \u0637\u0628\u064A\u0639\u064A' : 'Listening... speak naturally';

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
            <span style={{ fontSize: 11, color: '#6b6f85' }}>{headerStatus}</span>
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
                    ? canVoice ? '\u0627\u0643\u062A\u0628 \u0623\u0648 \u062A\u062D\u062F\u062B \u0645\u0639\u064A...' : '\u0627\u0643\u062A\u0628 \u0623\u0645\u0631\u0627\u064B...'
                    : canVoice ? 'Type or talk to Lina...' : 'Type a command...'}
                  value={textInput}
                  onChange={event => setTextInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleTextSubmit();
                    if (event.key === 'Escape') closeAssistant();
                  }}
                />
              )}
              {state === 'listening' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: 8 }}>
                  <span className="va-dots"><span /><span /><span /></span>
                  <span style={{ fontSize: 12, color: '#22c55e' }}>{listeningPrompt}</span>
                </div>
              )}
              {canVoice && state !== 'listening' && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handsFreeSessionActiveRef.current = false;
                    setVoiceSessionMode('manual');
                    setListeningMode('initial');
                    clearScheduledListening();
                    preserveResponseOnNextListeningRef.current = false;
                    startListening();
                  }}
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
                  title={voiceBackend === 'deepgram' ? 'Start voice input (Deepgram)' : 'Speak your command'}
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
                  aria-label="Stop listening"
                  title="Stop listening"
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

          {showPromptSuggestions && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4, direction: isArabic ? 'rtl' : 'ltr' }}>
              {(isArabic
                ? ['\u0627\u0644\u0627\u062C\u062A\u0645\u0627\u0639 \u0627\u0644\u0642\u0627\u062F\u0645', '\u0643\u0645 \u0645\u0647\u0645\u0629', '\u0623\u0648\u0642\u0627\u062A \u0627\u0644\u0635\u0644\u0627\u0629', '\u0627\u0641\u062A\u062D \u0627\u0644\u062A\u0642\u0648\u064A\u0645', '\u0633\u0644\u0633\u0644\u0629']
                : ['next meeting', 'tasks left', 'prayer times', 'open calendar', 'my streak']
              ).map(command => (
                <button
                  key={command}
                  onClick={() => { setTextInput(''); void processTranscript(command, 'text'); }}
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

          {state === 'open' && voiceSessionMode === 'handsfree' && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#4a4e63', direction: isArabic ? 'rtl' : 'ltr' }}>
              {isArabic ? '\u0642\u0644 "\u062E\u0644\u0627\u0635" \u0623\u0648 "\u0634\u0643\u0631\u0627\u064B \u0644\u064A\u0646\u0627" \u0644\u0625\u0646\u0647\u0627\u0621 \u0627\u0644\u062C\u0644\u0633\u0629.' : 'Say "stop" or "thanks Lina" to end the voice session.'}
            </div>
          )}

          {state === 'open' && voiceSessionMode === 'manual' && !transcript && !response && (
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
