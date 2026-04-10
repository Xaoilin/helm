import { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { isSupabaseReady, isAuthenticated, getCurrentUserId } from '../store/supabase';
import type { AssistantRuntimeStatus } from '../services/assistantAvailability';
import { DEFAULT_ASSISTANT_PROVIDER, ELEVENLABS_API_KEY, HOSTED_ASSISTANT_MODEL, OLLAMA_ENDPOINT } from '../config';
import { DEFAULT_PROFILE } from '../services/gamification';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';
import { canUseHostedAssistantProjectAccess, isLocalhostRuntime } from '../services/hostedAssistantAccess';
import { testOllamaConnection, listOllamaModels } from '../services/ollamaApi';
import { APP_RELEASE_VERSION } from '../config/release';

export default function SettingsSurface() {
  const app = useApp();
  const { settings } = app;
  const [confirmReset, setConfirmReset] = useState(false);
  const [testAdhan, setTestAdhan] = useState<string | null>(null);

  // Goal tags
  const [newTag, setNewTag] = useState('');
  const [assistantStatus, setAssistantStatus] = useState<AssistantRuntimeStatus>({
    activeProvider: null,
    state: 'checking',
    headline: 'Checking assistant runtime...',
    detail: 'Lina is checking which AI provider is currently available.',
  });
  const selectedProvider = getAssistantProviderSetting(settings);
  const authSyncKey = `${isSupabaseReady()}:${isAuthenticated()}:${getCurrentUserId() || ''}`;
  const hostedProjectAccessAvailable = canUseHostedAssistantProjectAccess();
  const localhostRuntime = isLocalhostRuntime();

  // Microphone devices
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    // Need to request mic permission first to get labels
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devices => setMicrophones(devices.filter(d => d.kind === 'audioinput')))
      .catch(() => {}); // Permission denied — no mic list
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAssistantRuntimeStatus({
      assistantProvider: selectedProvider,
      ollamaEndpoint: settings.ollamaEndpoint,
    }).then(status => {
      if (!cancelled) setAssistantStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider, settings.ollamaEndpoint, authSyncKey]);

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Execution, privacy, and preference controls</div>
        </div>
      </div>
      <div className="surface-body">
        {/* Data Sync Status */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Data Sync</h3>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{isSupabaseReady() && isAuthenticated() ? '🟢' : '🔴'}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {isSupabaseReady() && isAuthenticated()
                  ? 'Your data syncs automatically'
                  : 'Sign in with Google to sync your data across devices'}
              </div>
              <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 2 }}>
                {isSupabaseReady() && isAuthenticated()
                  ? `Signed in as ${getCurrentUserId()?.slice(0, 8)}... \u00b7 All changes saved to the cloud in real time.`
                  : 'Your data is stored locally. Sign in via the sidebar to enable cloud sync.'}
              </div>
            </div>
          </div>
        </div>

        {/* Google Calendar */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Calendar</h3>
        <div className="card">
          <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
            <label htmlFor="settings-default-cal-view">Default calendar view</label>
            <select
              id="settings-default-cal-view"
              className="form-select"
              style={{ maxWidth: 200 }}
              value={settings.defaultCalendarTab || 'week'}
              onChange={e => app.updateSettings({ defaultCalendarTab: e.target.value as 'month' | 'week' | 'agenda' | 'accounts' })}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="agenda">Agenda</option>
            </select>
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 4 }}>
              The tab shown when you open the Calendar.
            </div>
          </div>
        </div>

        {/* Goal categories */}
        {/* Prayer Times */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Prayer Times (Adhan)</h3>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Enable prayer time notifications</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Show prayer times on Dashboard with Adhan notification when each prayer arrives.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.prayerEnabled !== false} onChange={e => app.updateSettings({ prayerEnabled: e.target.checked })} aria-label="Toggle prayer notifications" />
              <span className="slider" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="settings-prayer-city">City</label>
              <input id="settings-prayer-city" className="form-input" value={settings.prayerCity || 'Bedford'} onChange={e => app.updateSettings({ prayerCity: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor="settings-prayer-country">Country</label>
              <input id="settings-prayer-country" className="form-input" value={settings.prayerCountry || 'United Kingdom'} onChange={e => app.updateSettings({ prayerCountry: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
            Method: Shia Ithna-Ashari (Jafari), Leva Institute, Qum.{' '}
            <a href="https://aladhan.com/calculation-methods" target="_blank" rel="noopener noreferrer" style={{ color: '#4f5bff' }}>Learn more</a>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1e2030' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Test Notification</div>
            <div className="actions-row" style={{ gap: 6 }}>
              {['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(name => (
                <button
                  key={name}
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setTestAdhan(name);
                    if ('Notification' in window && Notification.permission === 'granted') {
                      new Notification(`\u0627\u0644\u0644\u0647 \u0623\u0643\u0628\u0631 - ${name}`, { body: `It's time for ${name} prayer` });
                    } else if ('Notification' in window && Notification.permission === 'default') {
                      Notification.requestPermission().then(p => {
                        if (p === 'granted') new Notification(`\u0627\u0644\u0644\u0647 \u0623\u0643\u0628\u0631 - ${name}`, { body: `It's time for ${name} prayer` });
                      });
                    }
                    setTimeout(() => setTestAdhan(null), 10000);
                  }}
                >
                  Test {name}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              Click to preview the Adhan banner + browser notification. Banner dismisses after 10 seconds.
            </div>
          </div>
        </div>

        {/* Test Adhan — Full Screen Overlay */}
        {testAdhan && (
          <div className="adhan-banner" onClick={() => setTestAdhan(null)}>
            <div className="adhan-ring" />
            <div className="adhan-ring" />
            <div className="adhan-ring" />
            <div className="adhan-content">
              <div className="adhan-mosque">{'\u{1F54C}'}</div>
              <div className="adhan-text">
                <div className="adhan-title">{'\u0627\u0644\u0644\u0647 \u0623\u0643\u0628\u0631'}</div>
                <div className="adhan-subtitle">Allahu Akbar</div>
                <div className="adhan-subtitle">It's time for <strong>{testAdhan}</strong></div>
                <div className="adhan-time">Test notification</div>
              </div>
            </div>
            <div className="adhan-dismiss">Click anywhere to dismiss</div>
          </div>
        )}

        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Goal Categories</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Organize your goals by category. These appear as filters and tags in the Goals tab.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {(settings.goalTags || []).map(tag => (
              <span key={tag} className="tag tag-goal" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}>
                {tag}
                <button
                  style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                  onClick={() => app.updateSettings({ goalTags: (settings.goalTags || []).filter(t => t !== tag) })}
                  aria-label={`Remove ${tag} category`}
                >
                  &times;
                </button>
              </span>
            ))}
            {(settings.goalTags || []).length === 0 && (
              <span style={{ fontSize: 12, color: '#6b6f85' }}>No categories yet</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              style={{ maxWidth: 200 }}
              placeholder="New category..."
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTag.trim()) {
                  const tags = settings.goalTags || [];
                  if (!tags.includes(newTag.trim())) {
                    app.updateSettings({ goalTags: [...tags, newTag.trim()] });
                  }
                  setNewTag('');
                }
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!newTag.trim()}
              onClick={() => {
                const tags = settings.goalTags || [];
                if (!tags.includes(newTag.trim()) && newTag.trim()) {
                  app.updateSettings({ goalTags: [...tags, newTag.trim()] });
                }
                setNewTag('');
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Credential source preference */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Credential Source</h3>
        <div className="card">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-cred-source">Primary credential source</label>
            <select
              id="settings-cred-source"
              className="form-select"
              value={settings.credentialSource}
              onChange={e => app.updateSettings({ credentialSource: e.target.value as typeof settings.credentialSource })}
            >
              <option value="onepassword-first">1Password (preferred, local vault as fallback)</option>
              <option value="local-only">Local vault only</option>
            </select>
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 6 }}>
              {settings.credentialSource === 'onepassword-first'
                ? 'HELM will try 1Password first. If unavailable, the local vault is used as fallback.'
                : 'HELM will only use the local credential vault. 1Password integration is ignored.'}
            </div>
          </div>
        </div>

        {/* Privacy */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Privacy</h3>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Telemetry</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Send anonymous usage data to help improve HELM. No personal data is ever sent.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.telemetry} onChange={e => app.updateSettings({ telemetry: e.target.checked })} aria-label="Toggle telemetry" />
              <span className="slider" />
            </label>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-data-retention">Data retention (days)</label>
            <input
              id="settings-data-retention"
              className="form-input"
              type="number"
              min={7}
              max={365}
              value={settings.dataRetentionDays}
              onChange={e => app.updateSettings({ dataRetentionDays: Math.max(7, Math.min(365, parseInt(e.target.value) || 90)) })}
              style={{ maxWidth: 120 }}
            />
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 4 }}>
              How long HELM retains local conversation history and logs.
            </div>
          </div>
        </div>

        {/* Appearance */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Appearance</h3>
        <div className="card">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settings-theme">Theme</label>
            <select
              id="settings-theme"
              className="form-select"
              value={settings.theme}
              onChange={e => app.updateSettings({ theme: e.target.value as 'dark' | 'light' })}
              style={{ maxWidth: 200 }}
            >
              <option value="dark">Dark</option>
              <option value="light">Light (not yet implemented)</option>
            </select>
            {settings.theme === 'light' && (
              <div className="info-box warning" style={{ marginTop: 8 }}>
                Light theme is not yet available. The app will continue using the dark theme.
              </div>
            )}
          </div>
        </div>

        {/* Voice Assistant (Lina) */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Voice Assistant (Lina)</h3>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Enable voice assistant</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Click the floating "L" button to talk to Lina. She can navigate, check your schedule, and more.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.assistantEnabled !== false} onChange={e => app.updateSettings({ assistantEnabled: e.target.checked })} aria-label="Toggle voice assistant" />
              <span className="slider" />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Wake word ("Hey Lina")</div>
              <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 2 }}>
                Listens for "Hey Lina" using OpenWakeWord (runs locally in your browser via WASM — no network, no API key, completely free). Say the wake word and Lina opens automatically.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.wakeWordEnabled === true} onChange={e => app.updateSettings({ wakeWordEnabled: e.target.checked })} aria-label="Toggle wake word" />
              <span className="slider" />
            </label>
          </div>
          {/* Language */}
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-assistant-provider">Open-ended AI mode</label>
            <select
              id="settings-assistant-provider"
              className="form-select"
              value={settings.assistantProvider || DEFAULT_ASSISTANT_PROVIDER}
              onChange={e => app.updateSettings({ assistantProvider: e.target.value as typeof settings.assistantProvider })}
            >
              <option value="auto">Auto (hosted first, then Ollama)</option>
              <option value="hosted">Hosted AI ({HOSTED_ASSISTANT_MODEL})</option>
              <option value="ollama">Local AI (Ollama only)</option>
            </select>
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              {hostedProjectAccessAvailable
                ? `Hosted AI uses the Supabase Edge Function and this build's configured project access key${localhostRuntime ? ' on localhost' : ''}. Supabase sign-in is still used for sync; browser builds still cannot start Ollama for you.`
                : 'Hosted AI needs Supabase project access in this build. Browser builds still cannot start Ollama for you.'}
            </div>
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#13151c', border: '1px solid #1e2030', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Runtime status</div>
              <div style={{ fontSize: 12, color: assistantStatus.state === 'ready' ? '#22c55e' : assistantStatus.state === 'checking' ? '#6b6f85' : assistantStatus.state === 'offline' ? '#ff6b6b' : '#f0c040' }}>
                {assistantStatus.headline}
              </div>
              <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
                {assistantStatus.detail}
              </div>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-assistant-lang">Response language</label>
            <select
              id="settings-assistant-lang"
              className="form-select"
              value={settings.assistantLanguage || 'en'}
              onChange={e => app.updateSettings({ assistantLanguage: e.target.value as 'en' | 'ar' })}
            >
              <option value="en">English</option>
              <option value="ar">العربية (Arabic)</option>
            </select>
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              Lina will respond and listen in the selected language. Voice recognition also switches language.
            </div>
          </div>
          {/* Deepgram API Key — for speech-to-text */}
          <div className="form-group" style={{ marginTop: 12, marginBottom: 12 }}>
            <label htmlFor="settings-deepgram">Deepgram API Key (for voice input)</label>
            <input
              id="settings-deepgram"
              className="form-input"
              type="password"
              placeholder="Paste your Deepgram API key..."
              value={settings.deepgramApiKey || ''}
              onChange={e => app.updateSettings({ deepgramApiKey: e.target.value || undefined })}
            />
            <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
              Free at <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" style={{ color: '#7c8aff' }}>console.deepgram.com</a> — comes with $200 credit.
              Enables reliable voice commands (bypasses Chrome&apos;s broken speech service).
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginBottom: 10 }}>
            {ELEVENLABS_API_KEY ? 'ElevenLabs voice output configured ✓' : 'Using browser voice output (configure ElevenLabs in .env for cloned voice)'}
          </div>
          <div style={{ fontSize: 10, color: '#4a4e62', marginBottom: 10 }}>
            Tip: if Lina mishears you, say <strong>"No, I said ..."</strong>. HELM now stores that correction locally and reuses it for future voice and chat commands.
          </div>
          {microphones.length > 0 && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="settings-mic">Microphone</label>
              <select
                id="settings-mic"
                className="form-select"
                value={settings.microphoneDeviceId || ''}
                onChange={e => app.updateSettings({ microphoneDeviceId: e.target.value || undefined })}
              >
                <option value="">Default microphone</option>
                {microphones.map(mic => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label || `Microphone ${mic.deviceId.slice(0, 8)}...`}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
                Used for "Hey Lina" wake word and voice commands.
              </div>
              <MicTester deviceId={settings.microphoneDeviceId} />
            </div>
          )}
        </div>

        {/* Ollama LLM */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Local AI (Ollama)</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Connect to a local Ollama instance for desktop or local-fallback AI conversations. Install from <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: '#7c8aff' }}>ollama.com</a>, then run <code style={{ background: '#1a1d2e', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>ollama pull llama3.2</code>
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label htmlFor="settings-ollama-endpoint">Ollama endpoint</label>
            <input
              id="settings-ollama-endpoint"
              className="form-input"
              placeholder="http://localhost:11434"
              value={settings.ollamaEndpoint || ''}
              onChange={e => app.updateSettings({ ollamaEndpoint: e.target.value || undefined })}
            />
          </div>
          <OllamaModelSelector
            key={settings.ollamaEndpoint || OLLAMA_ENDPOINT}
            endpoint={settings.ollamaEndpoint || OLLAMA_ENDPOINT}
            currentModel={settings.ollamaModel}
            onModelChange={(model) => app.updateSettings({ ollamaModel: model || undefined })}
          />
        </div>

        {/* Reset Gamification */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>Gamification Reset</h3>
        <div className="card">
          <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 10 }}>
            Reset all XP, levels, badges, streaks, habit tallies, and prayer stats back to zero. This cannot be undone.
          </div>
          {confirmReset ? (
            <div className="confirm-bar" role="alert">
              Are you sure? This will permanently reset ALL gamification progress.
              <button className="btn btn-danger btn-sm" onClick={() => { app.updateGamification({ ...DEFAULT_PROFILE }); setConfirmReset(false); }}>Yes, Reset Everything</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}>Reset All Progress</button>
          )}
        </div>

        {/* About */}
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 12px' }}>About</h3>
        <div className="card">
          <div style={{ fontSize: 13 }}>
            <strong>HELM</strong> {APP_RELEASE_VERSION}<br />
            <span style={{ color: '#6b6f85' }}>
              Local-first personal assistant for software engineers.<br />
              Built with Tauri + React + TypeScript + Rust.
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 8 }}>
            The same release version is pinned in the sidebar so you can always see which build you are using.
          </div>
          <div className="info-box" style={{ marginTop: 12 }}>
            Runtime status is reported where the feature actually lives:
            <br />
            Chat shows the active assistant runtime state, Calendar labels local-only calendars, Integrations marks simulated providers, and Credentials explains the local vault security limits.
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ollama Model Selector sub-component ──

// ── Microphone Tester sub-component ──

function MicTester({ deviceId }: { deviceId?: string }) {
  const [micState, setMicState] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [level, setLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startRecording = async () => {
    setError(null);
    setPlaybackUrl(null);
    chunksRef.current = [];

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Set up analyser for live level meter
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Animate level meter
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Record audio
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setMicState('recording');

      // Auto-stop after 5 seconds
      setTimeout(() => { if (mediaRecorderRef.current?.state === 'recording') stopRecording(); }, 5000);
    } catch (e) {
      setError(e instanceof Error && e.message.includes('NotAllowed')
        ? 'Microphone blocked. Click the lock icon in your browser address bar to allow.'
        : `Mic error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const stopRecording = () => {
    cancelAnimationFrame(animFrameRef.current);
    setLevel(0);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    setMicState('idle');
  };

  const playRecording = () => {
    if (!playbackUrl) return;
    const audio = new Audio(playbackUrl);
    audioRef.current = audio;
    setMicState('playing');
    audio.onended = () => { setMicState('idle'); audioRef.current = null; };
    audio.onerror = () => { setMicState('idle'); audioRef.current = null; };
    audio.play();
  };

  const stopPlayback = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setMicState('idle');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (audioRef.current) audioRef.current.pause();
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ marginTop: 10, padding: 10, background: '#13151c', borderRadius: 8, border: '1px solid #1e2030' }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Microphone Test</div>

      {/* Level meter */}
      {micState === 'recording' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#22c55e', minWidth: 70 }}>🔴 Recording...</span>
            <div style={{ flex: 1, height: 8, background: '#1a1d2e', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${level}%`, height: '100%', borderRadius: 4,
                background: level > 60 ? '#22c55e' : level > 20 ? '#f59e0b' : '#4a4e63',
                transition: 'width 0.1s',
              }} />
            </div>
            <span style={{ fontSize: 10, color: '#6b6f85', minWidth: 30 }}>{level}%</span>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {micState === 'idle' && (
          <>
            <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={startRecording}>
              🎙️ Record Test
            </button>
            {playbackUrl && (
              <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={playRecording}>
                🔊 Play Back
              </button>
            )}
          </>
        )}
        {micState === 'recording' && (
          <button className="btn btn-danger btn-sm" style={{ fontSize: 11 }} onClick={stopRecording}>
            ⏹️ Stop Recording
          </button>
        )}
        {micState === 'playing' && (
          <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={stopPlayback}>
            ⏹️ Stop Playback
          </button>
        )}
        {playbackUrl && micState === 'idle' && (
          <span style={{ fontSize: 10, color: '#22c55e' }}>✓ Recording ready — click Play Back to listen</span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{error}</div>
      )}

      <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 6 }}>
        Record up to 5 seconds, then play back to verify your mic is working. The level meter shows live input volume.
      </div>
    </div>
  );
}

// ── Ollama Model Selector sub-component ──

function OllamaModelSelector({ endpoint, currentModel, onModelChange }: {
  endpoint: string;
  currentModel?: string;
  onModelChange: (model: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<'checking' | 'connected' | 'offline'>('checking');

  useEffect(() => {
    let cancelled = false;

    testOllamaConnection(endpoint).then(ok => {
      if (cancelled) return;
      if (ok) {
        setStatus('connected');
        listOllamaModels(endpoint).then(foundModels => {
          if (!cancelled) setModels(foundModels);
        });
      } else {
        setStatus('offline');
        setModels([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>Status:</span>
        <span style={{ fontSize: 12, color: status === 'connected' ? '#22c55e' : status === 'offline' ? '#ff6b6b' : '#6b6f85' }}>
          {status === 'checking' ? '⏳ Checking...' :
           status === 'connected' ? '🟢 Connected' :
           '🔴 Offline — start Ollama to enable AI'}
        </span>
        <button
          className="btn btn-secondary btn-sm"
          style={{ fontSize: 10, padding: '3px 8px' }}
          onClick={() => {
            setStatus('checking');
            testOllamaConnection(endpoint).then(ok => {
              setStatus(ok ? 'connected' : 'offline');
              if (ok) listOllamaModels(endpoint).then(setModels);
            });
          }}
        >
          Test
        </button>
      </div>
      {status === 'connected' && models.length > 0 && (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="settings-ollama-model">Model</label>
          <select
            id="settings-ollama-model"
            className="form-select"
            value={currentModel || ''}
            onChange={e => onModelChange(e.target.value)}
          >
            <option value="">Default (qwen3)</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 4 }}>
            qwen3 (8B) recommended for English + Arabic. Smaller models like gemma3 or phi4-mini are faster.
          </div>
        </div>
      )}
    </>
  );
}
