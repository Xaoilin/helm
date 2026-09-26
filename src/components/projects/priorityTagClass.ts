import type { TaskPriority } from '../../types/domain';

/** The shared `.tag` colour class for a task or milestone priority. */
export function priorityTagClass(priority: TaskPriority): string {
  if (priority === 'high') return 'tag-overdue';
  return priority === 'medium' ? 'tag-primary' : 'tag-connected';
}
