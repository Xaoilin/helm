import { useMemo, useState } from 'react';
import { useGamificationContext } from "../store/contexts/GamificationContext";
import { useTaskContext } from "../store/contexts/TaskContext";
import {
  xpToNextLevel,
  titleForLevel,
  BADGES,
  STREAK_MILESTONES,
} from '../services/gamification';
import { isStandardDailyTask } from '../services/prayerTasks';
import { toLocalDateStr } from '../services/financeHelpers';
import {
  calculatePrayerOutcomeStats,
  filterPrayerTrackingRecords,
} from '../services/prayerTracking';
import { usePrayerContext } from '../store/contexts/PrayerContext';
import PrayerOutcomeBars, {
  PrayerOutcomeLegend,
  PrayerOutcomeStack,
} from '../components/prayer/PrayerOutcomeBars';
import type { PrayerOutcomeStats } from '../types/domain';

export default function ProfileSurface() {
  const gamification = useGamificationContext();
  const tasks = useTaskContext();
  const prayer = usePrayerContext();
  const gam = gamification.gamification;
  const xp = xpToNextLevel(gam.totalXp);
  const title = titleForLevel(gam.level);
  const todayStr = toLocalDateStr(new Date());
  const [referenceTime] = useState(() => Date.now());

  // Stats
  const tasksToday = tasks.tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr)).length;
  const habitsToday = tasks.tasks.filter(t => isStandardDailyTask(t) && t.completed).length;
  const goalsCompleted = tasks.tasks.filter(t => t.category === 'goal' && t.completed).length;

  const daysSinceFirst = useMemo(() => {
    if (gam.totalTasksCompleted === 0) return 0;
    const first = tasks.tasks.reduce<string | null>((earliest, t) => {
      if (!earliest) return t.createdAt;
      return t.createdAt < earliest ? t.createdAt : earliest;
    }, null);
    if (!first) return 1;
    return Math.max(1, Math.ceil((referenceTime - new Date(first).getTime()) / 86400000));
  }, [tasks.tasks, gam.totalTasksCompleted, referenceTime]);

  const avgPerDay = gam.totalTasksCompleted > 0 ? (gam.totalTasksCompleted / daysSinceFirst).toFixed(1) : '0';
  const prayerStats = prayer.stats;
  const prayerLast30Days = useMemo(() => {
    const output: Array<{ date: string; stats: PrayerOutcomeStats }> = [];
    for (let index = 29; index >= 0; index -= 1) {
      const date = new Date(referenceTime);
      date.setDate(date.getDate() - index);
      const dateStr = toLocalDateStr(date);
      output.push({
        date: dateStr,
        stats: calculatePrayerOutcomeStats(
          filterPrayerTrackingRecords(prayer.tracking, recordDate => recordDate === dateStr),
          prayer.scheduleDays.filter(day => day.date === dateStr),
          new Date(referenceTime),
        ),
      });
    }
    return output;
  }, [prayer.scheduleDays, prayer.tracking, referenceTime]);
  const prayerMonthlyHistory = useMemo(() => {
    const months = [...new Set([
      ...prayer.scheduleDays.map(day => day.date.slice(0, 7)),
      ...Object.values(prayer.tracking.records).map(record => record.date.slice(0, 7)),
    ])].sort().reverse();
    return months.map(month => {
      const [year, monthNumber] = month.split('-').map(Number);
      return {
        month,
        label: new Date(year, monthNumber - 1, 1).toLocaleDateString([], {
          month: 'long',
          year: 'numeric',
        }),
        stats: calculatePrayerOutcomeStats(
          filterPrayerTrackingRecords(prayer.tracking, recordDate => recordDate.startsWith(month)),
          prayer.scheduleDays.filter(day => day.date.startsWith(month)),
          new Date(referenceTime),
        ),
      };
    });
  }, [prayer.scheduleDays, prayer.tracking, referenceTime]);

  // Streak heatmap: last 30 days
  const heatmapDays = useMemo(() => {
    const days: { date: string; completed: boolean; isToday: boolean }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toLocalDateStr(d);
      const completed = tasks.tasks.some(t => t.completed && t.completedAt?.startsWith(dateStr));
      days.push({ date: dateStr, completed, isToday: i === 0 });
    }
    return days;
  }, [tasks.tasks]);

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
          const dailyHabits = tasks.tasks.filter(isStandardDailyTask);
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

        {/* ── Prayer outcomes ── */}
        <div className="profile-section">
          <h3 className="profile-section-title">Prayer outcomes</h3>
          <PrayerOutcomeBars stats={prayerStats} />
          <div className="profile-prayer-summary">
            {prayerStats.classifiedTotal} classified opportunities over {prayerStats.trackedDays} day{prayerStats.trackedDays === 1 ? '' : 's'}.
            Open and future prayers are pending and excluded.
          </div>

          <div className="profile-prayer-history-block">
            <div className="profile-prayer-history-title">Last 30 days</div>
            <div className="profile-prayer-days" aria-label="Prayer outcomes for the last 30 days">
              {prayerLast30Days.map(day => (
                <div
                  key={day.date}
                  className="profile-prayer-day"
                  title={`${day.date}: ${day.stats.percentages.onTime}% on time, ${day.stats.percentages.late}% late, ${day.stats.percentages.missed}% missed`}
                  role="img"
                  aria-label={`${day.date}: ${day.stats.percentages.onTime}% on time, ${day.stats.percentages.late}% late, ${day.stats.percentages.missed}% missed`}
                >
                  <span className="on-time" style={{ height: `${day.stats.percentages.onTime}%` }} />
                  <span className="late" style={{ height: `${day.stats.percentages.late}%` }} />
                  <span className="missed" style={{ height: `${day.stats.percentages.missed}%` }} />
                </div>
              ))}
            </div>
            <PrayerOutcomeLegend tally={prayerStats} />
          </div>

          <div className="profile-prayer-history-block">
            <div className="profile-prayer-history-title">Month history</div>
            <div className="profile-month-history" aria-label="Prayer outcome history by month">
              {prayerMonthlyHistory.map(period => (
                <div key={period.month} className="profile-month-history-row">
                  <div>
                    <div className="profile-month-history-label">{period.label}</div>
                    <div className="profile-month-history-meta">
                      {period.stats.trackedDays} tracked day{period.stats.trackedDays === 1 ? '' : 's'}
                      {period.month === todayStr.slice(0, 7) ? ' · Current month' : ''}
                    </div>
                  </div>
                  <PrayerOutcomeStack tally={period.stats} label={period.label} />
                  <div className="profile-month-history-value">
                    {period.stats.classifiedTotal}
                    <span>classified</span>
                  </div>
                </div>
              ))}
              {prayerMonthlyHistory.length === 0 && (
                <div className="profile-prayer-empty">Classified metrics begin when this feature is activated.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
