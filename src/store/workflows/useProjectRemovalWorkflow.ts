import { useCallback } from 'react';
import { useProjectContext } from '../contexts/ProjectContext';
import { useTaskContext } from '../contexts/TaskContext';

export function useProjectRemovalWorkflow(): (projectId: string) => void {
  const projects = useProjectContext();
  const tasks = useTaskContext();

  return useCallback((projectId: string) => {
    projects.removeProject(projectId);
    tasks.setTasks(current => current.map(task => (
      task.projectId === projectId
        ? {
          ...task,
          projectId: undefined,
          workflowState: undefined,
          blockedReason: undefined,
          boardOrder: undefined,
          updatedAt: new Date().toISOString(),
        }
        : task
    )));
  }, [projects, tasks]);
}
