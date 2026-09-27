/**
 * Tasks, habits and goals, owned by the planner service. Each change is shown at once and saved as one
 * record; completing a task is the service's own write, which stamps it, awards XP and answers with what it
 * earned. Prayer habits complete through the prayer service: the app only shows them done until the
 * planner confirms. A refused save shows why and reloads what the service holds.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { Task } from '../../types/domain';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import {
  completeTask as completeTaskOnService,
  deleteTask,
  getTasks,
  isPlannerServiceEnabled,
  reopenTask as reopenTaskOnService,
  saveTask,
  taskDetails,
  unlinkProjectTasks,
} from '../../services/backend/plannerServiceApi';
import type { PlannerReward } from '../../services/backend/plannerContracts';
import { useGamificationContext } from './GamificationContext';
import { useSettingsContext } from './SettingsContext';
import { useServiceLoad } from './useServiceLoad';

export interface TaskContextValue {
  tasks: Task[];
  loaded: boolean;
  /** Why the tasks may be out of date; null while they are current. */
  error: string | null;
  reload: () => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  /** Saves a task's details; `completed` true or false completes or reopens it. */
  updateTask: (id: string, updates: Partial<Task>) => void;
  /** Completes a task; resolves with what it earned (null when nothing, or when it was not saved). */
  completeTask: (id: string) => Promise<PlannerReward | null>;
  reopenTask: (id: string) => void;
  removeTask: (id: string) => void;
  /** Takes a removed project's tasks off its board. */
  unlinkProject: (projectId: string) => void;
  /** Shows tasks the service answered with from another write (the daily reset, a prayer reward). */
  applyTasks: (tasks: Task[]) => void;
  applyTask: (task: Task) => void;
  /** Shows a prayer habit done (or not) while the prayer is being recorded; the planner confirms it. */
  showPrayerHabit: (id: string, completed: boolean) => void;
}

export const TaskCtx = createContext<TaskContextValue | null>(null);

export function useTaskContext(): TaskContextValue {
  const ctx = useContext(TaskCtx);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}

function detailsChanged(before: Task, after: Task): boolean {
  return JSON.stringify(taskDetails(before)) !== JSON.stringify(taskDetails(after));
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const { appTimeZone } = useSettingsContext();
  const { applyProfile } = useGamificationContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
  const timeZoneRef = useRef(appTimeZone.effectiveTimeZone);
  useEffect(() => {
    timeZoneRef.current = appTimeZone.effectiveTimeZone;
  }, [appTimeZone.effectiveTimeZone]);

  const publish = useCallback((next: Task[]) => {
    tasksRef.current = next;
    setTasks(next);
  }, []);
  const applyTask = useCallback((saved: Task) => {
    publish(tasksRef.current.some(task => task.id === saved.id)
      ? tasksRef.current.map(task => (task.id === saved.id ? saved : task))
      : [...tasksRef.current, saved]);
  }, [publish]);

  const load = useCallback(async () => publish(await getTasks()), [publish]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Tasks', isPlannerServiceEnabled(), load,
    LIVE_DOMAINS.tasks);

  const completeTask = useCallback(async (id: string): Promise<PlannerReward | null> => {
    const current = tasksRef.current.find(task => task.id === id);
    if (!current || current.completed) return null;
    applyTask({ ...current, completed: true, completedAt: new Date().toISOString() });
    try {
      const completion = await completeTaskOnService(id, timeZoneRef.current);
      applyTask(completion.task);
      applyProfile(completion.profile);
      return completion.reward;
    } catch (completeError) {
      reportFailure(completeError);
      return null;
    }
  }, [applyProfile, applyTask, reportFailure]);

  const reopenTask = useCallback((id: string) => {
    const current = tasksRef.current.find(task => task.id === id);
    if (!current || !current.completed) return;
    applyTask({ ...current, completed: false, completedAt: undefined, completedLocalDate: undefined,
      completionTimeZone: undefined });
    reopenTaskOnService(id).then(applyTask, reportFailure);
  }, [applyTask, reportFailure]);

  const addTask = useCallback((task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    applyTask({ ...task, id, completed: false, completedAt: undefined, createdAt: now, updatedAt: now });
    saveTask(id, taskDetails(task)).then(saved => {
      applyTask(saved);
      if (task.completed && saved.category !== 'prayer') void completeTask(id);
    }, reportFailure);
    return id;
  }, [applyTask, completeTask, reportFailure]);

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    const current = tasksRef.current.find(task => task.id === id);
    if (!current) return;
    const { completed, ...details } = updates;
    // Completion stamps belong to the service: a completed flag completes or reopens the task instead.
    const next: Task = { ...current, ...details, completedAt: current.completedAt, id,
      updatedAt: new Date().toISOString() };
    if (detailsChanged(current, next)) {
      applyTask(next);
      saveTask(id, taskDetails(next)).then(applyTask, reportFailure);
    }
    // A prayer habit's completion follows the prayer service; everything else is completed here.
    if (current.category === 'prayer' || completed === undefined || completed === current.completed) return;
    if (completed) void completeTask(id);
    else reopenTask(id);
  }, [applyTask, completeTask, reopenTask, reportFailure]);

  const removeTask = useCallback((id: string) => {
    publish(tasksRef.current.filter(task => task.id !== id));
    deleteTask(id).catch(reportFailure);
  }, [publish, reportFailure]);

  const unlinkProject = useCallback((projectId: string) => {
    publish(tasksRef.current.map(task => (task.projectId === projectId
      ? { ...task, projectId: undefined, workflowState: undefined, blockedReason: undefined, boardOrder: undefined }
      : task)));
    unlinkProjectTasks(projectId).then(publish, reportFailure);
  }, [publish, reportFailure]);

  const showPrayerHabit = useCallback((id: string, completed: boolean) => {
    const current = tasksRef.current.find(task => task.id === id);
    if (!current || current.completed === completed) return;
    applyTask({ ...current, completed, completedAt: completed ? new Date().toISOString() : undefined });
  }, [applyTask]);

  const value = useMemo<TaskContextValue>(() => ({
    tasks, loaded, error, reload, addTask, updateTask, completeTask, reopenTask, removeTask, unlinkProject,
    applyTasks: publish, applyTask, showPrayerHabit,
  }), [tasks, loaded, error, reload, addTask, updateTask, completeTask, reopenTask, removeTask, unlinkProject,
    publish, applyTask, showPrayerHabit]);

  return <TaskCtx.Provider value={value}>{children}</TaskCtx.Provider>;
}
