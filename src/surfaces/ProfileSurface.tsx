import { useMemo } from 'react';
import { useApp } from '../store/AppContext';
import {
  xpToNextLevel,
  titleForLevel,
  BADGES,
  STREAK_MILESTONES,
  calculatePrayerStats,
} from '../services/gamification';

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProfileSurface() {
  const app = useApp();
  const gam = app.gamification;
  const xp = xpToNextLevel(gam.totalXp);
  const title = titleForLevel(gam.level);
  const todayStr = toLocalDateStr(new Date());

  // Stats
  const tasksToday = app.tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr)).length;
  const habitsToday = app.tasks.filter(t => t.category === 'daily' && t.completed).length;
  const goalsCompleted = app.tasks.filter(t => t.category === 'goal' && t.completed).length;

  const daysSinceFirst = useMemo(() => {
    if (gam.totalTasksCompleted === 0) return 0;
    const first = app.tasks.reduce<string | null>((earliest, t) => {
      if (!earliest) return t.createdAt;
      return t.createdAt < earliest ? t.createdAt : earliest;
    }, null);
    if (!first) return 1;
    return Math.max(1, Math.ceil((Date.now() - new Date(first).getTime()) / 86400000));
  }, [app.tasks, gam.totalTasksCompleted]);

  const avgPerDay = gam.totalTasksCompleted > 0 ? (gam.totalTasksCompleted / daysSinceFirst).toFixed(1) : '0';

  // Streak heatmap: last 30 days
  const heatmapDays = useMemo(() => {
    const days: { date: string; completed: boolean; isToday: boolean }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateStr(d);
      const completed = app.tasks.some(t => t.completed && t.completedAt?.startsWith(dateStr));
      days.push({ date: dateStr, completed, isToday: i === 0 });
    }
    return days;
  }, [app.tasks]);

  // Next streak milestone
  const nextMilestone = STREAK_MILESTONES.find(m => m > gam.currentStreak) || null;

  // Earned badge set
  const earnedSet = new Set(gam.badges);

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Profile</h1>
          <div className="subtitle">Your achievements, stats, and progress</div>
        </div>
      </div>
      <div className="surface-body">

        {/* ── Hero: Level & XP ── */}
        <div className="profile-hero">
          <div className="profile-level-circle">
            <div className="profile-level-num">{gam.level}</div>
            <div className="profile-level-title">{title}</div>
          </div>
          <div className="profile-xp-info">
            <div className="profile-xp-total">{gam.totalXp.toLocaleString()} XP</div>
            <div className="profile-xp-bar-container">
              <div className="gam-xp-bar" style={{ height: 10 }}>
                <div className="gam-xp-fill" style={{ width: `${xp.progress * 100}%` }} />
              </div>
              <div className="profile-xp-label">
                {xp.current} / {xp.needed} XP to Level {gam.level + 1}
              </div>
            </div>
            <div className="profile-meta-row">
              <span>{gam.totalTasksCompleted} tasks completed</span>
              <span>{avgPerDay} avg/day</span>
            </div>
          </div>
        </div>

        {/* ── Streak ── */}
        <div className="profile-section">
          <h3 className="profile-section-title">Streak</h3>
          <div className="profile-streak-row">
            <div className="profile-streak-current">
              {gam.currentStreak > 0 ? (
                <>
                  <span className="gam-streak-fire">{'\u{1F525}'}</span>
                  <span className="profile-streak-num">{gam.currentStreak}</span>
                  <span className="profile-streak-label">day{gam.currentStreak !== 1 ? 's' : ''}</span>
                </>
              ) : (
                <span className="profile-streak-label" style={{ color: '#6b6f85' }}>No active streak</span>
              )}
            </div>
            <div className="profile-streak-best">
              Best: <strong>{gam.longestStreak}</strong> day{gam.longestStreak !== 1 ? 's' : ''}
            </div>
            {nextMilestone && gam.currentStreak > 0 && (
              <div className="profile-streak-next">
                Next milestone: {nextMilestone} days ({nextMilestone - gam.currentStreak} to go)
              </div>
            )}
          </div>

          {/* Heatmap */}
          <div className="profile-heatmap" aria-label="Last 30 days activity">
            {heatmapDays.map(day => (
              <div
                key={day.date}
                className={`profile-heatmap-cell ${day.completed ? 'active' : ''} ${day.isToday ? 'today' : ''}`}
                title={`${day.date}${day.completed ? ' \u2714' : ''}`}
              />
            ))}
          </div>
          <div className="profile-heatmap-legend">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </div>

        {/* ── Badges ── */}
        <div className="profile-section">
          <h3 className="profile-section-title">
            Badges <span style={{ fontWeight: 400, color: '#6b6f85' }}>({gam.badges.length} / {BADGES.length})</span>
          </h3>
          {(['common', 'rare', 'epic', 'legendary'] as const).map(rarity => {
            const group = BADGES.filter(b => b.rarity === rarity);
            const earnedCount = group.filter(b => earnedSet.has(b.id)).length;
            const labels = { common: 'Early Game', rare: 'Mid Game', epic: 'Late Game', legendary: 'Endgame' };
            return (
              <div key={rarity} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6b6f85', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {labels[rarity]} <span style={{ fontWeight: 400 }}>({earnedCount}/{group.length})</span>
                </div>
                <div className="profile-badges-grid">
                  {group.map(badge => {
                    const earned = earnedSet.has(badge.id);
                    return (
                      <div key={badge.id} className={`profile-badge-card ${badge.rarity} ${earned ? 'earned' : 'locked'}`}>
                        <div className="profile-badge-emoji">{earned ? badge.emoji : '?'}</div>
                        <div className="profile-badge-name">{badge.name}</div>
                        <div className="profile-badge-desc">{badge.description}</div>
                        <div className={`profile-badge-rarity ${badge.rarity}`}>{badge.rarity}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Stats ── */}
        <div className="profile-section">
          <h3 className="profile-section-title">Stats</h3>
          <div className="profile-stats-grid">
            <div className="profile-stat-card">
              <div className="profile-stat-num">{tasksToday}</div>
              <div className="profile-stat-label">Completed today</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-num">{habitsToday}</div>
              <div className="profile-stat-label">Habits done today</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-num">{gam.totalTasksCompleted}</div>
              <div className="profile-stat-label">All time</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-num">{goalsCompleted}</div>
              <div className="profile-stat-label">Goals completed</div>
            </div>
          </div>
        </div>

        {/* ── Habit Tallies ── */}
        {(() => {
          const dailyHabits = app.tasks.filter(t => t.category === 'daily');
          const tallies = gam.habitTallies || {};
          if (dailyHabits.length === 0) return null;
          return (
            <div className="profile-section">
              <h3 className="profile-section-title">Habit Completions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dailyHabits.map(h => {
                  const count = tallies[h.id] || 0;
                  return (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#e1e4ea', minWidth: 140 }}>{h.title}</span>
                      <div style={{ flex: 1, height: 6, background: '#242740', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, count)}%`, background: '#4f5bff', borderRadius: 3, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#9499b0', minWidth: 40, textAlign: 'right' }}>{count}x</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Prayer Rate ── */}
        {(() => {
          const prayerStats = calculatePrayerStats(gam, app.tasks);
          if (prayerStats.perPrayer.length === 0) return null;
          return (
            <div className="profile-section">
              <h3 className="profile-section-title">
                Prayer Rate
                <span style={{ fontWeight: 400, color: prayerStats.overall.percentage >= 80 ? '#22c55e' : prayerStats.overall.percentage >= 50 ? '#f59e0b' : '#ff6b6b', marginLeft: 8 }}>
                  {prayerStats.overall.percentage}% overall
                </span>
              </h3>
              <div className="prayer-stats-grid" style={{ marginBottom: 16 }}>
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
              <div style={{ fontSize: 11, color: '#6b6f85' }}>
                {prayerStats.overall.completed} / {prayerStats.overall.total} total prayers tracked over {Object.keys(gam.dailyLog || {}).length} days
              </div>
              {/* 30-day heatmap for prayers */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: '#6b6f85', marginBottom: 4 }}>Last 30 days</div>
                <div className="profile-heatmap" aria-label="Prayer completion last 30 days">
                  {prayerStats.last30Days.map(day => (
                    <div
                      key={day.date}
                      className={`profile-heatmap-cell ${day.count >= prayerStats.perPrayer.length ? 'active' : day.count > 0 ? 'partial' : ''}`}
                      title={`${day.date}: ${day.count}/${prayerStats.perPrayer.length} prayers`}
                      style={day.count > 0 && day.count < prayerStats.perPrayer.length ? { background: '#f59e0b' } : undefined}
                    />
                  ))}
                </div>
                <div className="profile-heatmap-legend">
                  <span>30 days ago</span>
                  <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#6b6f85' }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#1e2030', borderRadius: 2, marginRight: 3 }} />Missed</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#f59e0b', borderRadius: 2, marginRight: 3 }} />Partial</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: '#22c55e', borderRadius: 2, marginRight: 3 }} />All 5</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
