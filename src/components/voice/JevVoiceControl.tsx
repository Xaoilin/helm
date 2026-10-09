import { useEffect, useRef, useState } from 'react';
import { VOICE, VOICE_ACTIONS, hasEndCue, hasWakeWord } from '../../../supabase/functions/_shared/jevVoice';
import { createDeepgramSpeech } from '../../services/deepgramSpeech';
import { listHelmSecrets } from '../../store/supabase/secrets';
import { useJevVoiceWorkflow } from '../../hooks/useJevVoiceWorkflow';
import { useShell } from '../../store/ShellContext';
import type { HelmSecretSummary } from '../../types/domain';
import './JevVoiceControl.css';

const PROVIDER = { jev: /typesafe|jev/i, speech: /deepgram/i, keyKind: 'api_key' } as const;
const MIC_SESSION_MS = 5 * 60 * 1_000;
const MIC_STATUS = { stopped: 'stopped', connecting: 'connecting', listening: 'listening' } as const;
type MicStatus = typeof MIC_STATUS[keyof typeof MIC_STATUS];

function JevVoicePanel({ close }: { close: () => void }) {
  const workflow = useJevVoiceWorkflow();
  const shell = useShell();
  const [keys, setKeys] = useState<HelmSecretSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [jevKey, setJevKey] = useState('');
  const [speechKey, setSpeechKey] = useState('');
  const [command, setCommand] = useState('');
  const [heard, setHeard] = useState('');
  const [micStatus, setMicStatus] = useState<MicStatus>(MIC_STATUS.stopped);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [wakeWord, setWakeWord] = useState(true);
  const [waitOver, setWaitOver] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buffer = useRef('');
  const runtime = useRef({ jevKey, wakeWord, waitOver, workflow });
  const speech = useRef<ReturnType<typeof createDeepgramSpeech> | null>(null);
  const { cancel, readOnly } = workflow;

  useEffect(() => { runtime.current = { jevKey, wakeWord, waitOver, workflow }; });
  useEffect(() => {
    let cancelled = false;
    inputRef.current?.focus();
    void listHelmSecrets().then(result => {
      if (cancelled) return;
      const apiKeys = result.secrets.filter(key => key.kind === PROVIDER.keyKind && !key.archivedAt);
      setKeys(apiKeys);
      setJevKey(apiKeys.find(key => PROVIDER.jev.test(key.label))?.secretId ?? '');
      setSpeechKey(apiKeys.find(key => PROVIDER.speech.test(key.label))?.secretId ?? '');
    }, error => {
      if (!cancelled) setSetupError(error instanceof Error ? error.message : 'Could not load provider keys.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const session = createDeepgramSpeech({
    status: setMicStatus,
    error: setSpeechError,
    transcript: (text, final) => {
      const state = runtime.current;
      if (state.workflow.busy) return;
      const startsCommand = hasWakeWord(text);
      const addressed = startsCommand || Boolean(buffer.current) || !state.wakeWord || Boolean(state.workflow.pending);
      if (!addressed) return;
      const combined = startsCommand ? text : `${buffer.current} ${text}`.trim();
      setHeard(combined);
      if (!final) return;
      buffer.current = combined;
      if (combined.length > VOICE.maxText) { buffer.current = ''; setSpeechError('Command was too long. Say one short command.'); return; }
      if (state.waitOver && !hasEndCue(combined)) return;
      buffer.current = '';
      void state.workflow.run(combined, state.jevKey);
    },
    });
    speech.current = session;
    return () => { session.stop(); speech.current = null; };
  }, []);
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState === 'hidden') { speech.current?.stop(); cancel(); buffer.current = ''; }
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [cancel]);
  useEffect(() => {
    if (readOnly || shell.surface === 'secrets') { speech.current?.stop(); cancel(); buffer.current = ''; }
  }, [shell.surface, readOnly, cancel]);
  useEffect(() => {
    if (micStatus === MIC_STATUS.stopped) return;
    const timeout = setTimeout(() => { speech.current?.stop(); buffer.current = ''; setSpeechError('The five-minute mic session ended. Enable it again to continue.'); }, MIC_SESSION_MS);
    return () => clearTimeout(timeout);
  }, [micStatus]);

  const paused = workflow.readOnly || shell.surface === 'secrets';
  const jevKeys = keys.filter(key => PROVIDER.jev.test(key.label));
  const speechKeys = keys.filter(key => PROVIDER.speech.test(key.label));
  const error = setupError || speechError || workflow.error;

  function stop() { speech.current?.stop(); buffer.current = ''; workflow.cancel(); }
  function submit() {
    if (!command.trim()) return;
    setHeard(command);
    void workflow.run(command, jevKey);
  }

  return (
    <section className="jev-voice-panel" aria-label="Jev voice prototype" tabIndex={0} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); stop(); close(); }
    }}>
      <div className="jev-voice-heading">
        <div><strong>Jev voice</strong><span className="jev-prototype-tag">Prototype</span></div>
        <button className="btn-icon" aria-label="Close voice prototype" onClick={() => { stop(); close(); }}>×</button>
      </div>
      <p className="jev-voice-intro">Open pages, find tasks, projects, inventory or knowledge, and add or complete a task.</p>
      <details open={!jevKey || !speechKey}>
        <summary>Provider keys</summary>
        {loading ? <p role="status">Loading Vault keys…</p> : <>
          <label className="form-group">TypeSafe key
            <select className="form-select" value={jevKey} disabled={workflow.busy} onChange={event => { stop(); setJevKey(event.target.value); }}>
              <option value="">Choose TypeSafe API key</option>
              {jevKeys.map(key => <option key={key.secretId} value={key.secretId}>{key.label}</option>)}
            </select>
          </label>
          <label className="form-group">Deepgram key
            <select className="form-select" value={speechKey} onChange={event => { stop(); setSpeechKey(event.target.value); }}>
              <option value="">Choose Deepgram API key</option>
              {speechKeys.map(key => <option key={key.secretId} value={key.secretId}>{key.label}</option>)}
            </select>
          </label>
          {(!jevKeys.length || !speechKeys.length) && <p>Save API keys in Secrets with labels “TypeSafe” and “Deepgram”. Deepgram needs Member permission.</p>}
          <button className="btn btn-secondary btn-sm" onClick={() => { stop(); shell.navigate('secrets'); close(); }}>Open Secrets</button>
        </>}
      </details>
      <p className="jev-voice-privacy">Mic audio goes to Deepgram; commands and item names go to TypeSafe. Keys stay in Vault. Speech is billed while the mic is on.</p>
      <div className="jev-voice-mic-row">
        <button className="btn btn-primary" disabled={paused || !jevKey || !speechKey} onClick={() => {
          if (micStatus !== MIC_STATUS.stopped) { stop(); return; }
          setSpeechError(null); buffer.current = ''; void speech.current?.start(speechKey);
        }}>{micStatus === MIC_STATUS.stopped ? 'Enable microphone' : 'Stop microphone'}</button>
        <span role="status">{micStatus === MIC_STATUS.listening ? 'Listening' : micStatus === MIC_STATUS.connecting ? 'Connecting…' : 'Mic off'}</span>
      </div>
      <div className="jev-voice-options">
        <label><input type="checkbox" checked={wakeWord} onChange={event => { buffer.current = ''; setWakeWord(event.target.checked); }} /> Require “Hey Sabah”</label>
        <label><input type="checkbox" checked={waitOver} onChange={event => { buffer.current = ''; setWaitOver(event.target.checked); }} /> Wait for “over”</label>
      </div>
      <p className="jev-voice-example">“Hey Sabah, add a task to buy milk, over.”<br />The mic stops after five minutes or when the page is hidden.</p>
      <label className="form-group">Or type a command
        <textarea ref={inputRef} className="form-input" rows={2} maxLength={VOICE.maxText} value={command} onChange={event => setCommand(event.target.value)}
          placeholder="Open Calendar / find my printer / add a task to buy milk" onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
          }} />
      </label>
      <button className="btn btn-secondary" disabled={paused || workflow.busy || !jevKey || !command.trim()} onClick={submit}>{workflow.busy ? 'Working…' : 'Run command'}</button>
      {heard && <p className="jev-voice-heard">Heard: {heard}</p>}
      {paused && <p role="status">Voice is paused while offline or viewing Secrets.</p>}
      <p role="status" aria-live="polite" className="jev-voice-notice">{workflow.notice}</p>
      {workflow.pending && <div className="jev-voice-preview">
        <strong>{workflow.pending.action === VOICE_ACTIONS.add ? 'Add task' : 'Complete task'}</strong>
        <p>{workflow.pending.title}</p>
        <div className="jev-voice-actions">
          <button className="btn btn-primary" disabled={workflow.busy || paused} onClick={() => void workflow.confirm()}>Confirm</button>
          <button className="btn btn-secondary" disabled={workflow.busy} onClick={workflow.cancel}>Cancel</button>
        </div>
      </div>}
      {workflow.found && <div className="jev-voice-preview"><strong>{workflow.found.label}</strong><p>Found in {workflow.found.page}.</p></div>}
      {error && <p role="alert" className="jev-voice-error">{error}</p>}
      {workflow.measurement && <small className="jev-voice-measurement">
        Jev decision: {workflow.measurement.decisionMs} ms · {workflow.measurement.inputTokens} input tokens · estimated ${(
          workflow.measurement.inputTokens * VOICE.inputPricePerMillion / VOICE.tokensPerMillion
        ).toFixed(6)} (speech excluded)
      </small>}
    </section>
  );
}

export default function JevVoiceControl() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  function close() { setOpen(false); opener.current?.focus(); }
  return <aside className="jev-voice-control">
    {open && <JevVoicePanel close={close} />}
    <button ref={opener} className="btn btn-secondary jev-voice-toggle" aria-expanded={open} aria-label="Toggle Jev voice prototype" onClick={() => setOpen(value => !value)}>🎙 Jev voice</button>
  </aside>;
}
