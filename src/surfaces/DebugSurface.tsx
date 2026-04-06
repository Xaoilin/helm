import { useState } from 'react';
import WakeWordDebug from '../components/debug/WakeWordDebug';

type DebugTab = 'wakeword' | 'audio' | 'network';

export default function DebugSurface() {
  const [tab, setTab] = useState<DebugTab>('wakeword');

  const tabs: { id: DebugTab; label: string; icon: string }[] = [
    { id: 'wakeword', label: 'Wake Word', icon: '🎤' },
    { id: 'audio', label: 'Audio Pipeline', icon: '🔊' },
    { id: 'network', label: 'Network / APIs', icon: '🌐' },
  ];

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Debug</h1>
          <div className="subtitle">Diagnostic tools for troubleshooting</div>
        </div>
      </div>
      <div className="surface-body">
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'wakeword' && <WakeWordDebug />}
        {tab === 'audio' && (
          <div className="card" style={{ padding: 20, color: '#6b6f85' }}>
            Audio pipeline debugging — coming soon. Will test Deepgram STT, ElevenLabs TTS, and browser audio routing.
          </div>
        )}
        {tab === 'network' && (
          <div className="card" style={{ padding: 20, color: '#6b6f85' }}>
            Network / API debugging — coming soon. Will test Ollama, Supabase, Google Calendar, and Monzo connectivity with circuit breaker status.
          </div>
        )}
      </div>
    </>
  );
}
