import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { isSupabaseReady, syncNamespace } from '../store/supabase';
import { DEFAULT_PROFILE } from '../services/gamification';
import { getAllLocalTimestamps } from '../store/persistence';

export default function SettingsSurface() {
  const app = useApp();
  const { settings } = app;
  const [clientIdInput, setClientIdInput] = useState(settings.googleOAuthClientId || '');
  const [clientIdSaved, setClientIdSaved] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);
  const [testAdhan, setTestAdhan] = useState<string | null>(null);

  // Goal tags
  const [newTag, setNewTag] = useState('');

  // Supabase settings
  const [sbUrl, setSbUrl] = useState(settings.supabaseUrl || '');
  const [sbKey, setSbKey] = useState(settings.supabaseAnonKey || '');
  const [sbSaved, setSbSaved] = useState(false);
  const [sbSyncing, setSbSyncing] = useState(false);
  const [sbSyncResult, setSbSyncResult] = useState<string | null>(null);

  const saveClientId = () => {
    app.updateSettings({ googleOAuthClientId: clientIdInput.trim() || undefined });
    setClientIdSaved(true);
    setTimeout(() => setClientIdSaved(false), 2000);
  };

  const saveSupabase = () => {
    app.updateSettings({
      supabaseUrl: sbUrl.trim() || undefined,
      supabaseAnonKey: sbKey.trim() || undefined,
    });
    setSbSaved(true);
    setTimeout(() => setSbSaved(false), 2000);
  };

  const triggerSync = async () => {
    if (!isSupabaseReady()) {
      setSbSyncResult('Not connected. Save your Supabase credentials first.');
      return;
    }
    setSbSyncing(true);
    setSbSyncResult(null);
    try {
      const localData = getAllLocalTimestamps();
      const result = await syncNamespace('helm', localData, (key, value) => {
        localStorage.setItem(`helm:${key}`, JSON.stringify(value));
      });
      setSbSyncResult(`Synced: ${result.pulled} pulled, ${result.pushed} pushed${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`);
      if (result.pulled > 0) {
        // Reload to pick up remote changes
        window.location.reload();
      }
    } catch (err) {
      setSbSyncResult(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSbSyncing(false);
    }
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Settings</h1>
          <div className="subtitle">Execution, privacy, and preference controls</div>
        </div>
      </div>
      <div className="surface-body">
        {/* Online Persistence (Supabase) */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Online Persistence</h3>
        <div className="card">
          <div className="info-box">
            Connect to Supabase to back up and sync your data online. Data is always saved locally first — Supabase syncs in the background.
            This is a reusable service: all your projects can share the same Supabase database using different namespaces.
          </div>
          <div className="form-group">
            <label htmlFor="settings-sb-url">Supabase Project URL</label>
            <input
              id="settings-sb-url"
              className="form-input"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              value={sbUrl}
              onChange={e => { setSbUrl(e.target.value); setSbSaved(false); }}
              placeholder="https://xxxxx.supabase.co"
            />
          </div>
          <div className="form-group">
            <label htmlFor="settings-sb-key">Supabase Anon Key</label>
            <input
              id="settings-sb-key"
              className="form-input"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              type="password"
              value={sbKey}
              onChange={e => { setSbKey(e.target.value); setSbSaved(false); }}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
            />
          </div>
          <div className="actions-row" style={{ marginTop: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={saveSupabase} style={{ whiteSpace: 'nowrap' }}>
              {sbSaved ? 'Saved' : 'Save'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={triggerSync} disabled={sbSyncing || !isSupabaseReady()}>
              {sbSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <span style={{ fontSize: 11, color: isSupabaseReady() ? '#3ab553' : '#6b6f85' }}>
              {isSupabaseReady() ? 'Connected' : 'Not connected'}
            </span>
          </div>
          {sbSyncResult && (
            <div className="info-box" style={{ marginTop: 8 }}>
              {sbSyncResult}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 8, lineHeight: 1.5 }}>
            <strong>Setup:</strong> Create a free Supabase project at supabase.com. Then run this SQL in the SQL Editor:
            <pre style={{ background: '#0f1117', padding: 8, borderRadius: 4, fontSize: 11, marginTop: 4, overflow: 'auto' }}>
{`CREATE TABLE kv_store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key)
);
ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon"
  ON kv_store FOR ALL USING (true);`}
            </pre>
          </div>
        </div>

        {/* Google Calendar */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Google Calendar</h3>
        <div className="card">
          <div className="form-group">
            <label htmlFor="settings-google-client-id">Google OAuth Client ID</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="settings-google-client-id"
                className="form-input"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                value={clientIdInput}
                onChange={e => { setClientIdInput(e.target.value); setClientIdSaved(false); }}
                placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
              />
              <button className="btn btn-primary btn-sm" onClick={saveClientId} style={{ whiteSpace: 'nowrap' }}>
                {clientIdSaved ? 'Saved' : 'Save'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6b6f85', marginTop: 6, lineHeight: 1.5 }}>
              Required for Google Calendar integration. Create one in{' '}
              <strong>Google Cloud Console</strong> &rarr; APIs &amp; Services &rarr; Credentials &rarr; OAuth 2.0 Client ID (Web application).
              <br />
              Add <code style={{ fontSize: 11, background: '#0f1117', padding: '1px 4px', borderRadius: 3 }}>http://localhost:5174</code> as an Authorized JavaScript Origin.
              Enable the <strong>Google Calendar API</strong> in your project.
            </div>
          </div>
          <div className="info-box warning" style={{ marginTop: 4 }}>
            OAuth tokens are stored in localStorage. This is acceptable for local development but not recommended for production deployments.
          </div>
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
          <div className="form-group">
            <label htmlFor="settings-11labs-key">ElevenLabs API Key</label>
            <input id="settings-11labs-key" className="form-input" type="password" value={settings.elevenLabsApiKey || ''} onChange={e => app.updateSettings({ elevenLabsApiKey: e.target.value || undefined })} placeholder="xi-xxxxxxxxxxxxxxxx" />
          </div>
          <div className="form-group">
            <label htmlFor="settings-11labs-voice">ElevenLabs Voice ID</label>
            <input id="settings-11labs-voice" className="form-input" value={settings.elevenLabsVoiceId || ''} onChange={e => app.updateSettings({ elevenLabsVoiceId: e.target.value || undefined })} placeholder="Voice ID from ElevenLabs dashboard" />
          </div>
          <div style={{ fontSize: 11, color: '#6b6f85', lineHeight: 1.5 }}>
            <strong>Setup:</strong> Go to <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" style={{ color: '#4f5bff' }}>elevenlabs.io</a> &rarr;
            clone Lina's voice from a recording &rarr; copy your API key and Voice ID &rarr; paste above.
            <br />Without ElevenLabs, Lina will use the browser's built-in voice (less natural).
          </div>
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
            <strong>HELM</strong> v0.1.0<br />
            <span style={{ color: '#6b6f85' }}>
              Local-first personal assistant for software engineers.<br />
              Built with Tauri + React + TypeScript + Rust.
            </span>
          </div>
          <div className="info-box" style={{ marginTop: 12 }}>
            <strong>What's mocked in this version:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              <li>AI/LLM chat responses (returns canned replies)</li>
              <li>Integration OAuth flows (simulated connections)</li>
              <li>Calendar sync (local events only, no live sync)</li>
              <li>1Password CLI integration (local vault fallback active)</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
