import type { Task } from '../../types/domain';
import type { TaskItemActions } from './TaskRow';

interface GoalCardProps extends TaskItemActions {
  goal: Task;
  projectName?: string;
  deleting: boolean;
}

/** An open long-term goal with complete, edit, and remove actions. */
export function ActiveGoalCard({
  goal, projectName, deleting, onToggle, onEdit, onDeleteRequest, onDeleteCancel, onDelete,
}: GoalCardProps) {
  return (
    <div id={`task-item-${goal.id}`} className="goal-card">
      <div className="goal-title">
        {goal.title}
        <span className={`tag tag-${goal.priority}`}>{goal.priority}</span>
        {goal.goalTag && <span className="tag tag-goal">{goal.goalTag}</span>}
        {goal.projectId && <span className="tag tag-connected">{projectName || 'Project'}</span>}
      </div>
      {goal.description && <div className="goal-desc">{goal.description}</div>}
      <div className="goal-meta">
        {goal.dueDate && <span>Target: {goal.dueDate}</span>}
        <span>Created {new Date(goal.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="actions-row" style={{ marginTop: 10 }}>
        <button className="btn btn-success btn-sm" onClick={() => onToggle(goal)}>Mark Complete</button>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(goal)}>Edit</button>
        {deleting ? (
          <div className="confirm-bar" role="alert" style={{ margin: 0 }}>
            Delete this goal?
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(goal.id)}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={onDeleteCancel}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-danger btn-sm" onClick={() => onDeleteRequest(goal.id)}>Remove</button>
        )}
      </div>
    </div>
  );
}

/** A completed goal that can be reopened or removed with a second confirming click. */
export function CompletedGoalCard({
  goal, deleting, onToggle, onDeleteRequest, onDelete,
}: GoalCardProps) {
  return (
    <div
      id={`task-item-${goal.id}`}
      className="goal-card completed"
      style={{ marginTop: 8 }}
    >
      <div className="goal-title" style={{ textDecoration: 'line-through' }}>
        {goal.title}
      </div>
      {goal.completedAt && <div className="goal-meta">Completed {new Date(goal.completedAt).toLocaleDateString()}</div>}
      <div className="actions-row" style={{ marginTop: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => onToggle(goal)}>Reopen</button>
        <button className="btn btn-danger btn-sm" onClick={() => (deleting ? onDelete(goal.id) : onDeleteRequest(goal.id))}>
          {deleting ? 'Confirm Delete' : 'Remove'}
        </button>
      </div>
    </div>
  );
}
