import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { Task } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import {
  getPrayerTaskName,
  getPrayerTaskTitle,
  isPrayerTask,
} from '../../services/prayerTasks';

export interface TaskContextValue {
  tasks: Task[];
  loaded: boolean;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}

const TaskCtx = createContext<TaskContextValue | null>(null);

function normalizeTask(task: Task): Task {
  const prayerName = getPrayerTaskName(task);
  const recurring = task.category === 'prayer'
    ? task.recurring || { frequency: 'daily' }
    : task.recurring;

  return {
    ...task,
    category: isPrayerTask(task) ? 'prayer' : task.category,
    title: prayerName && task.category === 'prayer' ? getPrayerTaskTitle(prayerName) : task.title,
    prayerName: prayerName || undefined,
    recurring,
    dueDate: isPrayerTask(task) ? undefined : task.dueDate,
    projectId: task.projectId || undefined,
    workflowState: task.workflowState || undefined,
    blockedReason: task.blockedReason?.trim() || undefined,
    boardOrder: typeof task.boardOrder === 'number' ? task.boardOrder : undefined,
  };
}

export function useTaskContext(): TaskContextValue {
  const ctx = useContext(TaskCtx);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await loadStore<Task[]>('tasks');
      setTasks((data ?? []).map(normalizeTask));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStore('tasks', tasks); }, [tasks, loaded]);

  const addTask = useCallback((task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setTasks(prev => [...prev, normalizeTask({ ...task, id, createdAt: now, updatedAt: now })]);
    return id;
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    setTasks(prev =>
      prev.map(t => (t.id === id
        ? normalizeTask({ ...t, ...updates, updatedAt: new Date().toISOString() })
        : t))
    );
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <TaskCtx.Provider value={{ tasks, loaded, addTask, updateTask, removeTask, setTasks }}>
      {children}
    </TaskCtx.Provider>
  );
}
