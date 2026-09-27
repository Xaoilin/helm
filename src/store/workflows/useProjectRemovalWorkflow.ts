import { useCallback } from 'react';
import { useProjectContext } from '../contexts/ProjectContext';
import { useTaskContext } from '../contexts/TaskContext';

/** Removes a project and takes its tasks off its board; the planner service works out which from what it stores. */
export function useProjectRemovalWorkflow(): (projectId: string) => void {
  const projects = useProjectContext();
  const tasks = useTaskContext();

  return useCallback((projectId: string) => {
    projects.removeProject(projectId);
    tasks.unlinkProject(projectId);
  }, [projects, tasks]);
}
