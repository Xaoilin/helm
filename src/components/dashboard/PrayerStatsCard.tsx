import type { Task, GamificationProfile } from '../../types/domain';
import { calculatePrayerStats } from '../../services/gamification';

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface PrayerStatsCardProps {
  prayerStats: ReturnType<typeof calculatePrayerStats>;
  prayerHabits: Task[];
  gam: GamificationProfile;
  todayStr: string;
  showPrayerLog: boolean;
  onTogglePrayerLog: () => void;
  onBackfillPrayerLog: (taskId: string, dateStr: string, completed: boolean) => void;
}

export default function PrayerStatsCard({
  prayerStats,
  prayerHabits,
  gam,
  todayStr,
  showPrayerLog,
  onTogglePrayerLog,
  onBackfillPrayerLog,
}: PrayerStatsCardProps) {
  if (prayerStats.perPrayer.length === 0) return null;

  // Build last 7 days for the prayer log editor
  const last7Days: { dateStr: string; label: string }[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = toLocalDateStr(d);
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : dayNames[d.getDay()];
    last7Days.push({ dateStr: ds, label });
  }

  const logDates = Object.keys(gam.dailyLog || {}).sort();
  const startDate = logDates.length > 0 ? logDates[0] : null;

  return (
    <div className="dash-card" style={{ marginBottom: 16 }}>
      <div className="dash-card-header">
        <span>{'\u{1F64F}'} Prayer Rate</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 10, padding: '3px 8px' }}
            onClick={onTogglePrayerLog}
          >
            {showPrayerLog ? 'Close' : 'Edit Log'}
          </button>
          <span style={{ fontSize: 18, fontWeight: 700, color: prayerStats.overall.percentage >= 80 ? '#22c55e' : prayerStats.overall.percentage >= 50 ? '#f59e0b' : '#ff6b6b' }}>
            {prayerStats.overall.percentage}%
          </span>
        </div>
      </div>

      {/* Prayer Log Editor */}
      {showPrayerLog && (
        <div style={{ marginBottom: 14, padding: 12, background: '#13151c', borderRadius: 8, border: '1px solid #1e2030' }}>
          <div style={{ fontSize: 11, color: '#6b6f85', marginBottom: 8 }}>
            Check off prayers you completed but forgot to log. No XP awarded — this only corrects your stats.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#6b6f85', fontWeight: 500 }}>Day</th>
                  {prayerHabits.map(h => {
                    const name = h.prayerName || h.title;
                    return (
                      <th key={h.id} style={{ textAlign: 'center', padding: '4px 6px', color: '#8b8fa3', fontWeight: 500, fontSize: 11 }}>
                        {name.charAt(0).toUpperCase() + name.slice(1)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {last7Days.map(({ dateStr, label }) => {
                  const isToday = dateStr === todayStr;
                  const dayLog = gam.dailyLog?.[dateStr] || [];
                  return (
                    <tr key={dateStr} style={{ borderTop: '1px solid #1e2030' }}>
                      <td style={{ padding: '6px 8px', color: isToday ? '#7c8aff' : '#e1e4ea', fontWeight: isToday ? 600 : 400, fontSize: 12 }}>
                        {label}
                        <span style={{ fontSize: 10, color: '#4a4e62', marginLeft: 6 }}>{dateStr.slice(5)}</span>
                      </td>
                      {prayerHabits.map(h => {
                        const checked = dayLog.includes(h.id);
                        return (
                          <td key={h.id} style={{ textAlign: 'center', padding: '6px 6px' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isToday}
                              onChange={e => onBackfillPrayerLog(h.id, dateStr, e.target.checked)}
                              title={isToday ? 'Use the habit cards above for today' : `${label}: ${h.title}`}
                              style={{ cursor: isToday ? 'default' : 'pointer', width: 16, height: 16, accentColor: '#22c55e' }}
                              aria-label={`${h.title} on ${label}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="prayer-stats-grid">
        {prayerStats.perPrayer.map(p => (
          <div key={p.name} className="prayer-stat-item">
            <div className="prayer-stat-name">{p.name}</div>
            <div className="prayer-stat-bar">
              <div className="prayer-stat-fill" style={{ width: `${p.percentage}%`, background: p.percentage >= 80 ? '#22c55e' : p.percentage >= 50 ? '#f59e0b' : '#ff6b6b' }} />
            </div>
            <div className="prayer-stat-pct">{p.percentage}%</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 8 }}>
        Based on {logDates.length} days of tracking{startDate && ` \u00b7 Since ${new Date(startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
      </div>
    </div>
  );
}
