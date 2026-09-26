import { getHabitEmoji } from '../../services/habitEmoji';
import { isHabitTask } from '../../services/prayerTasks';
import { getCompletionAppDate, getTaskDueStatus, type TaskDueStatus } from '../../services/taskModel';
import type { Task } from '../../types/domain';
import { formatShortDate, prayerOutcomeLabel } from './taskLabels';
import type { TaskItemProps } from './TaskRow';

const DUE_TONE: Record<TaskDueStatus, 'danger' | 'today' | 'future'> = {
  overdue: 'danger',
  today: 'today',
  tomorrow: 'future',
  future: 'future',
};

function dueLabel(dueDate: string, status: TaskDueStatus): string {
  if (status === 'overdue') return `Overdue · ${formatShortDate(dueDate)}`;
  if (status === 'today') return 'Due today';
  if (status === 'tomorrow') return 'Due tomorrow';
  return `Due ${formatShortDate(dueDate)}`;
}

function footerNote(task: Task, appDate: string, completionDate: string | undefined, outcomeLabel: string | undefined): string {
  if (task.completed) {
    if (outcomeLabel) return `Prayer recorded ${outcomeLabel}`;
    if (completionDate === appDate) return 'Completed today';
    return completionDate ? `Completed ${formatShortDate(completionDate)}` : 'Completed';
  }
  if (task.recurring) return `Repeats ${task.recurring.frequency}`;
  return task.dueDate ? `Scheduled for ${formatShortDate(task.dueDate)}` : 'No due date yet';
}

function kindLabel(task: Task): string {
  if (task.category === 'daily') return 'Routine';
  if (task.category === 'prayer') return 'Prayer';
  return 'Task';
}

/** Card used in the All Tasks view. */
export default function AllTaskCard({
  task, appDate, appTimeZone, projectName, prayerOutcome, deleting,
  onToggle, onEdit, onDeleteRequest, onDeleteCancel, onDelete,
}: TaskItemProps & { appTimeZone: string }) {
  const outcomeLabel = prayerOutcome ? prayerOutcomeLabel(prayerOutcome) : undefined;
  const dueStatus = getTaskDueStatus(task, appDate);
  const completionDate = task.completed ? getCompletionAppDate(task, appTimeZone) : undefined;

  return (
    <div
      id={`task-item-${task.id}`}
      className={`all-task-card ${task.completed ? 'completed' : ''}`}
    >
      <div className="all-task-card-header">
        <div className="all-task-card-main">
          <input
            type="checkbox"
            className="task-checkbox all-task-checkbox"
            checked={task.completed}
            onChange={() => onToggle(task)}
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
              <span className={`all-task-type ${task.category}`}>{kindLabel(task)}</span>
              {prayerOutcome && (
                <span className={`prayer-outcome-badge compact ${prayerOutcome}`}>{outcomeLabel}</span>
              )}
              <span className={`tag tag-${task.priority}`}>{task.priority}</span>
              {task.projectId && <span className="tag tag-connected">{projectName || 'Project'}</span>}
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
          {task.dueDate && dueStatus && (
            <span className={`all-task-date-badge ${DUE_TONE[dueStatus]}`}>
              {dueLabel(task.dueDate, dueStatus)}
            </span>
          )}
          <div className="all-task-card-actions">
            <button className="btn-icon btn-sm" onClick={() => onEdit(task)} aria-label={`Edit "${task.title}"`} style={{ fontSize: 11 }}>
              Edit
            </button>
            <button
              className="btn-icon btn-sm"
              onClick={() => (deleting ? onDeleteCancel() : onDeleteRequest(task.id))}
              aria-label={`Delete "${task.title}"`}
              style={{ fontSize: 11, color: '#ff6b6b' }}
            >
              {deleting ? 'Close' : '×'}
            </button>
          </div>
        </div>
      </div>
      <div className="all-task-card-footer">
        <span>{footerNote(task, appDate, completionDate, outcomeLabel)}</span>
        {isHabitTask(task) && task.recurring && <span>Reset {task.recurring.lastReset ? `last on ${formatShortDate(task.recurring.lastReset)}` : 'automatically'}</span>}
      </div>
      {deleting && (
        <div className="confirm-bar all-task-confirm" role="alert">
          <span>Delete this {task.category === 'daily' ? 'routine' : task.category === 'prayer' ? 'prayer task' : 'task'}?</span>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(task.id)}>Delete</button>
          <button className="btn btn-secondary btn-sm" onClick={onDeleteCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
