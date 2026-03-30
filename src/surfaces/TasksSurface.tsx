import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import type { Task, TaskCategory, TaskPriority } from '../types/domain';
import {
  processTaskCompletion,
  checkStreakBroken,
  xpToNextLevel,
  titleForLevel,
  getBadgeDef,
} from '../services/gamification';

type Tab = 'today' | 'all' | 'goals';

interface Toast {
  id: string;
  type: 'xp' | 'levelup' | 'badge' | 'streak';
  text: string;
  emoji?: string;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TasksSurface() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('today');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showLevelFlash, setShowLevelFlash] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [category, setCategory] = useState<TaskCategory>('task');
  const [dueDate, setDueDate] = useState('');
  const [recurringFreq, setRecurringFreq] = useState<'daily' | 'weekdays' | 'weekly'>('daily');
  const [goalTag, setGoalTag] = useState('');

  // Filters
  const [filterGoalTag, setFilterGoalTag] = useState<string>('all');

  // Filters for All Tasks tab
  const [filterCategory, setFilterCategory] = useState<'all' | 'daily' | 'task'>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | TaskPriority>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');

  const todayStr = toLocalDateStr(new Date());
  const isWeekday = () => { const d = new Date().getDay(); return d >= 1 && d <= 5; };

  // ── Recurring reset ──
  useEffect(() => {
    const habitsToReset = app.tasks.filter(t => {
      if (t.category !== 'daily' || !t.recurring || !t.completed) return false;
      if (t.recurring.lastReset === todayStr) return false;
      // Weekday-only habits: don't reset on weekends
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

  // Check if streak was broken (missed a day)
  useEffect(() => {
    if (checkStreakBroken(app.gamification) && app.gamification.currentStreak > 0) {
      app.updateGamification({ ...app.gamification, currentStreak: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  // Toast helpers
  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── Derived data ──
  const dailyHabits = useMemo(() =>
    app.tasks
      .filter(t => t.category === 'daily')
      .sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1)),
    [app.tasks]
  );

  const dueTodayTasks = useMemo(() =>
    app.tasks
      .filter(t => t.category === 'task' && t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      }),
    [app.tasks, todayStr]
  );

  const todayItems = useMemo(() => [...dailyHabits, ...dueTodayTasks], [dailyHabits, dueTodayTasks]);
  const todayDone = todayItems.filter(t => t.completed).length;
  const todayTotal = todayItems.length;

  const allTasks = useMemo(() => {
    let filtered = app.tasks.filter(t => t.category !== 'goal');
    if (filterCategory !== 'all') filtered = filtered.filter(t => t.category === filterCategory);
    if (filterPriority !== 'all') filtered = filtered.filter(t => t.priority === filterPriority);
    if (filterStatus === 'active') filtered = filtered.filter(t => !t.completed);
    if (filterStatus === 'completed') filtered = filtered.filter(t => t.completed);

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return filtered.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
  }, [app.tasks, filterCategory, filterPriority, filterStatus]);

  const goalTags = useMemo(() => app.settings.goalTags || [], [app.settings.goalTags]);

  const activeGoals = useMemo(() => {
    let goals = app.tasks.filter(t => t.category === 'goal' && !t.completed);
    if (filterGoalTag === '') goals = goals.filter(g => !g.goalTag);
    else if (filterGoalTag !== 'all') goals = goals.filter(g => g.goalTag === filterGoalTag);
    return goals;
  }, [app.tasks, filterGoalTag]);
  const completedGoals = useMemo(() => {
    let goals = app.tasks.filter(t => t.category === 'goal' && t.completed);
    if (filterGoalTag === '') goals = goals.filter(g => !g.goalTag);
    else if (filterGoalTag !== 'all') goals = goals.filter(g => g.goalTag === filterGoalTag);
    return goals;
  }, [app.tasks, filterGoalTag]);

  // ── Actions ──
  const openAdd = (defaultCategory?: TaskCategory) => {
    setTitle(''); setDescription(''); setPriority('medium');
    setCategory(defaultCategory || (tab === 'goals' ? 'goal' : 'task'));
    setDueDate(tab === 'today' ? todayStr : '');
    setRecurringFreq('daily');
    setGoalTag(filterGoalTag !== 'all' ? filterGoalTag : '');
    setEditing(null); setShowForm(true);
  };

  const openEdit = (task: Task) => {
    setTitle(task.title); setDescription(task.description);
    setPriority(task.priority); setCategory(task.category);
    setDueDate(task.dueDate || '');
    setRecurringFreq(task.recurring?.frequency || 'daily');
    setGoalTag(task.goalTag || '');
    setEditing(task); setShowForm(true);
  };

  const save = () => {
    if (!title.trim()) return;
    const data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      completed: editing?.completed ?? false,
      completedAt: editing?.completedAt,
      dueDate: category === 'daily' ? undefined : (dueDate || undefined),
      recurring: category === 'daily' ? { frequency: recurringFreq, lastReset: editing?.recurring?.lastReset } : undefined,
      goalTag: category === 'goal' && goalTag ? goalTag : undefined,
    };
    if (editing) {
      app.updateTask(editing.id, data);
    } else {
      app.addTask(data);
    }
    setShowForm(false);
  };

  const toggleComplete = (task: Task) => {
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const completing = !task.completed;

    app.updateTask(task.id, {
      completed: completing,
      completedAt: completing ? now : undefined,
      ...(task.recurring && completing ? { recurring: { ...task.recurring, lastReset: todayStr } } : {}),
    });

    // Gamification: award XP on completion, remove on uncompletion
    if (completing) {
      const completionsToday = app.tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr)).length;
      const result = processTaskCompletion(app.gamification, task, completionsToday, nowDate);
      app.updateGamification(result.updatedProfile);

      // XP toast
      addToast({ type: 'xp', text: `+${result.xpEarned} XP`, emoji: '\u2728' });

      // Level up celebration
      if (result.leveledUp) {
        addToast({ type: 'levelup', text: `Level ${result.newLevel}! ${result.newTitle}`, emoji: '\u{1F31F}' });
        setShowLevelFlash(true);
        setTimeout(() => setShowLevelFlash(false), 1000);
      }

      // Streak milestone
      if (result.isStreakMilestone) {
        addToast({ type: 'streak', text: `${result.streakUpdate.currentStreak}-day streak!`, emoji: '\u{1F525}' });
      }

      // New badges
      for (const badge of result.newBadges) {
        addToast({ type: 'badge', text: `${badge.name} unlocked!`, emoji: badge.emoji });
      }
    }
  };

  const handleDelete = (id: string) => {
    app.removeTask(id);
    setDeletingId(null);
    if (editing?.id === id) setShowForm(false);
  };

  // ── Render helpers ──
  const renderTaskRow = (task: Task) => (
    <div key={task.id} className={`task-row ${task.completed ? 'completed' : ''}`}>
      <input
        type="checkbox"
        className="task-checkbox"
        checked={task.completed}
        onChange={() => toggleComplete(task)}
        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
      />
      <div className="task-content">
        <div className={`task-title ${task.completed ? 'task-title-done' : ''}`}>
          {task.title}
          {task.priority !== 'low' && <span className={`tag tag-${task.priority}`}>{task.priority}</span>}
          {task.category === 'daily' && <span className="tag tag-daily">daily</span>}
        </div>
        <div className="task-meta">
          {task.dueDate && (
            <span className={task.dueDate < todayStr && !task.completed ? 'tag tag-overdue' : ''} style={task.dueDate < todayStr && !task.completed ? { padding: '1px 6px', borderRadius: 3 } : {}}>
              {task.dueDate < todayStr && !task.completed ? 'Overdue' : `Due ${task.dueDate}`}
            </span>
          )}
          {task.recurring && <span>Repeats {task.recurring.frequency}</span>}
          {task.description && <span>{task.description.slice(0, 60)}{task.description.length > 60 ? '...' : ''}</span>}
        </div>
      </div>
      <div className="task-actions">
        <button className="btn-icon btn-sm" onClick={() => openEdit(task)} aria-label={`Edit "${task.title}"`} style={{ fontSize: 11 }}>Edit</button>
        {deletingId === task.id ? (
          <div className="confirm-bar" role="alert" style={{ margin: 0, padding: '4px 8px' }}>
            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(task.id)}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
          </div>
        ) : (
          <button className="btn-icon btn-sm" onClick={() => setDeletingId(task.id)} aria-label={`Delete "${task.title}"`} style={{ fontSize: 11, color: '#ff6b6b' }}>&times;</button>
        )}
      </div>
    </div>
  );

  const activeCount = app.tasks.filter(t => !t.completed && t.category !== 'goal').length;
  const goalCount = activeGoals.length;

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Tasks</h1>
          <div className="subtitle">
            {app.tasks.length === 0
              ? 'No tasks yet'
              : `${activeCount} active task${activeCount !== 1 ? 's' : ''}${goalCount > 0 ? ` \u00b7 ${goalCount} goal${goalCount !== 1 ? 's' : ''}` : ''}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openAdd()}>+ Add Task</button>
      </div>
      <div className="surface-body">
        <div className="tabs">
          <button className={`tab ${tab === 'today' ? 'active' : ''}`} onClick={() => setTab('today')}>
            Today{todayTotal > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#6b6f85' }}>{todayDone}/{todayTotal}</span>}
          </button>
          <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All Tasks</button>
          <button className={`tab ${tab === 'goals' ? 'active' : ''}`} onClick={() => setTab('goals')}>
            Goals{activeGoals.length > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: '#6b6f85' }}>{activeGoals.length}</span>}
          </button>
        </div>

        {/* ── Today ── */}
        {tab === 'today' && (
          <>
            {/* Gamification stats panel */}
            {(() => {
              const gam = app.gamification;
              const xp = xpToNextLevel(gam.totalXp);
              const title = titleForLevel(gam.level);
              const streakMilestone = [7, 14, 30, 60, 100].includes(gam.currentStreak);
              return (
                <div className="gam-panel">
                  <div className="gam-level">
                    <div className="gam-level-num">{gam.level}</div>
                    <div className="gam-level-label">{title}</div>
                  </div>
                  <div className="gam-xp-section">
                    <div className="gam-xp-title">
                      <span>{gam.totalXp} XP total</span>
                      <span>{xp.current} / {xp.needed} to level {gam.level + 1}</span>
                    </div>
                    <div className="gam-xp-bar">
                      <div className="gam-xp-fill" style={{ width: `${xp.progress * 100}%` }} />
                    </div>
                  </div>
                  <div className="gam-stats">
                    {gam.currentStreak > 0 && (
                      <div className={`gam-streak ${streakMilestone ? 'milestone' : ''}`}>
                        <span className="gam-streak-fire">{'\u{1F525}'}</span>
                        {gam.currentStreak}d
                      </div>
                    )}
                    {gam.badges.length > 0 && (
                      <div className="gam-badges-row">
                        {gam.badges.slice(-5).map(id => {
                          const b = getBadgeDef(id);
                          return b ? (
                            <span key={id} className={`gam-badge ${b.rarity}`} title={`${b.name}: ${b.description}`}>{b.emoji}</span>
                          ) : null;
                        })}
                        {gam.badges.length > 5 && <span style={{ fontSize: 11, color: '#6b6f85', alignSelf: 'center' }}>+{gam.badges.length - 5}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {todayTotal > 0 && (
              <div className="progress-summary">
                <span><span className="count">{todayDone}</span> of <span className="count">{todayTotal}</span> done today</span>
                <div className="progress-bar" style={{ flex: 1 }}>
                  <div className="progress-fill" style={{ width: `${todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            {todayTotal === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>&#9745;</div>
                <h3>Nothing for today</h3>
                <p>Add a daily habit or create a task with today's due date to see it here.</p>
                <div className="actions-row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => openAdd('daily')}>+ Daily Habit</button>
                  <button className="btn btn-secondary" onClick={() => openAdd('task')}>+ Task</button>
                </div>
              </div>
            ) : (
              <>
                {dailyHabits.length > 0 && (
                  <>
                    <div className="section-heading">Daily Habits</div>
                    {dailyHabits.map(renderTaskRow)}
                  </>
                )}
                {dueTodayTasks.length > 0 && (
                  <>
                    <div className="section-heading">Due Today</div>
                    {dueTodayTasks.map(renderTaskRow)}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── All Tasks ── */}
        {tab === 'all' && (
          <>
            <div className="filter-bar">
              <select className="form-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value as typeof filterCategory)}>
                <option value="all">All types</option>
                <option value="daily">Daily habits</option>
                <option value="task">One-off tasks</option>
              </select>
              <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value as typeof filterPriority)}>
                <option value="all">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
              <span className="count">{allTasks.length} task{allTasks.length !== 1 ? 's' : ''}</span>
            </div>

            {allTasks.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>&#128203;</div>
                <h3>No tasks match filters</h3>
                <p>{app.tasks.filter(t => t.category !== 'goal').length === 0 ? 'Create your first task to get started.' : 'Try adjusting your filters.'}</p>
                <button className="btn btn-primary" onClick={() => openAdd('task')}>+ Add Task</button>
              </div>
            ) : (
              allTasks.map(renderTaskRow)
            )}
          </>
        )}

        {/* ── Goals ── */}
        {tab === 'goals' && (
          <>
            {/* Goal tag filter */}
            {goalTags.length > 0 && (
              <div className="filter-bar">
                <button
                  className={`btn btn-sm ${filterGoalTag === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFilterGoalTag('all')}
                >
                  All
                </button>
                {goalTags.map(tag => (
                  <button
                    key={tag}
                    className={`btn btn-sm ${filterGoalTag === tag ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterGoalTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
                {app.tasks.some(t => t.category === 'goal' && !t.goalTag) && (
                  <button
                    className={`btn btn-sm ${filterGoalTag === '' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setFilterGoalTag('')}
                  >
                    Uncategorized
                  </button>
                )}
              </div>
            )}

            {activeGoals.length === 0 && completedGoals.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>&#127919;</div>
                <h3>{filterGoalTag !== 'all' ? `No ${filterGoalTag || 'uncategorized'} goals` : 'No goals set'}</h3>
                <p>Add long-term goals to track your big-picture progress.</p>
                <button className="btn btn-primary" onClick={() => openAdd('goal')}>+ Add Goal</button>
              </div>
            ) : (
              <>
                {activeGoals.map(goal => (
                  <div key={goal.id} className="goal-card">
                    <div className="goal-title">
                      {goal.title}
                      <span className={`tag tag-${goal.priority}`}>{goal.priority}</span>
                      {goal.goalTag && <span className="tag tag-goal">{goal.goalTag}</span>}
                    </div>
                    {goal.description && <div className="goal-desc">{goal.description}</div>}
                    <div className="goal-meta">
                      {goal.dueDate && <span>Target: {goal.dueDate}</span>}
                      <span>Created {new Date(goal.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="actions-row" style={{ marginTop: 10 }}>
                      <button className="btn btn-success btn-sm" onClick={() => toggleComplete(goal)}>Mark Complete</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(goal)}>Edit</button>
                      {deletingId === goal.id ? (
                        <div className="confirm-bar" role="alert" style={{ margin: 0 }}>
                          Delete this goal?
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(goal.id)}>Delete</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => setDeletingId(goal.id)}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}

                {completedGoals.length > 0 && (
                  <div className="completed-section">
                    <button className="completed-section-toggle" onClick={() => setShowCompletedGoals(!showCompletedGoals)}>
                      {showCompletedGoals ? '\u25BC' : '\u25B6'} Completed Goals ({completedGoals.length})
                    </button>
                    {showCompletedGoals && completedGoals.map(goal => (
                      <div key={goal.id} className="goal-card completed" style={{ marginTop: 8 }}>
                        <div className="goal-title" style={{ textDecoration: 'line-through' }}>
                          {goal.title}
                        </div>
                        {goal.completedAt && <div className="goal-meta">Completed {new Date(goal.completedAt).toLocaleDateString()}</div>}
                        <div className="actions-row" style={{ marginTop: 8 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleComplete(goal)}>Reopen</button>
                          <button className="btn btn-danger btn-sm" onClick={() => {
                            if (deletingId === goal.id) handleDelete(goal.id);
                            else setDeletingId(goal.id);
                          }}>
                            {deletingId === goal.id ? 'Confirm Delete' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing ? 'Edit Task' : 'Add Task'}>
            <h2>{editing ? 'Edit Task' : 'Add Task'}</h2>
            <div className="form-group">
              <label htmlFor="task-title">Title</label>
              <input id="task-title" className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="task-desc">Description (optional)</label>
              <textarea id="task-desc" className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Details, notes, links..." />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="task-category">Type</label>
                <select id="task-category" className="form-select" value={category} onChange={e => setCategory(e.target.value as TaskCategory)}>
                  <option value="task">One-off Task</option>
                  <option value="daily">Daily Habit</option>
                  <option value="goal">Long-term Goal</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="task-priority">Priority</label>
                <select id="task-priority" className="form-select" value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            {category !== 'daily' && (
              <div className="form-group">
                <label htmlFor="task-due">{category === 'goal' ? 'Target Date' : 'Due Date'} (optional)</label>
                <input id="task-due" className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            )}
            {category === 'daily' && (
              <div className="form-group">
                <label htmlFor="task-freq">Repeats</label>
                <select id="task-freq" className="form-select" value={recurringFreq} onChange={e => setRecurringFreq(e.target.value as typeof recurringFreq)}>
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays only</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            )}
            {category === 'goal' && goalTags.length > 0 && (
              <div className="form-group">
                <label htmlFor="task-goaltag">Category</label>
                <select id="task-goaltag" className="form-select" value={goalTag} onChange={e => setGoalTag(e.target.value)}>
                  <option value="">None</option>
                  {goalTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>
                {editing ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gamification toasts */}
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

      {/* Level up flash */}
      {showLevelFlash && <div className="gam-levelup-flash" />}
    </>
  );
}
