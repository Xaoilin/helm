import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import HabitCards from '../components/HabitCards';
import {
  getPrayerTimes,
  getNextPrayer,
  isAdhanTime,
  formatTimeUntil,
  PRAYER_SOURCES,
  type PrayerTimesData,
  type PrayerTime as PrayerTimeType,
} from '../services/prayerTimes';
import {
  xpToNextLevel,
  titleForLevel,
  getStreakMultiplier,
  BADGES,
  STREAK_MILESTONES,
  processTaskCompletion,
  buildCompletionContext,
  recordHabitCompletion,
  calculatePrayerStats,
  checkStreakBroken,
} from '../services/gamification';
import type { Task, CalendarEvent } from '../types/domain';

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Toast { id: string; type: 'xp' | 'levelup' | 'badge' | 'streak'; text: string; emoji?: string; }

export default function DashboardSurface() {
  const app = useApp();
  const gam = app.gamification;
  const [tick, setTick] = useState(0);
  const now = useMemo(() => new Date(), [tick]);
  const todayStr = toLocalDateStr(now);
  const hour = now.getHours();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showLevelFlash, setShowLevelFlash] = useState(false);

  // Tick every 30 seconds to update countdown timers
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset daily habits if date changed (so Dashboard shows fresh state without visiting Tasks)
  useEffect(() => {
    const isWeekday = () => { const d = new Date().getDay(); return d >= 1 && d <= 5; };
    const habitsToReset = app.tasks.filter(t => {
      if (t.category !== 'daily' || !t.recurring || !t.completed) return false;
      if (t.recurring.lastReset === todayStr) return false;
      if (t.recurring.frequency === 'weekdays' && !isWeekday()) return false;
      return true;
    });
    for (const t of habitsToReset) {
      app.updateTask(t.id, {
        completed: false,
        completedAt: undefined,
        recurring: { ...t.recurring!, lastReset: todayStr },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  // Prayer times
  const [prayerData, setPrayerData] = useState<PrayerTimesData | null>(null);
  const [adhanPrayer, setAdhanPrayer] = useState<PrayerTimeType | null>(null);
  const adhanShownRef = useRef<Set<string>>(new Set());
  const prayerEnabled = app.settings.prayerEnabled !== false;
  const prayerCity = app.settings.prayerCity || 'Bedford';
  const prayerCountry = app.settings.prayerCountry || 'United Kingdom';

  // Fetch prayer times on mount
  useEffect(() => {
    if (!prayerEnabled) return;
    getPrayerTimes(prayerCity, prayerCountry).then(setPrayerData).catch(err => console.warn('Prayer times fetch failed:', err));
  }, [prayerEnabled, prayerCity, prayerCountry]);

  // Poll for Adhan every 30 seconds
  useEffect(() => {
    if (!prayerEnabled || !prayerData) return;
    const check = () => {
      const adhan = isAdhanTime(prayerData.prayers);
      if (adhan && !adhanShownRef.current.has(adhan.name)) {
        setAdhanPrayer(adhan);
        adhanShownRef.current.add(adhan.name);
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`${adhan.nameArabic} - ${adhan.name}`, { body: `It's time for ${adhan.name} prayer`, icon: '\u{1F54C}' });
        } else if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        // No auto-dismiss — stays until user clicks
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [prayerEnabled, prayerData]);

  const nextPrayer = useMemo(() => prayerData ? getNextPrayer(prayerData.prayers) : null, [prayerData, tick]);

  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const xp = xpToNextLevel(gam.totalXp);
  const title = titleForLevel(gam.level);
  const streakBroken = checkStreakBroken(gam);
  const currentStreak = streakBroken ? 0 : gam.currentStreak;
  const multiplier = getStreakMultiplier(currentStreak);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── Account color palette (same as CalendarSurface) ──
  const ACCOUNT_PALETTES = [
    { bg: '#1a2744', border: '#3b82f6' },
    { bg: '#2a1f3d', border: '#a855f7' },
    { bg: '#1a3328', border: '#22c55e' },
    { bg: '#3d2a1a', border: '#f59e0b' },
    { bg: '#3d1a2a', border: '#ec4899' },
    { bg: '#1a3a3d', border: '#14b8a6' },
    { bg: '#3d2d1a', border: '#f97316' },
    { bg: '#2d1a1a', border: '#ef4444' },
  ];

  const getEventPalette = useMemo(() => {
    const map = new Map<string, typeof ACCOUNT_PALETTES[number]>();
    app.calendarAccounts.forEach((acc, i) => {
      const idx = acc.paletteIndex ?? i;
      map.set(acc.id, ACCOUNT_PALETTES[idx % ACCOUNT_PALETTES.length]);
    });
    return (sourceId: string) => {
      const source = app.calendarSources.find(s => s.id === sourceId);
      if (!source) return null;
      return map.get(source.accountId) || null;
    };
  }, [app.calendarAccounts, app.calendarSources]);

  // ── Derived data ──

  // Visible calendar events
  const visibleSourceIds = useMemo(
    () => new Set(app.calendarSources.filter(s => s.visible).map(s => s.id)),
    [app.calendarSources]
  );

  // Today's calendar events (sorted by start time)
  const todayEvents = useMemo(() => {
    return app.calendarEvents
      .filter(e => visibleSourceIds.has(e.sourceId) && toLocalDateStr(new Date(e.start)) === todayStr)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [app.calendarEvents, visibleSourceIds, todayStr]);

  // Next upcoming event (within 2 hours)
  const nextEvent = useMemo(() => {
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    return todayEvents.find(e => !e.allDay && e.start >= now.toISOString() && e.start <= twoHoursFromNow);
  }, [todayEvents, now]);

  // Imminent event (within 30 min)
  const imminentEvent = useMemo(() => {
    const thirtyMin = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    return todayEvents.find(e => !e.allDay && e.start >= now.toISOString() && e.start <= thirtyMin);
  }, [todayEvents, now]);

  // Daily habits
  const dailyHabits = useMemo(() =>
    app.tasks.filter(t => t.category === 'daily').sort((a, b) => a.completed === b.completed ? 0 : a.completed ? 1 : -1),
    [app.tasks]
  );
  const habitsTotal = dailyHabits.length;
  const habitsDone = dailyHabits.filter(t => t.completed).length;

  // Overdue + due today tasks
  const dueTasks = useMemo(() =>
    app.tasks
      .filter(t => t.category === 'task' && !t.completed && t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => {
        const po = { high: 0, medium: 1, low: 2 };
        return po[a.priority] - po[b.priority];
      }),
    [app.tasks, todayStr]
  );
  const overdueTasks = dueTasks.filter(t => t.dueDate! < todayStr);

  // Active goals (top 2 by priority)
  const activeGoals = useMemo(() => {
    const po: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return app.tasks
      .filter(t => t.category === 'goal' && !t.completed)
      .sort((a, b) => po[a.priority] - po[b.priority])
      .slice(0, 2);
  }, [app.tasks]);

  // ── "Up Next" priority logic ──
  const upNext = useMemo((): { type: 'event' | 'task' | 'habit' | 'clear'; item?: CalendarEvent | Task; label: string; sublabel: string } => {
    if (imminentEvent) {
      const mins = Math.round((new Date(imminentEvent.start).getTime() - now.getTime()) / 60000);
      return {
        type: 'event',
        item: imminentEvent,
        label: imminentEvent.title,
        sublabel: mins <= 0 ? 'Starting now' : `Starts in ${mins} min${mins !== 1 ? 's' : ''}${imminentEvent.location ? ` \u00b7 ${imminentEvent.location}` : ''}`,
      };
    }
    if (overdueTasks.length > 0) {
      const task = overdueTasks[0];
      return { type: 'task', item: task, label: task.title, sublabel: `Overdue since ${task.dueDate}` };
    }
    const pendingHabit = dailyHabits.find(h => !h.completed);
    if (pendingHabit) {
      return { type: 'habit', item: pendingHabit, label: pendingHabit.title, sublabel: `Daily habit \u00b7 ${habitsDone}/${habitsTotal} done` };
    }
    if (dueTasks.length > 0) {
      const task = dueTasks[0];
      return { type: 'task', item: task, label: task.title, sublabel: `Due today \u00b7 ${task.priority} priority` };
    }
    if (nextEvent) {
      return {
        type: 'event',
        item: nextEvent,
        label: nextEvent.title,
        sublabel: `At ${new Date(nextEvent.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} – ${new Date(nextEvent.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}${nextEvent.location ? ` \u00b7 ${nextEvent.location}` : ''}`,
      };
    }
    return { type: 'clear', label: "You're all caught up", sublabel: 'No urgent tasks or upcoming meetings. Nice work!' };
  }, [imminentEvent, overdueTasks, dailyHabits, dueTasks, nextEvent, habitsDone, habitsTotal, now]);

  // ── Next milestone ──
  const nextMilestone = useMemo((): { label: string; progress: number; current: number; target: number; emoji: string } | null => {
    const earnedSet = new Set(gam.badges);

    // Check streak milestones
    const nextStreakM = STREAK_MILESTONES.find(m => m > currentStreak);
    if (nextStreakM && currentStreak > 0) {
      const badge = BADGES.find(b => b.id === `streak-${nextStreakM}`);
      if (badge && !earnedSet.has(badge.id)) {
        return { label: badge.name, progress: currentStreak / nextStreakM, current: currentStreak, target: nextStreakM, emoji: badge.emoji };
      }
    }

    // Check next level
    if (xp.progress < 1) {
      return { label: `Level ${gam.level + 1}`, progress: xp.progress, current: xp.current, target: xp.needed, emoji: '\u{1F31F}' };
    }

    // Check task count milestones
    if (gam.totalTasksCompleted < 100 && !earnedSet.has('century')) {
      return { label: 'Century', progress: gam.totalTasksCompleted / 100, current: gam.totalTasksCompleted, target: 100, emoji: '\u{1F4AF}' };
    }

    // Check first badge
    if (!earnedSet.has('first-blood')) {
      return { label: 'First Blood', progress: 0, current: 0, target: 1, emoji: '\u{1F3AF}' };
    }

    return null;
  }, [gam, currentStreak, xp]);

  // ── Agenda timeline (max 8 items) ──
  type AgendaItem = { id: string; time: string; title: string; type: 'event' | 'task'; meta?: string; task?: Task; sourceId?: string; passed?: boolean };
  const agenda = useMemo((): AgendaItem[] => {
    const items: AgendaItem[] = [];

    // Calendar events today (all-day first, then timed)
    for (const e of todayEvents) {
      items.push({
        id: `ev-${e.id}`,
        time: e.allDay ? 'All day' : `${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} – ${new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`,
        title: e.title,
        type: 'event',
        meta: e.location,
        sourceId: e.sourceId,
        passed: !e.allDay && new Date(e.end) < now,
      });
    }

    // Tasks due today
    for (const t of dueTasks) {
      items.push({
        id: `task-${t.id}`,
        time: 'To do',
        title: t.title,
        type: 'task',
        meta: t.priority !== 'low' ? t.priority : undefined,
        task: t,
      });
    }

    // Sort: all-day events first, then timed events by time, then tasks at end
    items.sort((a, b) => {
      const aAllDay = a.time === 'All day';
      const bAllDay = b.time === 'All day';
      if (aAllDay && !bAllDay) return -1;
      if (!aAllDay && bAllDay) return 1;
      if (a.type === 'event' && b.type === 'task') return -1;
      if (a.type === 'task' && b.type === 'event') return 1;
      return a.time.localeCompare(b.time);
    });

    return items.slice(0, 8);
  }, [todayEvents, dueTasks]);

  // ── Task completion with gamification ──
  const completeTask = (task: Task) => {
    // Already completed — do nothing (locked)
    if (task.completed) return;

    const nowDate = new Date();
    app.updateTask(task.id, {
      completed: true,
      completedAt: nowDate.toISOString(),
      ...(task.recurring ? { recurring: { ...task.recurring, lastReset: todayStr } } : {}),
    });

    // Check if this habit already got XP today
    const todayLog = gam.dailyLog?.[todayStr] || [];
    if (task.category === 'daily' && todayLog.includes(task.id)) return;

    const completionsToday = app.tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr)).length;
    const extCtx = buildCompletionContext(app.tasks, app.settings.goalTags, todayStr, gam, {
      knowledgeEntries: app.knowledgeEntries.length,
      knowledgeTopics: app.knowledgeTopics.length,
      lifestyleHaramMastered: app.lifestyleItems.filter(i => i.type === 'haram' && i.status === 'mastered').length,
      lifestyleHalalConsistent: app.lifestyleItems.filter(i => i.type === 'halal' && i.status === 'consistent').length,
      lifestyleTotal: app.lifestyleItems.length,
    });
    const result = processTaskCompletion(gam, task, completionsToday, nowDate, extCtx);
    let profile = result.updatedProfile;
    if (task.category === 'daily') {
      profile = recordHabitCompletion(profile, task.id, todayStr);
    }
    app.updateGamification(profile);

    addToast({ type: 'xp', text: `+${result.xpEarned} XP`, emoji: '\u2728' });
    if (result.leveledUp) {
      addToast({ type: 'levelup', text: `Level ${result.newLevel}! ${result.newTitle}`, emoji: '\u{1F31F}' });
      setShowLevelFlash(true);
      setTimeout(() => setShowLevelFlash(false), 1000);
    }
    if (result.isStreakMilestone) {
      addToast({ type: 'streak', text: `${result.streakUpdate.currentStreak}-day streak!`, emoji: '\u{1F525}' });
    }
    for (const badge of result.newBadges) {
      addToast({ type: 'badge', text: `${badge.name} unlocked!`, emoji: badge.emoji });
    }
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>{greeting}</h1>
          <div className="subtitle" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="dash-stat">Lv.{gam.level} {title}</span>
            <span className="dash-stat">{gam.totalXp} XP</span>
            {currentStreak > 0 && (
              <span className="dash-stat dash-streak">
                <span className="gam-streak-fire">{'\u{1F525}'}</span>{currentStreak}d
                {multiplier > 1 && <span style={{ fontSize: 10, color: '#f59e0b' }}> ({multiplier}x)</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="surface-body">
        {/* ── Up Next (hero card) ── */}
        <div className={`dash-upnext ${upNext.type}`}>
          <div className="dash-upnext-label">UP NEXT</div>
          <div className="dash-upnext-title">{upNext.label}</div>
          <div className="dash-upnext-sub">{upNext.sublabel}</div>
          {upNext.type === 'habit' && upNext.item && (
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => completeTask(upNext.item as Task)}>
              Complete Habit
            </button>
          )}
          {upNext.type === 'task' && upNext.item && (
            <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => completeTask(upNext.item as Task)}>
              Complete Task
            </button>
          )}
          {upNext.type === 'event' && (
            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => app.navigate('calendar')}>
              View in Calendar
            </button>
          )}
          {upNext.type === 'clear' && (
            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => app.navigate('tasks')}>
              Browse Tasks
            </button>
          )}
        </div>

        <div className="dash-grid">
          {/* ── Today's Agenda ── */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span>Today's Agenda</span>
              <span style={{ fontSize: 11, color: '#6b6f85' }}>{todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''}</span>
            </div>
            {agenda.length === 0 ? (
              <div style={{ padding: '16px 0', color: '#6b6f85', fontSize: 13, textAlign: 'center' }}>No events or tasks today</div>
            ) : (
              <div className="dash-agenda">
                {agenda.map(item => {
                  const pal = item.sourceId ? getEventPalette(item.sourceId) : null;
                  return (
                  <div key={item.id} className={`dash-agenda-item ${item.type} ${item.passed ? 'passed' : ''}`} style={pal ? { borderLeft: `3px solid ${item.passed ? '#2a2d42' : pal.border}`, background: item.passed ? undefined : pal.bg, borderRadius: 4, paddingLeft: 10 } : {}}>
                    <div className="dash-agenda-time">{item.time}</div>
                    <div className="dash-agenda-content">
                      <div className="dash-agenda-title">{item.title}</div>
                      {item.meta && <span className={`tag ${item.type === 'task' ? `tag-${item.meta}` : ''}`} style={item.type === 'event' ? { background: '#1e2030', color: '#9499b0', fontSize: 10, padding: '1px 6px' } : {}}>{item.meta}</span>}
                    </div>
                    {item.task && !item.task.completed && (
                      <button className="btn btn-primary btn-sm" onClick={() => completeTask(item.task!)}>Done</button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            <button className="dash-card-link" onClick={() => app.navigate('calendar')}>See full calendar &rarr;</button>
          </div>

          {/* ── Habits Progress ── */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span>Daily Habits</span>
              <span style={{ fontSize: 11, color: habitsTotal > 0 && habitsDone === habitsTotal ? '#3ab553' : '#6b6f85' }}>
                {habitsTotal > 0 ? `${habitsDone}/${habitsTotal}` : 'None set'}
              </span>
            </div>
            {habitsTotal === 0 ? (
              <div style={{ padding: '16px 0', color: '#6b6f85', fontSize: 13, textAlign: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => app.navigate('tasks')}>+ Add a daily habit</button>
              </div>
            ) : (
              <HabitCards
                habits={dailyHabits}
                onComplete={completeTask}
              />
            )}
          </div>
        </div>

        <div className="dash-grid">
          {/* ── Goals Spotlight ── */}
          <div className="dash-card">
            <div className="dash-card-header">
              <span>Goals</span>
              <span style={{ fontSize: 11, color: '#6b6f85' }}>{app.tasks.filter(t => t.category === 'goal' && !t.completed).length} active</span>
            </div>
            {activeGoals.length === 0 ? (
              <div style={{ padding: '16px 0', color: '#6b6f85', fontSize: 13, textAlign: 'center' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => app.navigate('tasks')}>+ Set a goal</button>
              </div>
            ) : (
              activeGoals.map(goal => (
                <div key={goal.id} className="dash-goal-item">
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13, color: '#e1e4ea', display: 'flex', gap: 6, alignItems: 'center' }}>
                      {goal.title}
                      {goal.goalTag && <span className="tag tag-goal" style={{ fontSize: 10 }}>{goal.goalTag}</span>}
                    </div>
                    {goal.dueDate && <div style={{ fontSize: 11, color: '#6b6f85', marginTop: 2 }}>Target: {goal.dueDate}</div>}
                  </div>
                  <span className={`tag tag-${goal.priority}`}>{goal.priority}</span>
                </div>
              ))
            )}
            <button className="dash-card-link" onClick={() => app.navigate('tasks')}>All goals &rarr;</button>
          </div>

          {/* ── Next Milestone ── */}
          <div className="dash-card dash-milestone">
            <div className="dash-card-header">
              <span>Next Milestone</span>
            </div>
            {nextMilestone ? (
              <div className="dash-milestone-content">
                <div className="dash-milestone-emoji">{nextMilestone.emoji}</div>
                <div className="dash-milestone-info">
                  <div className="dash-milestone-name">{nextMilestone.label}</div>
                  <div className="gam-xp-bar" style={{ height: 8, margin: '6px 0' }}>
                    <div className="gam-xp-fill" style={{ width: `${nextMilestone.progress * 100}%` }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#9499b0' }}>
                    {nextMilestone.current} / {nextMilestone.target}
                    {' '}&middot; {nextMilestone.target - nextMilestone.current} to go
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px 0', color: '#3ab553', fontSize: 13, textAlign: 'center' }}>
                All milestones achieved! You're a legend.
              </div>
            )}
            <button className="dash-card-link" onClick={() => app.navigate('profile')}>View full profile &rarr;</button>
          </div>
        </div>

        {/* ── Recent Achievements ── */}
        {gam.badges.length > 0 && (
          <div className="dash-card" style={{ marginBottom: 16 }}>
            <div className="dash-card-header">
              <span>{'\u{1F3C6}'} Recent Achievements</span>
              <span style={{ fontSize: 11, color: '#6b6f85' }}>{gam.badges.length} earned</span>
            </div>
            <div className="dash-achievements-row">
              {gam.badges.slice(-8).reverse().map(id => {
                const b = BADGES.find(bg => bg.id === id);
                if (!b) return null;
                return (
                  <div key={id} className={`dash-achievement ${b.rarity}`} title={`${b.name}: ${b.description}`}>
                    <div className="dash-achievement-emoji">{b.emoji}</div>
                    <div className="dash-achievement-name">{b.name}</div>
                    <div className={`dash-achievement-rarity ${b.rarity}`}>{b.rarity}</div>
                  </div>
                );
              })}
            </div>
            <button className="dash-card-link" onClick={() => app.navigate('profile')}>View all badges &rarr;</button>
          </div>
        )}

        {/* ── Prayer Stats ── */}
        {(() => {
          const prayerStats = calculatePrayerStats(gam, app.tasks);
          if (prayerStats.perPrayer.length === 0) return null;
          return (
            <div className="dash-card" style={{ marginBottom: 16 }}>
              <div className="dash-card-header">
                <span>{'\u{1F64F}'} Prayer Rate</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: prayerStats.overall.percentage >= 80 ? '#22c55e' : prayerStats.overall.percentage >= 50 ? '#f59e0b' : '#ff6b6b' }}>
                  {prayerStats.overall.percentage}%
                </span>
              </div>
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
              {(() => {
                const logDates = Object.keys(gam.dailyLog || {}).sort();
                const startDate = logDates.length > 0 ? logDates[0] : null;
                return (
                  <div style={{ fontSize: 10, color: '#4a4e62', marginTop: 8 }}>
                    Based on {logDates.length} days of tracking{startDate && ` \u00b7 Since ${new Date(startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* ── Prayer Times ── */}
        {prayerEnabled && prayerData && (
          <div className="dash-card" style={{ marginBottom: 16 }}>
            <div className="dash-card-header">
              <span>{'\u{1F54C}'} Prayer Times &mdash; {prayerCity}</span>
              <span style={{ fontSize: 11, color: '#6b6f85' }}>{prayerData.hijriDate}</span>
            </div>
            <div className="prayer-grid">
              {prayerData.prayers.map(p => {
                const isNext = nextPrayer?.prayer.name === p.name;
                const isPrayer = p.type === 'prayer';
                return (
                  <div key={p.name} className={`prayer-row ${isNext ? 'next' : ''} ${isPrayer ? 'wajib' : 'event'}`}>
                    <div className="prayer-name">
                      {p.name}
                      <span className="prayer-arabic">{p.nameArabic}</span>
                    </div>
                    <div className="prayer-time">{p.time}</div>
                    {isNext && (
                      <div className="prayer-countdown">in {formatTimeUntil(nextPrayer!.minutesUntil)}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="prayer-sources">
              <span style={{ fontSize: 10, color: '#4a4e62' }}>Sources:</span>
              <a href={PRAYER_SOURCES.api.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.api.name}</a>
              <span style={{ color: '#2a2d42' }}>|</span>
              <a href={PRAYER_SOURCES.method.url} target="_blank" rel="noopener noreferrer">{PRAYER_SOURCES.method.name}</a>
              <span style={{ color: '#2a2d42' }}>|</span>
              <a href={PRAYER_SOURCES.verification.url} target="_blank" rel="noopener noreferrer">Verify times</a>
            </div>
          </div>
        )}
      </div>

      {/* Adhan Notification — Full Screen */}
      {adhanPrayer && (
        <div className="adhan-banner" onClick={() => setAdhanPrayer(null)}>
          <div className="adhan-ring" />
          <div className="adhan-ring" />
          <div className="adhan-ring" />
          <div className="adhan-content">
            <div className="adhan-mosque">{'\u{1F54C}'}</div>
            <div className="adhan-text">
              <div className="adhan-title">{'\u0627\u0644\u0644\u0647 \u0623\u0643\u0628\u0631'}</div>
              <div className="adhan-subtitle">Allahu Akbar</div>
              <div className="adhan-subtitle">It's time for <strong>{adhanPrayer.name}</strong> ({adhanPrayer.nameArabic})</div>
              <div className="adhan-time">{adhanPrayer.time}</div>
            </div>
          </div>
          <div className="adhan-dismiss">Tap anywhere when you're ready to dismiss</div>
        </div>
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="gam-toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`gam-toast ${t.type}`}>
              {t.emoji && <span>{t.emoji}</span>}
              {t.text}
            </div>
          ))}
        </div>
      )}
      {showLevelFlash && <div className="gam-levelup-flash" />}
    </>
  );
}
