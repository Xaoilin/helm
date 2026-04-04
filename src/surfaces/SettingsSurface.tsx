import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { isSupabaseReady, syncNamespace, isAuthenticated, getCurrentUserId } from '../store/supabase';
import { ELEVENLABS_API_KEY } from '../config';
import { DEFAULT_PROFILE } from '../services/gamification';
import { getAllLocalTimestamps } from '../store/persistence';

export default function SettingsSurface() {
  const app = useApp();
  const { settings } = app;
  const [confirmReset, setConfirmReset] = useState(false);
  const [testAdhan, setTestAdhan] = useState<string | null>(null);

  // Sync preview
  interface SyncConflict { key: string; localCount: number; remoteCount: number; localUpdated: string; remoteUpdated: string; }
  const [syncPreview, setSyncPreview] = useState<SyncConflict[] | null>(null);
  const [syncDirection, setSyncDirection] = useState<Record<string, 'local' | 'remote'>>({});

  // Goal tags
  const [newTag, setNewTag] = useState('');

  // Sync state
  const [sbSyncing, setSbSyncing] = useState(false);
  const [sbSyncResult, setSbSyncResult] = useState<string | null>(null);

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

  // Step 1: Preview what would change
  const previewSync = async () => {
    if (!isSupabaseReady()) {
      setSbSyncResult('Not connected. Save your Supabase credentials first.');
      return;
    }
    setSbSyncing(true);
    setSbSyncResult(null);
    setSyncPreview(null);
    try {
      const { loadAllRemote } = await import('../store/supabase');
      const remoteRows = await loadAllRemote('helm');
      const localData = getAllLocalTimestamps();
      const conflicts: SyncConflict[] = [];
      const directions: Record<string, 'local' | 'remote'> = {};

      // Check each key for differences
      const allKeys = new Set([...localData.keys(), ...remoteRows.map(r => r.key)]);
      for (const key of allKeys) {
        const local = localData.get(key);
        const remote = remoteRows.find(r => r.key === key);
        const localVal = local ? JSON.stringify(local.value) : null;
        const remoteVal = remote ? JSON.stringify(remote.value) : null;

        if (localVal === remoteVal) continue; // identical, skip

        const localCount = local ? (Array.isArray(local.value) ? local.value.length : 1) : 0;
        const remoteCount = remote ? (Array.isArray(remote.value) ? (remote.value as unknown[]).length : 1) : 0;

        conflicts.push({
          key,
          localCount,
          remoteCount,
          localUpdated: local?.updatedAt || 'n/a',
          remoteUpdated: remote?.updated_at || 'n/a',
        });
        // Default: keep local (your current data is truth)
        directions[key] = 'local';
      }

      if (conflicts.length === 0) {
        // No conflicts — just push local to remote
        const localDataMap = getAllLocalTimestamps();
        await syncNamespace('helm', localDataMap, () => {});
        setSbSyncResult('All in sync! Local data pushed to Supabase. No conflicts.');
      } else {
        setSyncPreview(conflicts);
        setSyncDirection(directions);
        setSbSyncResult(`${conflicts.length} difference${conflicts.length !== 1 ? 's' : ''} found. Choose what to keep for each.`);
      }
    } catch (err) {
      setSbSyncResult(`Preview failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSbSyncing(false);
    }
  };

  // Step 2: Apply chosen directions
  const applySync = async () => {
    if (!syncPreview) return;
    setSbSyncing(true);
    try {
      const { loadAllRemote, saveRemote } = await import('../store/supabase');
      const remoteRows = await loadAllRemote('helm');
      let pulled = 0;
      let pushed = 0;

      for (const conflict of syncPreview) {
        const direction = syncDirection[conflict.key] || 'local';
        if (direction === 'remote') {
          // Overwrite local with remote
          const remote = remoteRows.find(r => r.key === conflict.key);
          if (remote) {
            localStorage.setItem(`helm:${conflict.key}`, JSON.stringify(remote.value));
            pulled++;
          }
        } else {
          // Push local to remote
          const raw = localStorage.getItem(`helm:${conflict.key}`);
          if (raw) {
            await saveRemote('helm', conflict.key, JSON.parse(raw));
            pushed++;
          }
        }
      }

      setSyncPreview(null);
      setSbSyncResult(`Done! Kept local for ${pushed} key${pushed !== 1 ? 's' : ''}, pulled remote for ${pulled} key${pulled !== 1 ? 's' : ''}.`);
      if (pulled > 0) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setSbSyncResult(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSbSyncing(false);
    }
  };

  // Quick action: force push all local to remote (no questions)
  const forcePushLocal = async () => {
    if (!isSupabaseReady()) return;
    setSbSyncing(true);
    setSbSyncResult(null);
    try {
      const localData = getAllLocalTimestamps();
      const { saveRemote } = await import('../store/supabase');
      let pushed = 0;
      for (const [key, { value }] of localData) {
        await saveRemote('helm', key, value);
        pushed++;
      }
      setSbSyncResult(`Pushed ${pushed} key${pushed !== 1 ? 's' : ''} to Supabase. Remote now matches local.`);
    } catch (err) {
      setSbSyncResult(`Push failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Data Sync</h3>
        <div className="card">
          <div className="info-box">
            Your data syncs online via Supabase. Sign in with Google in the sidebar to access your data on any device.
          </div>
          <div className="actions-row" style={{ marginTop: 4 }}>
            <button className="btn btn-secondary btn-sm" onClick={previewSync} disabled={sbSyncing || !isSupabaseReady()}>
              {sbSyncing ? 'Checking...' : 'Sync Preview'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={forcePushLocal} disabled={sbSyncing || !isSupabaseReady()} title="Push all local data to Supabase without pulling anything">
              Force Push Local
            </button>
            <span style={{ fontSize: 11, color: isSupabaseReady() ? '#3ab553' : '#6b6f85' }}>
              {isSupabaseReady() ? (isAuthenticated() ? `Signed in (${getCurrentUserId()?.slice(0, 8)}...)` : 'Connected (anonymous)') : 'Not connected'}
            </span>
          </div>
          {sbSyncResult && (
            <div className="info-box" style={{ marginTop: 8 }}>
              {sbSyncResult}
            </div>
          )}
          {/* Sync conflict preview */}
          {syncPreview && syncPreview.length > 0 && (
            <div style={{ marginTop: 12, background: '#13151c', border: '1px solid #242740', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e1e4ea', marginBottom: 8 }}>Choose what to keep for each data collection:</div>
              <div style={{ fontSize: 11, color: '#f0c040', marginBottom: 12 }}>
                Default: Keep Local (your current data). Switch to "Remote" only if you want to overwrite with Supabase data.
              </div>
              {syncPreview.map(c => (
                <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #1e2030' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e1e4ea' }}>{c.key}</div>
                    <div style={{ fontSize: 10, color: '#6b6f85' }}>
                      Local: {c.localCount} item{c.localCount !== 1 ? 's' : ''} &middot; Remote: {c.remoteCount} item{c.remoteCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className={`btn btn-sm ${syncDirection[c.key] === 'local' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setSyncDirection(prev => ({ ...prev, [c.key]: 'local' }))}
                      style={{ fontSize: 10, padding: '2px 8px' }}
                    >
                      Keep Local ({c.localCount})
                    </button>
                    <button
                      className={`btn btn-sm ${syncDirection[c.key] === 'remote' ? 'btn-danger' : 'btn-secondary'}`}
                      onClick={() => setSyncDirection(prev => ({ ...prev, [c.key]: 'remote' }))}
                      style={{ fontSize: 10, padding: '2px 8px' }}
                    >
                      Use Remote ({c.remoteCount})
                    </button>
                  </div>
                </div>
              ))}
              <div className="actions-row" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={applySync} disabled={sbSyncing}>Apply Choices</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSyncPreview(null)}>Cancel</button>
              </div>
            </div>
          )}
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
                Continuously listens for "Hey Lina" in the background. Uses more battery and bandwidth. Click-to-talk always works regardless.
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={settings.wakeWordEnabled === true} onChange={e => app.updateSettings({ wakeWordEnabled: e.target.checked })} aria-label="Toggle wake word" />
              <span className="slider" />
            </label>
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
            </div>
          )}
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
