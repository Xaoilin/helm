import { useState } from 'react';
import AiDebug from '../components/debug/AiDebug';
import CalendarBackendStatus from '../components/dashboard/CalendarBackendStatus';
import PersistenceDebug from '../components/debug/PersistenceDebug';
import WakeWordDebug from '../components/debug/WakeWordDebug';
import PrayerDebug from '../components/debug/PrayerDebug';
import OperationalDebug from '../components/debug/OperationalDebug';
import { ASSISTANT_ENABLED, VOICE_ENABLED } from '../config/deprecatedFeatures';

type DebugTab = 'wakeword' | 'ai' | 'audio' | 'network' | 'prayer' | 'persistence' | 'operations';

const DEBUG_TABS: { id: DebugTab; label: string; icon: string; enabled: boolean }[] = [
  { id: 'wakeword', label: 'Wake Word', icon: '🎤', enabled: VOICE_ENABLED },
  { id: 'ai', label: 'AI Assistant', icon: '🧠', enabled: ASSISTANT_ENABLED },
  { id: 'audio', label: 'Audio Pipeline', icon: '🔊', enabled: VOICE_ENABLED },
  { id: 'network', label: 'Network / APIs', icon: '🌐', enabled: true },
  { id: 'prayer', label: 'Prayer', icon: '🕌', enabled: true },
  { id: 'persistence', label: 'Persistence', icon: '💾', enabled: true },
  { id: 'operations', label: 'Operations', icon: '📊', enabled: true },
];

export default function DebugSurface() {
  const tabs = DEBUG_TABS.filter(t => t.enabled);
  const [tab, setTab] = useState<DebugTab>(tabs[0].id);

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Debug</h1>
          <div className="subtitle">Diagnostic tools for troubleshooting</div>
        </div>
      </div>
      <div className="surface-body">
        <div className="debug-tab-row">
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

        {VOICE_ENABLED && tab === 'wakeword' && <WakeWordDebug />}
        {ASSISTANT_ENABLED && tab === 'ai' && <AiDebug />}
        {VOICE_ENABLED && tab === 'audio' && (
          <div className="card" style={{ padding: 20, color: '#6b6f85' }}>
            Audio pipeline debugging — coming soon. Will test Deepgram STT, ElevenLabs TTS, and browser audio routing.
          </div>
        )}
        {tab === 'network' && (
          // Google Calendar sync runs in the calendar service; its outcome shows on each account.
          <CalendarBackendStatus />
        )}
        {tab === 'prayer' && <PrayerDebug />}
        {tab === 'persistence' && <PersistenceDebug />}
        {tab === 'operations' && <OperationalDebug />}
      </div>
    </>
  );
}
