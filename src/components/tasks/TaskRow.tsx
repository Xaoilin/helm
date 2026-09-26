import { getTaskDueStatus } from '../../services/taskModel';
import type { PrayerOutcomeStatus, Task } from '../../types/domain';
import { compactPrayerOutcomeLabel } from './taskLabels';

/** Callbacks shared by every task list item on the Tasks page. */
export interface TaskItemActions {
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDeleteRequest: (taskId: string) => void;
  onDeleteCancel: () => void;
  onDelete: (taskId: string) => void;
}

export interface TaskItemProps extends TaskItemActions {
  task: Task;
  appDate: string;
  projectName?: string;
  prayerOutcome?: PrayerOutcomeStatus;
  deleting: boolean;
}

/** Compact row used in the Today view's "Due Today" list. */
export default function TaskRow({
  task, appDate, projectName, prayerOutcome, deleting,
  onToggle, onEdit, onDeleteRequest, onDeleteCancel, onDelete,
}: TaskItemProps) {
  const overdue = getTaskDueStatus(task, appDate) === 'overdue';
  return (
    <div
      id={`task-item-${task.id}`}
      className={`task-row ${task.completed ? 'completed' : ''}`}
    >
      <input
        type="checkbox"
        className="task-checkbox"
        checked={task.completed}
        onChange={() => onToggle(task)}
        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
      />
      <div className="task-content">
        {task.projectId && (
          <div style={{ marginBottom: 6 }}>
            <span className="tag tag-connected">{projectName || 'Project'}</span>
          </div>
        )}
        <div className={`task-title ${task.completed ? 'task-title-done' : ''}`}>
          {task.title}
          {task.priority !== 'low' && <span className={`tag tag-${task.priority}`}>{task.priority}</span>}
          {task.category === 'daily' && <span className="tag tag-daily">daily</span>}
          {task.category === 'prayer' && <span className="tag tag-daily">prayer</span>}
          {prayerOutcome && (
            <span className={`prayer-outcome-badge compact ${prayerOutcome}`}>{compactPrayerOutcomeLabel(prayerOutcome)}</span>
          )}
        </div>
        <div className="task-meta">
          {task.dueDate && (
            <span className={overdue ? 'tag tag-overdue' : ''} style={overdue ? { padding: '1px 6px', borderRadius: 3 } : {}}>
              {overdue ? 'Overdue' : `Due ${task.dueDate}`}
            </span>
          )}
          {task.category === 'prayer'
            ? <span>Islamic prayer</span>
            : task.recurring && <span>Repeats {task.recurring.frequency}</span>}
          {task.description && <span>{task.description.slice(0, 60)}{task.description.length > 60 ? '...' : ''}</span>}
        </div>
      </div>
      <div className="task-actions">
        <button className="btn-icon btn-sm" onClick={() => onEdit(task)} aria-label={`Edit "${task.title}"`} style={{ fontSize: 11 }}>Edit</button>
        {deleting ? (
          <div className="confirm-bar" role="alert" style={{ margin: 0, padding: '4px 8px' }}>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(task.id)}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={onDeleteCancel}>Cancel</button>
          </div>
        ) : (
          <button className="btn-icon btn-sm" onClick={() => onDeleteRequest(task.id)} aria-label={`Delete "${task.title}"`} style={{ fontSize: 11, color: '#ff6b6b' }}>&times;</button>
        )}
      </div>
    </div>
  );
}
