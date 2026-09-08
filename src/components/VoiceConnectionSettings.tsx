import { useEffect, useState } from 'react';
import { ELEVENLABS_VOICE_ID } from '../config';
import { useSettingsContext } from '../store/contexts/SettingsContext';
import { listHelmSecrets } from '../store/supabase';
import type { HelmSecretSummary } from '../types/domain';

export function VoiceConnectionSettings() {
  const { settings, updateSettings } = useSettingsContext();
  const [entries, setEntries] = useState<HelmSecretSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void listHelmSecrets().then(result => {
      if (active) setEntries(result.secrets.filter(entry => entry.kind === 'api_key' && !entry.archivedAt));
    }).catch(() => {
      if (active) setError('Could not load voice references. Sign in again or retry. Browser speech is still available.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const selected = settings.elevenLabsSecretId || '';
  return (
    <div style={{ marginTop: 12 }}>
      <div className="form-group">
        <label htmlFor="settings-voice-reference">ElevenLabs secret reference</label>
        <select id="settings-voice-reference" className="form-select" value={selected} disabled={loading}
          onChange={event => updateSettings({ elevenLabsSecretId: event.target.value || undefined })}>
          <option value="">Browser speech (no provider key)</option>
          {selected && !entries.some(entry => entry.secretId === selected) && <option value={selected}>Selected reference unavailable</option>}
          {entries.map(entry => <option key={entry.secretId} value={entry.secretId}>{entry.label}</option>)}
        </select>
        <p className="form-hint">Save a dedicated ElevenLabs API key in Secrets, then select it here. This device stores only its reference. The server checks the signed-in account before speaking.</p>
        {error && <div role="alert">{error} <button type="button" className="btn btn-sm" onClick={() => { setError(null); setLoading(true); setAttempt(value => value + 1); }}>Retry voice references</button></div>}
      </div>
      <div className="form-group">
        <label htmlFor="settings-voice-id">ElevenLabs public voice ID</label>
        <input id="settings-voice-id" className="form-input" value={settings.elevenLabsVoiceId || ''}
          placeholder={ELEVENLABS_VOICE_ID || 'Public voice ID'} autoComplete="off" spellCheck={false}
          onChange={event => updateSettings({ elevenLabsVoiceId: event.target.value })} />
      </div>
      <p className="form-hint">{selected ? 'ElevenLabs uses your account Vault. If setup or playback fails, browser speech is used.' : 'Using browser speech.'}</p>
      <p className="form-hint">The hosted AI pause also pauses ElevenLabs. Browser speech remains available.</p>
      <p className="form-hint">Voice input uses browser speech recognition where supported. Deepgram is unavailable until a secure server connection is supplied. Existing device keys remain accessible for migration in Secrets.</p>
    </div>
  );
}
