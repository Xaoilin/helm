import { useState, useMemo, useEffect, useCallback } from 'react';
import { useShell } from "../store/ShellContext";
import { useTaskContext } from "../store/contexts/TaskContext";
import { useGamificationContext } from "../store/contexts/GamificationContext";
import { useKnowledgeContext } from "../store/contexts/KnowledgeContext";
import { useProjectContext } from "../store/contexts/ProjectContext";
import { useSettingsContext } from "../store/contexts/SettingsContext";
import { usePrayerContext } from '../store/contexts/PrayerContext';
import HabitCards from '../components/HabitCards';
import AllTaskCard from '../components/tasks/AllTaskCard';
import GamificationPanel from '../components/tasks/GamificationPanel';
import { ActiveGoalCard, CompletedGoalCard } from '../components/tasks/GoalCard';
import { RewardToasts } from '../components/tasks/RewardToasts';
import { useRewardToasts } from '../components/tasks/useRewardToasts';
import TaskEditorDialog from '../components/tasks/TaskEditorDialog';
import TaskRow, { type TaskItemActions } from '../components/tasks/TaskRow';
import type { PrayerOutcomeStatus, Task, TaskCategory } from '../types/domain';
import { getPrayerTaskName } from '../services/prayerTasks';
import {
  buildCompletionReward,
  buildTaskFromForm,
  buildTaskToggleUpdate,
  countKnowledgeProgress,
  createTaskForm,
  filterAllTasks,
  filterByProject,
  filterGoals,
  getTaskAppDate,
  groupAllTaskSections,
  isCompletionLocked,
  selectTodayTasks,
  summarizeAllTasks,
  taskToForm,
  type AllTaskFilters,
  type AllTaskSectionId,
  type TaskFormState,
} from '../services/taskModel';

type Tab = 'today' | 'all' | 'goals';
type AllTaskAccordionSectionId = AllTaskSectionId | 'completed';

const DEFAULT_ALL_TASK_FILTERS: AllTaskFilters = { category: 'all', priority: 'all', status: 'all' };

interface EditorState {
  editing: Task | null;
  initialForm: TaskFormState;
}

export default function TasksSurface() {
  const shell = useShell();
  const taskContext = useTaskContext();
  const gamification = useGamificationContext();
  const knowledge = useKnowledgeContext();
  const projects = useProjectContext();
  const settings = useSettingsContext();
  const prayer = usePrayerContext();
  const [tab, setTab] = useState<Tab>('today');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const [expandedAllTaskSections, setExpandedAllTaskSections] = useState<Partial<Record<AllTaskAccordionSectionId, boolean>>>({
    completed: false,
  });
  const [filterGoalTag, setFilterGoalTag] = useState<string>('all');
  const [filterProjectId, setFilterProjectId] = useState<string>('all');
  const [allTaskFilters, setAllTaskFilters] = useState<AllTaskFilters>(DEFAULT_ALL_TASK_FILTERS);
  const { toasts, showLevelFlash, celebrate } = useRewardToasts();

  const appTimeZone = settings.appTimeZone.effectiveTimeZone;
  const appDate = getTaskAppDate(new Date(), appTimeZone);
  const navigationRequest = shell.navigationRequest;
  const dismissNavigationRequest = shell.dismissNavigationRequest;
  const tasks = taskContext.tasks;

  useEffect(() => {
    const request = navigationRequest;
    if (!request || request.surface !== 'tasks') return;

    const tasksState = request.surfaceState?.tasks;
    if (tasksState?.tab) {
      setTab(tasksState.tab);
    }
    if (tasksState?.resetFilters) {
      setAllTaskFilters(DEFAULT_ALL_TASK_FILTERS);
      setFilterGoalTag('all');
      setFilterProjectId('all');
    }

    dismissNavigationRequest(request.id);
  }, [navigationRequest, dismissNavigationRequest]);

  // ── Derived data ──
  const projectFilteredTasks = useMemo(() => filterByProject(tasks, filterProjectId), [tasks, filterProjectId]);
  const { prayerTasks, dailyHabits, dueTodayTasks } = useMemo(
    () => selectTodayTasks(projectFilteredTasks, appDate),
    [projectFilteredTasks, appDate],
  );
  const todayItems = [...prayerTasks, ...dailyHabits, ...dueTodayTasks];
  const todayDone = todayItems.filter(t => t.completed).length;
  const todayTotal = todayItems.length;

  const allTasks = useMemo(() => filterAllTasks(projectFilteredTasks, allTaskFilters), [projectFilteredTasks, allTaskFilters]);
  const scopedAllTasks = useMemo(() => projectFilteredTasks.filter(task => task.category !== 'goal'), [projectFilteredTasks]);
  const allTaskStats = useMemo(() => summarizeAllTasks(scopedAllTasks, appDate), [scopedAllTasks, appDate]);
  const allTaskSections = useMemo(() => groupAllTaskSections(allTasks, appDate), [allTasks, appDate]);
  const completedAllTasks = useMemo(() => allTasks.filter(task => task.completed), [allTasks]);
  const selectedProjectName = projects.projects.find(project => project.id === filterProjectId)?.name;
  const filterStatus = allTaskFilters.status;

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

  const hasAllTaskFilters = filterProjectId !== 'all'
    || allTaskFilters.category !== 'all'
    || allTaskFilters.priority !== 'all'
    || allTaskFilters.status !== 'all';

  const goalTags = useMemo(() => settings.settings.goalTags || [], [settings.settings.goalTags]);
  const activeGoals = useMemo(() => filterGoals(projectFilteredTasks, filterGoalTag, false), [projectFilteredTasks, filterGoalTag]);
  const completedGoals = useMemo(() => filterGoals(projectFilteredTasks, filterGoalTag, true), [projectFilteredTasks, filterGoalTag]);

  // ── Actions ──
  const openAdd = (defaultCategory?: TaskCategory) => {
    setEditor({
      editing: null,
      initialForm: createTaskForm({
        category: defaultCategory || (tab === 'goals' ? 'goal' : 'task'),
        dueDate: tab === 'today' ? appDate : '',
        goalTag: filterGoalTag !== 'all' ? filterGoalTag : '',
        projectId: filterProjectId !== 'all' ? filterProjectId : '',
      }),
    });
  };

  const openEdit = (task: Task) => setEditor({ editing: task, initialForm: taskToForm(task) });
  const closeEditor = useCallback(() => setEditor(null), []);

  const save = (form: TaskFormState) => {
    const editing = editor?.editing ?? null;
    const data = buildTaskFromForm(form, editing, tasks);
    if (!data) return;
    if (editing) {
      taskContext.updateTask(editing.id, data);
    } else {
      taskContext.addTask(data);
    }
    closeEditor();
  };

  const toggleComplete = (task: Task) => {
    if (isCompletionLocked(task)) return;
    const completing = !task.completed;
    const prayerName = getPrayerTaskName(task);
    if (prayerName && completing) {
      prayer.requestPrayerCompletion(prayerName, {
        taskId: task.id,
        source: 'tasks',
        onCompleted: completion => celebrate(completion.xpEarned, completion.gamificationResult),
      });
      return;
    }

    const now = new Date();
    taskContext.updateTask(task.id, buildTaskToggleUpdate(task, now, appDate));
    if (!completing) return;

    const reward = buildCompletionReward({
      task,
      tasks,
      profile: gamification.gamification,
      goalTags: settings.settings.goalTags,
      knowledge: countKnowledgeProgress(knowledge),
      now,
      appDate,
      appTimeZone,
    });
    if (!reward) return;
    gamification.updateGamification(reward.profile);
    celebrate(reward.result.xpEarned, reward.result);
  };

  const handleDelete = (id: string) => {
    taskContext.removeTask(id);
    setDeletingId(null);
    if (editor?.editing?.id === id) closeEditor();
  };

  const resetAllTaskFilters = useCallback(() => {
    setFilterProjectId('all');
    setAllTaskFilters(DEFAULT_ALL_TASK_FILTERS);
  }, []);

  const toggleAllTaskSection = useCallback((sectionId: AllTaskAccordionSectionId) => {
    setExpandedAllTaskSections(prev => ({
      ...prev,
      [sectionId]: !(prev[sectionId] ?? (sectionId === 'completed' ? false : true)),
    }));
  }, []);

  // ── Render helpers ──
  const projectNameFor = (task: Task) => (
    task.projectId ? projects.projects.find(project => project.id === task.projectId)?.name : undefined
  );
  // Prayer outcomes are keyed by the prayer timetable's date, not the app date.
  const prayerOutcomeFor = (task: Task): PrayerOutcomeStatus | undefined => {
    const name = getPrayerTaskName(task);
    return name ? prayer.getOutcome(prayer.today, name)?.status : undefined;
  };
  const itemActions: TaskItemActions = {
    onToggle: toggleComplete,
    onEdit: openEdit,
    onDeleteRequest: setDeletingId,
    onDeleteCancel: () => setDeletingId(null),
    onDelete: handleDelete,
  };
  const itemProps = (task: Task) => ({
    ...itemActions,
    key: task.id,
    task,
    appDate,
    projectName: projectNameFor(task),
    prayerOutcome: prayerOutcomeFor(task),
    deleting: deletingId === task.id,
  });
  const renderAllTaskCard = (task: Task) => {
    const { key, ...props } = itemProps(task);
    return <AllTaskCard key={key} {...props} appTimeZone={appTimeZone} />;
  };
  const renderTaskRow = (task: Task) => {
    const { key, ...props } = itemProps(task);
    return <TaskRow key={key} {...props} />;
  };
  const goalProps = (goal: Task) => {
    const { key, task, ...props } = itemProps(goal);
    return { key, goal: task, ...props };
  };

  const activeCount = tasks.filter(t => !t.completed && t.category !== 'goal').length;
  const goalCount = activeGoals.length;

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Tasks</h1>
          <div className="subtitle">
            {tasks.length === 0
              ? 'No tasks yet'
              : `${activeCount} active task${activeCount !== 1 ? 's' : ''}${goalCount > 0 ? ` · ${goalCount} goal${goalCount !== 1 ? 's' : ''}` : ''}`}
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
            <GamificationPanel profile={gamification.gamification} />

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
                    <HabitCards habits={prayerTasks} onComplete={toggleComplete} getPrayerOutcome={prayerOutcomeFor} />
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
                {([
                  ['Overdue', allTaskStats.overdue],
                  ['Due today', allTaskStats.dueToday],
                  ['Islamic', allTaskStats.prayers],
                  ['Routines', allTaskStats.routines],
                  ['Completed', allTaskStats.completed],
                ] as const).map(([label, value]) => (
                  <div key={label} className="all-tasks-metric">
                    <span className="label">{label}</span>
                    <span className="value">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="all-tasks-filters">
              <div className="all-tasks-filter-grid">
                <label className="all-tasks-filter-field">
                  <span>Project</span>
                  <select className="form-select" value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}>
                    <option value="all">All projects</option>
                    {projects.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Type</span>
                  <select className="form-select" value={allTaskFilters.category} onChange={e => setAllTaskFilters(current => ({ ...current, category: e.target.value as AllTaskFilters['category'] }))}>
                    <option value="all">All types</option>
                    <option value="daily">Daily habits</option>
                    <option value="prayer">Prayer tasks</option>
                    <option value="task">One-off tasks</option>
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Priority</span>
                  <select className="form-select" value={allTaskFilters.priority} onChange={e => setAllTaskFilters(current => ({ ...current, priority: e.target.value as AllTaskFilters['priority'] }))}>
                    <option value="all">All priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="all-tasks-filter-field">
                  <span>Status</span>
                  <select className="form-select" value={allTaskFilters.status} onChange={e => setAllTaskFilters(current => ({ ...current, status: e.target.value as AllTaskFilters['status'] }))}>
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
                {[
                  ...allTaskSections,
                  ...(completedAllTasks.length > 0
                    ? [{
                      id: 'completed' as const,
                      title: 'Completed',
                      description: 'Finished items stay here for reference and quick reopen.',
                      items: completedAllTasks,
                    }]
                    : []),
                ].map(section => {
                  const isExpanded = expandedAllTaskSections[section.id] ?? section.id !== 'completed';

                  return (
                    <section key={section.id} className={`all-task-section${section.id === 'completed' ? ' completed' : ''}`}>
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
                          {isExpanded ? '▾' : '▸'} {section.items.length}
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
              </div>
            )}
          </>
        )}

        {/* ── Goals ── */}
        {tab === 'goals' && (
          <>
            {goalTags.length > 0 && (
              <div className="filter-bar">
                <select className="form-select" value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}>
                  <option value="all">All projects</option>
                  {projects.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
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
                {tasks.some(t => t.category === 'goal' && !t.goalTag) && (
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
                {activeGoals.map(goal => {
                  const { key, ...props } = goalProps(goal);
                  return <ActiveGoalCard key={key} {...props} />;
                })}

                {completedGoals.length > 0 && (
                  <div className="completed-section">
                    <button className="completed-section-toggle" onClick={() => setShowCompletedGoals(!showCompletedGoals)}>
                      {showCompletedGoals ? '▼' : '▶'} Completed Goals ({completedGoals.length})
                    </button>
                    {showCompletedGoals && completedGoals.map(goal => {
                      const { key, ...props } = goalProps(goal);
                      return <CompletedGoalCard key={key} {...props} />;
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {editor && (
        <TaskEditorDialog
          key={editor.editing?.id ?? 'new'}
          initialForm={editor.initialForm}
          isEditing={Boolean(editor.editing)}
          goalTags={goalTags}
          projects={projects.projects}
          onSave={save}
          onClose={closeEditor}
        />
      )}

      <RewardToasts toasts={toasts} showLevelFlash={showLevelFlash} />
    </>
  );
}
