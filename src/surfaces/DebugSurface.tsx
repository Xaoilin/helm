import { useState } from 'react';
import CalendarBackendStatus from '../components/dashboard/CalendarBackendStatus';
import PersistenceDebug from '../components/debug/PersistenceDebug';
import PrayerDebug from '../components/debug/PrayerDebug';
import OperationalDebug from '../components/debug/OperationalDebug';

type DebugTab = 'network' | 'prayer' | 'persistence' | 'operations';

const DEBUG_TABS: { id: DebugTab; label: string; icon: string }[] = [
  { id: 'network', label: 'Network / APIs', icon: '🌐' },
  { id: 'prayer', label: 'Prayer', icon: '🕌' },
  { id: 'persistence', label: 'Persistence', icon: '💾' },
  { id: 'operations', label: 'Operations', icon: '📊' },
];

export default function DebugSurface() {
  const [tab, setTab] = useState<DebugTab>('network');

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
          {DEBUG_TABS.map(t => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

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
