import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import HabitCards from '../components/HabitCards';
import { TIMING } from '../config/constants';
import { EMOJI_PALETTE, getHabitEmoji } from '../services/habitEmoji';
import type { PrayerName, Task, TaskCategory, TaskPriority } from '../types/domain';
import {
  processTaskCompletion,
  buildCompletionContext,
  recordHabitCompletion,
  checkStreakBroken,
  xpToNextLevel,
  titleForLevel,
  getBadgeDef,
} from '../services/gamification';
import {
  comparePrayerTasks,
  getPrayerTaskTitle,
  isHabitTask,
  isPrayerTask,
  isStandardDailyTask,
  PRAYER_TASK_ORDER,
} from '../services/prayerTasks';

type Tab = 'today' | 'all' | 'goals';

interface Toast {
  id: string;
  type: 'xp' | 'levelup' | 'badge' | 'streak';
  text: string;
  emoji?: string;
}

interface AllTaskSection {
  id: 'overdue' | 'today' | 'upcoming' | 'prayers' | 'routines' | 'later';
  title: string;
  description: string;
  items: Task[];
}

type AllTaskAccordionSectionId = AllTaskSection['id'] | 'completed';

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromLocalDateStr(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftLocalDate(dateStr: string, days: number): string {
  const next = fromLocalDateStr(dateStr);
  next.setDate(next.getDate() + days);
  return toLocalDateStr(next);
}

function formatShortDate(dateStr: string): string {
  return fromLocalDateStr(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getAllTaskSectionId(task: Task, todayStr: string): AllTaskSection['id'] {
  if (isPrayerTask(task)) return 'prayers';
  if (task.category === 'daily') return 'routines';
  if (!task.dueDate) return 'later';
  if (task.dueDate < todayStr) return 'overdue';
  if (task.dueDate === todayStr) return 'today';
  return 'upcoming';
}

export default function TasksSurface() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('today');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const [expandedAllTaskSections, setExpandedAllTaskSections] = useState<Partial<Record<AllTaskAccordionSectionId, boolean>>>({
    completed: false,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showLevelFlash, setShowLevelFlash] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [category, setCategory] = useState<TaskCategory>('task');
  const [prayerName, setPrayerName] = useState<PrayerName>('Fajr');
  const [dueDate, setDueDate] = useState('');
  const [recurringFreq, setRecurringFreq] = useState<'daily' | 'weekdays' | 'weekly'>('daily');
  const [goalTag, setGoalTag] = useState('');
  const [habitEmoji, setHabitEmoji] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');

  // Filters
  const [filterGoalTag, setFilterGoalTag] = useState<string>('all');
  const [filterProjectId, setFilterProjectId] = useState<string>('all');

  // Filters for All Tasks tab
  const [filterCategory, setFilterCategory] = useState<'all' | 'daily' | 'prayer' | 'task'>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | TaskPriority>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');

  const todayStr = toLocalDateStr(new Date());
  const isWeekday = () => { const d = new Date().getDay(); return d >= 1 && d <= 5; };
  const assistantNavigationRequest = app.assistantNavigationRequest;
  const dismissAssistantNavigationRequest = app.dismissAssistantNavigationRequest;
  const tasks = app.tasks;

  useEffect(() => {
    const request = assistantNavigationRequest;
    if (!request || request.surface !== 'tasks') return;

    const tasksState = request.surfaceState?.tasks;
    const revealTaskId = tasksState?.revealTaskId;
    const highlightTaskId = tasksState?.highlightTaskId;
    const targetTask = revealTaskId ? tasks.find(task => task.id === revealTaskId) : undefined;

    if (tasksState?.tab) {
      setTab(tasksState.tab);
    }
    if (tasksState?.resetFilters) {
      setFilterCategory('all');
      setFilterPriority('all');
      setFilterStatus('all');
      setFilterGoalTag('all');
      setFilterProjectId('all');
    }
    if (targetTask?.category === 'goal' && targetTask.completed) {
      setShowCompletedGoals(true);
    }
    if (highlightTaskId) {
      setHighlightedTaskId(highlightTaskId);
    }

    dismissAssistantNavigationRequest(request.id);
  }, [assistantNavigationRequest, dismissAssistantNavigationRequest, tasks]);

  // ── Recurring reset ──
  useEffect(() => {
    const habitsToReset = app.tasks.filter(t => {
      if (!isHabitTask(t) || !t.recurring || !t.completed) return false;
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

  useEffect(() => {
    if (!highlightedTaskId) return;

    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`task-item-${highlightedTaskId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, TIMING.ASSISTANT_TASK_REVEAL_SCROLL_DELAY);

    const clearTimer = window.setTimeout(() => {
      setHighlightedTaskId(current => current === highlightedTaskId ? null : current);
    }, TIMING.ASSISTANT_TASK_REVEAL_HIGHLIGHT);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightedTaskId]);

  // Toast helpers
  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // ── Derived data ──
  const projectFilteredTasks = useMemo(() => (
    filterProjectId === 'all'
      ? app.tasks
      : app.tasks.filter(task => task.projectId === filterProjectId)
  ), [app.tasks, filterProjectId]);

  const prayerTasks = useMemo(() =>
    projectFilteredTasks
      .filter(isPrayerTask)
      .sort((a, b) => (a.completed === b.completed ? comparePrayerTasks(a, b) : a.completed ? 1 : -1)),
    [projectFilteredTasks]
  );
  const dailyHabits = useMemo(() =>
    projectFilteredTasks
      .filter(isStandardDailyTask)
      .sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1)),
    [projectFilteredTasks]
  );

  const dueTodayTasks = useMemo(() =>
    projectFilteredTasks
      .filter(t => t.category === 'task' && t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      }),
    [projectFilteredTasks, todayStr]
  );

  const todayItems = useMemo(() => [...prayerTasks, ...dailyHabits, ...dueTodayTasks], [prayerTasks, dailyHabits, dueTodayTasks]);
  const todayDone = todayItems.filter(t => t.completed).length;
  const todayTotal = todayItems.length;
  const tomorrowStr = useMemo(() => shiftLocalDate(todayStr, 1), [todayStr]);

  const allTasks = useMemo(() => {
    let filtered = projectFilteredTasks.filter(t => t.category !== 'goal');
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
  }, [projectFilteredTasks, filterCategory, filterPriority, filterStatus]);

  const scopedAllTasks = useMemo(
    () => projectFilteredTasks.filter(task => task.category !== 'goal'),
    [projectFilteredTasks],
  );

  const selectedProjectName = useMemo(
    () => app.projects.find(project => project.id === filterProjectId)?.name,
    [app.projects, filterProjectId],
  );

  const allTaskStats = useMemo(() => {
    const active = scopedAllTasks.filter(task => !task.completed).length;
    const completed = scopedAllTasks.filter(task => task.completed).length;
    const overdue = scopedAllTasks.filter(task => !task.completed && task.category === 'task' && !!task.dueDate && task.dueDate < todayStr).length;
    const dueToday = scopedAllTasks.filter(task => !task.completed && task.category === 'task' && task.dueDate === todayStr).length;
    const prayers = scopedAllTasks.filter(task => !task.completed && isPrayerTask(task)).length;
    const routines = scopedAllTasks.filter(task => !task.completed && task.category === 'daily').length;
    return { active, completed, overdue, dueToday, prayers, routines };
  }, [scopedAllTasks, todayStr]);

  const allTaskSections = useMemo<AllTaskSection[]>(() => {
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const upcoming: Task[] = [];
    const prayers: Task[] = [];
    const routines: Task[] = [];
    const later: Task[] = [];

    allTasks
      .filter(task => !task.completed)
      .forEach(task => {
        if (isPrayerTask(task)) {
          prayers.push(task);
          return;
        }

        if (task.category === 'daily') {
          routines.push(task);
          return;
        }

        if (!task.dueDate) {
          later.push(task);
          return;
        }

        if (task.dueDate < todayStr) {
          overdue.push(task);
          return;
        }

        if (task.dueDate === todayStr) {
          dueToday.push(task);
          return;
        }

        upcoming.push(task);
      });

    const sections: AllTaskSection[] = [
      { id: 'overdue', title: 'Overdue', description: 'Needs attention first.', items: overdue },
      { id: 'today', title: 'Due today', description: 'Keep today moving without losing track.', items: dueToday },
      { id: 'upcoming', title: 'Upcoming', description: 'Scheduled next so you can plan ahead.', items: upcoming },
      { id: 'prayers', title: 'Islamic', description: 'Prayer commitments tracked in their own lane.', items: prayers },
      { id: 'routines', title: 'Routines', description: 'Daily habits and repeating commitments.', items: routines },
      { id: 'later', title: 'Later', description: 'Open tasks without a due date yet.', items: later },
    ];

    return sections.filter(section => section.items.length > 0);
  }, [allTasks, todayStr]);

  const completedAllTasks = useMemo(
    () => allTasks.filter(task => task.completed),
    [allTasks],
  );

  useEffect(() => {
    setExpandedAllTaskSections(prev => {
      let changed = false;
      const next = { ...prev };

      for (const section of allTaskSections) {
        if (next[section.id] === undefined) {
          next[section.id] = true;
          changed = true;
        }
      }

      if (completedAllTasks.length > 0 && next.completed === undefined) {
        next.completed = filterStatus === 'completed';
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [allTaskSections, completedAllTasks.length, filterStatus]);

  useEffect(() => {
    if (filterStatus !== 'completed' || completedAllTasks.length === 0) return;

    setExpandedAllTaskSections(prev => (
      prev.completed ? prev : { ...prev, completed: true }
    ));
  }, [completedAllTasks.length, filterStatus]);

  useEffect(() => {
    if (!highlightedTaskId) return;

    const highlightedTask = allTasks.find(task => task.id === highlightedTaskId);
    if (!highlightedTask) return;

    const targetSectionId: AllTaskAccordionSectionId = highlightedTask.completed
      ? 'completed'
      : getAllTaskSectionId(highlightedTask, todayStr);

    setExpandedAllTaskSections(prev => (
      prev[targetSectionId] === false ? { ...prev, [targetSectionId]: true } : prev
    ));
  }, [allTasks, highlightedTaskId, todayStr]);

  const hasAllTaskFilters = filterProjectId !== 'all'
    || filterCategory !== 'all'
    || filterPriority !== 'all'
    || filterStatus !== 'all';

  const goalTags = useMemo(() => app.settings.goalTags || [], [app.settings.goalTags]);

  const activeGoals = useMemo(() => {
    let goals = projectFilteredTasks.filter(t => t.category === 'goal' && !t.completed);
    if (filterGoalTag === '') goals = goals.filter(g => !g.goalTag);
    else if (filterGoalTag !== 'all') goals = goals.filter(g => g.goalTag === filterGoalTag);
    return goals;
  }, [projectFilteredTasks, filterGoalTag]);
  const completedGoals = useMemo(() => {
    let goals = projectFilteredTasks.filter(t => t.category === 'goal' && t.completed);
    if (filterGoalTag === '') goals = goals.filter(g => !g.goalTag);
    else if (filterGoalTag !== 'all') goals = goals.filter(g => g.goalTag === filterGoalTag);
    return goals;
  }, [projectFilteredTasks, filterGoalTag]);

  // ── Actions ──
  const openAdd = (defaultCategory?: TaskCategory) => {
    setTitle(''); setDescription(''); setPriority('medium');
    setCategory(defaultCategory || (tab === 'goals' ? 'goal' : 'task'));
    setPrayerName('Fajr');
    setDueDate(tab === 'today' ? todayStr : '');
    setRecurringFreq('daily');
    setGoalTag(filterGoalTag !== 'all' ? filterGoalTag : '');
    setTaskProjectId(filterProjectId !== 'all' ? filterProjectId : '');
    setHabitEmoji('');
    setEditing(null); setShowForm(true);
  };

  const openEdit = (task: Task) => {
    setTitle(task.title); setDescription(task.description);
    setPriority(task.priority); setCategory(task.category);
    setPrayerName(task.prayerName || 'Fajr');
    setDueDate(task.dueDate || '');
    setRecurringFreq(task.recurring?.frequency || 'daily');
    setGoalTag(task.goalTag || '');
    setTaskProjectId(task.projectId || '');
    setHabitEmoji(task.emoji || '');
    setEditing(task); setShowForm(true);
  };

  const save = () => {
    const resolvedTitle = category === 'prayer' ? getPrayerTaskTitle(prayerName) : title.trim();
    if (!resolvedTitle) return;
    const normalizedProjectId = category === 'daily' || category === 'prayer' ? undefined : (taskProjectId || undefined);
    const nextBoardOrder = category === 'task' && normalizedProjectId
      ? (editing && editing.projectId === normalizedProjectId && typeof editing.boardOrder === 'number'
        ? editing.boardOrder
        : app.tasks
          .filter(task => task.projectId === normalizedProjectId && task.category === 'task')
          .reduce((max, task) => Math.max(max, task.boardOrder ?? 0), 0) + 1)
      : undefined;
    const data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
      title: resolvedTitle,
      description: description.trim(),
      priority,
      category,
      completed: editing?.completed ?? false,
      completedAt: editing?.completedAt,
      dueDate: category === 'daily' || category === 'prayer' ? undefined : (dueDate || undefined),
      recurring: category === 'daily'
        ? { frequency: recurringFreq, lastReset: editing?.recurring?.lastReset }
        : category === 'prayer'
          ? { frequency: 'daily', lastReset: editing?.recurring?.lastReset }
          : undefined,
      prayerName: category === 'prayer' ? prayerName : undefined,
      goalTag: category === 'goal' && goalTag ? goalTag : undefined,
      emoji: category === 'daily' && habitEmoji ? habitEmoji : undefined,
      projectId: normalizedProjectId,
      workflowState: category === 'task' && normalizedProjectId ? (editing?.workflowState || 'backlog') : undefined,
      blockedReason: category === 'task' && normalizedProjectId ? editing?.blockedReason : undefined,
      boardOrder: nextBoardOrder,
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

    // Habit-like items stay locked for the day once completed
    if (isHabitTask(task) && !completing) return;

    app.updateTask(task.id, {
      completed: completing,
      completedAt: completing ? now : undefined,
      ...(task.recurring && completing ? { recurring: { ...task.recurring, lastReset: todayStr } } : {}),
    });

    // Gamification: award XP on completion (once per habit per day)
    if (completing) {
      // Check if this habit already got XP today (prevent farming)
      const todayLog = app.gamification.dailyLog?.[todayStr] || [];
      const alreadyRewarded = isHabitTask(task) && todayLog.includes(task.id);

      if (alreadyRewarded) return; // no duplicate XP

      const completionsToday = app.tasks.filter(t => t.completed && t.completedAt?.startsWith(todayStr)).length;
      const extCtx = buildCompletionContext(app.tasks, app.settings.goalTags, todayStr, app.gamification, {
        knowledgeEntries: app.knowledgeEntries.length,
        knowledgeTopics: app.knowledgeTopics.length,
        lifestyleHaramMastered: app.lifestyleItems.filter(i => i.type === 'haram' && i.status === 'mastered').length,
        lifestyleHalalConsistent: app.lifestyleItems.filter(i => i.type === 'halal' && i.status === 'consistent').length,
        lifestyleTotal: app.lifestyleItems.length,
      });
      const result = processTaskCompletion(app.gamification, task, completionsToday, nowDate, extCtx);
      let profile = result.updatedProfile;
      if (isHabitTask(task)) {
        profile = recordHabitCompletion(profile, task.id, todayStr);
      }
      app.updateGamification(profile);

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

  const isAssistantHighlighted = useCallback((taskId: string) => highlightedTaskId === taskId, [highlightedTaskId]);

  const resetAllTaskFilters = useCallback(() => {
    setFilterProjectId('all');
    setFilterCategory('all');
    setFilterPriority('all');
    setFilterStatus('all');
  }, []);

  const toggleAllTaskSection = useCallback((sectionId: AllTaskAccordionSectionId) => {
    setExpandedAllTaskSections(prev => ({
      ...prev,
      [sectionId]: !(prev[sectionId] ?? (sectionId === 'completed' ? false : true)),
    }));
  }, []);

  // ── Render helpers ──
  const renderTaskRow = (task: Task) => (
    <div
      key={task.id}
      id={`task-item-${task.id}`}
      className={`task-row ${task.completed ? 'completed' : ''} ${isAssistantHighlighted(task.id) ? 'assistant-focus' : ''}`}
    >
      <input
        type="checkbox"
        className="task-checkbox"
        checked={task.completed}
        onChange={() => toggleComplete(task)}
        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
      />
      <div className="task-content">
        {task.projectId && (
          <div style={{ marginBottom: 6 }}>
            <span className="tag tag-connected">{app.projects.find(project => project.id === task.projectId)?.name || 'Project'}</span>
          </div>
        )}
        <div className={`task-title ${task.completed ? 'task-title-done' : ''}`}>
          {task.title}
          {task.priority !== 'low' && <span className={`tag tag-${task.priority}`}>{task.priority}</span>}
          {task.category === 'daily' && <span className="tag tag-daily">daily</span>}
          {task.category === 'prayer' && <span className="tag tag-daily">prayer</span>}
        </div>
        <div className="task-meta">
          {task.dueDate && (
            <span className={task.dueDate < todayStr && !task.completed ? 'tag tag-overdue' : ''} style={task.dueDate < todayStr && !task.completed ? { padding: '1px 6px', borderRadius: 3 } : {}}>
              {task.dueDate < todayStr && !task.completed ? 'Overdue' : `Due ${task.dueDate}`}
            </span>
          )}
          {task.category === 'prayer'
            ? <span>Islamic prayer</span>
            : task.recurring && <span>Repeats {task.recurring.frequency}</span>}
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

  const renderAllTaskCard = (task: Task) => {
    const projectName = task.projectId ? app.projects.find(project => project.id === task.projectId)?.name || 'Project' : undefined;
    const completionDate = task.completedAt ? toLocalDateStr(new Date(task.completedAt)) : undefined;
    const dueLabel = task.dueDate
      ? task.dueDate < todayStr && !task.completed
        ? `Overdue · ${formatShortDate(task.dueDate)}`
        : task.dueDate === todayStr
          ? 'Due today'
          : task.dueDate === tomorrowStr
            ? 'Due tomorrow'
            : `Due ${formatShortDate(task.dueDate)}`
      : undefined;
    const dueTone = task.dueDate
      ? task.dueDate < todayStr && !task.completed
        ? 'danger'
        : task.dueDate === todayStr
          ? 'today'
          : 'future'
      : undefined;
    const footerNote = task.completed
      ? completionDate === todayStr
        ? 'Completed today'
        : completionDate
          ? `Completed ${formatShortDate(completionDate)}`
          : 'Completed'
      : task.recurring
        ? `Repeats ${task.recurring.frequency}`
        : task.dueDate
          ? `Scheduled for ${formatShortDate(task.dueDate)}`
          : 'No due date yet';

    return (
      <div
        key={task.id}
        id={`task-item-${task.id}`}
        className={`all-task-card ${task.completed ? 'completed' : ''} ${isAssistantHighlighted(task.id) ? 'assistant-focus' : ''}`}
      >
        <div className="all-task-card-header">
          <div className="all-task-card-main">
            <input
              type="checkbox"
              className="task-checkbox all-task-checkbox"
              checked={task.completed}
              onChange={() => toggleComplete(task)}
              aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
            />
            <div className="all-task-card-copy">
              <div className="all-task-card-labels">
                {task.category === 'daily' && (
                  <span className="all-task-habit-emoji" aria-hidden="true">
                    {getHabitEmoji(task.title, task.emoji)}
                  </span>
                )}
                {task.category === 'prayer' && (
                  <span className="all-task-habit-emoji" aria-hidden="true">
                    {'\u{1F54C}'}
                  </span>
                )}
                <span className={`all-task-type ${task.category}`}>
                  {task.category === 'daily' ? 'Routine' : task.category === 'prayer' ? 'Prayer' : 'Task'}
                </span>
                <span className={`tag tag-${task.priority}`}>{task.priority}</span>
                {projectName && <span className="tag tag-connected">{projectName}</span>}
              </div>
              <div className={`all-task-card-title ${task.completed ? 'done' : ''}`}>{task.title}</div>
              {task.description && (
                <p className="all-task-card-desc">
                  {task.description.length > 110 ? `${task.description.slice(0, 110)}...` : task.description}
                </p>
              )}
            </div>
          </div>
          <div className="all-task-card-side">
            {dueLabel && (
              <span className={`all-task-date-badge ${dueTone}`}>
                {dueLabel}
              </span>
            )}
            <div className="all-task-card-actions">
              <button className="btn-icon btn-sm" onClick={() => openEdit(task)} aria-label={`Edit "${task.title}"`} style={{ fontSize: 11 }}>
                Edit
              </button>
              <button
                className="btn-icon btn-sm"
                onClick={() => setDeletingId(current => current === task.id ? null : task.id)}
                aria-label={`Delete "${task.title}"`}
                style={{ fontSize: 11, color: '#ff6b6b' }}
              >
                {deletingId === task.id ? 'Close' : '\u00d7'}
              </button>
            </div>
          </div>
        </div>
        <div className="all-task-card-footer">
          <span>{footerNote}</span>
          {isHabitTask(task) && task.recurring && <span>Reset {task.recurring.lastReset ? `last on ${formatShortDate(task.recurring.lastReset)}` : 'automatically'}</span>}
        </div>
        {deletingId === task.id && (
          <div className="confirm-bar all-task-confirm" role="alert">
            <span>Delete this {task.category === 'daily' ? 'routine' : task.category === 'prayer' ? 'prayer task' : 'task'}?</span>
            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(task.id)}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
          </div>
        )}
      </div>
    );
  };

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
                <p>Add an Islamic prayer task, a daily habit, or a task with today's due date to see it here.</p>
                <div className="actions-row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => openAdd('prayer')}>+ Prayer Task</button>
                  <button className="btn btn-primary" onClick={() => openAdd('daily')}>+ Daily Habit</button>
                  <button className="btn btn-secondary" onClick={() => openAdd('task')}>+ Task</button>
                </div>
              </div>
            ) : (
              <>
                {prayerTasks.length > 0 && (
                  <>
                    <div className="section-heading">Islamic</div>
                    <HabitCards habits={prayerTasks} onComplete={toggleComplete} />
                  </>
                )}
                {dailyHabits.length > 0 && (
                  <>
                    <div className="section-heading">Daily Habits</div>
                    <HabitCards habits={dailyHabits} onComplete={toggleComplete} />
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
            <div className="all-tasks-overview">
              <div className="all-tasks-overview-copy">
                <div className="all-tasks-eyebrow">Task workspace</div>
                <h2>{allTaskStats.active} active item{allTaskStats.active !== 1 ? 's' : ''}</h2>
                <p>
                  {selectedProjectName
                    ? `Focused on ${selectedProjectName}.`
                    : 'Across every project and personal task.'}
                  {' '}Overdue work stays pinned at the top, and completed items stay tucked away until you need them.
                </p>
              </div>
              <div className="all-tasks-metrics" aria-label="All task summary">
                <div className="all-tasks-metric">
                  <span className="label">Overdue</span>
                  <span className="value">{allTaskStats.overdue}</span>
                </div>
                <div className="all-tasks-metric">
                  <span className="label">Due today</span>
                  <span className="value">{allTaskStats.dueToday}</span>
                </div>
                <div className="all-tasks-metric">
                  <span className="label">Islamic</span>
                  <span className="value">{allTaskStats.prayers}</span>
                </div>
                <div className="all-tasks-metric">
                  <span className="label">Routines</span>
                  <span className="value">{allTaskStats.routines}</span>
                </div>
                <div className="all-tasks-metric">
                  <span className="label">Completed</span>
                  <span className="value">{allTaskStats.completed}</span>
                </div>
              </div>
            </div>

            <div className="all-tasks-filters">
              <div className="all-tasks-filter-grid">
                <label className="all-tasks-filter-field">
                  <span>Project</span>
                  <select className="form-select" value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}>
                    <option value="all">All projects</option>
                    {app.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Type</span>
                  <select className="form-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value as typeof filterCategory)}>
                    <option value="all">All types</option>
                    <option value="daily">Daily habits</option>
                    <option value="prayer">Prayer tasks</option>
                    <option value="task">One-off tasks</option>
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Priority</span>
                  <select className="form-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value as typeof filterPriority)}>
                    <option value="all">All priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Status</span>
                  <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
              </div>
              <div className="all-tasks-filter-footer">
                <span className="count">{allTasks.length} matching item{allTasks.length !== 1 ? 's' : ''}</span>
                {hasAllTaskFilters && (
                  <button className="btn btn-secondary btn-sm" onClick={resetAllTaskFilters}>
                    Reset filters
                  </button>
                )}
              </div>
            </div>

            {allTasks.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon" style={{ fontSize: 36 }}>&#128203;</div>
                <h3>No tasks match this view</h3>
                <p>{scopedAllTasks.length === 0 ? 'Create your first task to get started.' : 'Try widening the filters or add a new task.'}</p>
                <div className="actions-row" style={{ gap: 8 }}>
                  {hasAllTaskFilters && <button className="btn btn-secondary" onClick={resetAllTaskFilters}>Reset Filters</button>}
                  <button className="btn btn-primary" onClick={() => openAdd('task')}>+ Add Task</button>
                </div>
              </div>
            ) : (
              <div className="all-tasks-sections">
                {allTaskSections.map(section => {
                  const isExpanded = expandedAllTaskSections[section.id] ?? true;

                  return (
                    <section key={section.id} className="all-task-section">
                      <button
                        className="all-task-section-header all-task-section-toggle"
                        onClick={() => toggleAllTaskSection(section.id)}
                        aria-expanded={isExpanded}
                        aria-controls={`all-task-section-${section.id}`}
                      >
                        <div>
                          <h3>{section.title}</h3>
                          <p>{section.description}</p>
                        </div>
                        <span className="all-task-section-count">
                          {isExpanded ? '\u25BE' : '\u25B8'} {section.items.length}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="all-task-section-list" id={`all-task-section-${section.id}`}>
                          {section.items.map(renderAllTaskCard)}
                        </div>
                      )}
                    </section>
                  );
                })}

                {completedAllTasks.length > 0 && (
                  <section className="all-task-section completed">
                    {(() => {
                      const isExpanded = expandedAllTaskSections.completed ?? false;

                      return (
                        <>
                          <button
                            className="all-task-section-header all-task-section-toggle"
                            onClick={() => toggleAllTaskSection('completed')}
                            aria-expanded={isExpanded}
                            aria-controls="all-task-section-completed"
                          >
                            <div>
                              <h3>Completed</h3>
                              <p>Finished items stay here for reference and quick reopen.</p>
                            </div>
                            <span className="all-task-section-count">
                              {isExpanded ? '\u25BE' : '\u25B8'} {completedAllTasks.length}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="all-task-section-list" id="all-task-section-completed">
                              {completedAllTasks.map(renderAllTaskCard)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </section>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Goals ── */}
        {tab === 'goals' && (
          <>
            {/* Goal tag filter */}
            {goalTags.length > 0 && (
              <div className="filter-bar">
                <select className="form-select" value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}>
                  <option value="all">All projects</option>
                  {app.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
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
                  <div
                    key={goal.id}
                    id={`task-item-${goal.id}`}
                    className={`goal-card ${isAssistantHighlighted(goal.id) ? 'assistant-focus' : ''}`}
                  >
                    <div className="goal-title">
                      {goal.title}
                      <span className={`tag tag-${goal.priority}`}>{goal.priority}</span>
                      {goal.goalTag && <span className="tag tag-goal">{goal.goalTag}</span>}
                      {goal.projectId && <span className="tag tag-connected">{app.projects.find(project => project.id === goal.projectId)?.name || 'Project'}</span>}
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
                      <div
                        key={goal.id}
                        id={`task-item-${goal.id}`}
                        className={`goal-card completed ${isAssistantHighlighted(goal.id) ? 'assistant-focus' : ''}`}
                        style={{ marginTop: 8 }}
                      >
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
              <label htmlFor={category === 'prayer' ? 'task-prayer-name' : 'task-title'}>{category === 'prayer' ? 'Prayer' : 'Title'}</label>
              {category === 'prayer' ? (
                <select
                  id="task-prayer-name"
                  className="form-select"
                  value={prayerName}
                  onChange={e => setPrayerName(e.target.value as PrayerName)}
                  autoFocus
                >
                  {PRAYER_TASK_ORDER.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              ) : (
                <input id="task-title" className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
              )}
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
                  <option value="prayer">Prayer Task</option>
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
            {category !== 'daily' && category !== 'prayer' && (
              <div className="form-group">
                <label htmlFor="task-due">{category === 'goal' ? 'Target Date' : 'Due Date'} (optional)</label>
                <input id="task-due" className="form-input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
            )}
            {category === 'daily' && (
              <>
                <div className="form-group">
                  <label htmlFor="task-freq">Repeats</label>
                  <select id="task-freq" className="form-select" value={recurringFreq} onChange={e => setRecurringFreq(e.target.value as typeof recurringFreq)}>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays only</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Icon</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 28 }}>{getHabitEmoji(title, habitEmoji)}</span>
                    <span style={{ fontSize: 11, color: '#6b6f85' }}>{habitEmoji ? 'Custom' : 'Auto-detected'}</span>
                    {habitEmoji && <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }} onClick={() => setHabitEmoji('')}>Reset</button>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {EMOJI_PALETTE.map(em => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setHabitEmoji(em)}
                        style={{
                          fontSize: 18, padding: '4px 6px', background: habitEmoji === em ? '#1e2140' : 'transparent',
                          border: habitEmoji === em ? '1px solid #4f5bff' : '1px solid transparent',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                      >{em}</button>
                    ))}
                  </div>
                </div>
              </>
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
            {category !== 'daily' && category !== 'prayer' && app.projects.length > 0 && (
              <div className="form-group">
                <label htmlFor="task-project">Project (optional)</label>
                <select id="task-project" className="form-select" value={taskProjectId} onChange={e => setTaskProjectId(e.target.value)}>
                  <option value="">None</option>
                  {app.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={category !== 'prayer' && !title.trim()}>
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
