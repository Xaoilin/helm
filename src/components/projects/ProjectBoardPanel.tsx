import { useMemo, useState } from 'react';
import { useTaskContext } from '../../store/contexts/TaskContext';
import { priorityTagClass } from './priorityTagClass';
import {
  BOARD_COLUMNS,
  EMPTY_BOARD_TASK_DRAFT,
  buildBoardMoveUpdate,
  buildBoardTask,
  formatProjectTimestamp,
  getAdjacentBoardColumn,
  getBoardColumn,
  getNextBoardOrder,
  groupBoardTasks,
  needsBlockedReason,
  type BoardColumn,
  type BoardTaskDraft,
} from '../../services/projectModel';
import type { Project, Task, TaskPriority } from '../../types/domain';

/** The project's Kanban board: quick add, drag between columns, and keyboard moves. */
export function ProjectBoardPanel({ project, boardTasks }: { project: Project; boardTasks: Task[] }) {
  const tasks = useTaskContext();
  const [draft, setDraft] = useState<BoardTaskDraft>(EMPTY_BOARD_TASK_DRAFT);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const columns = useMemo(() => groupBoardTasks(boardTasks), [boardTasks]);

  function addTask(): void {
    const task = buildBoardTask(draft, project.id, getNextBoardOrder(columns.backlog));
    if (!task) return;
    tasks.addTask(task);
    setDraft(EMPTY_BOARD_TASK_DRAFT);
  }

  function moveTask(task: Task, target: BoardColumn): void {
    const blockedReasonAnswer = needsBlockedReason(task, target)
      ? window.prompt('What is blocking this task?', task.blockedReason || '')
      : undefined;
    tasks.updateTask(task.id, buildBoardMoveUpdate(task, target, {
      now: new Date().toISOString(),
      boardOrder: getNextBoardOrder(columns[target], task.id),
      blockedReasonAnswer,
    }));
  }

  function moveTaskHorizontally(task: Task, direction: -1 | 1): void {
    const target = getAdjacentBoardColumn(task, direction);
    if (target) moveTask(task, target);
  }

  function removeTask(task: Task): void {
    if (window.confirm(`Delete "${task.title}"?`)) tasks.removeTask(task.id);
  }

  return (
    <div id="project-panel-board" className="project-board" role="tabpanel" aria-labelledby="project-tab-board" tabIndex={0}>
      {BOARD_COLUMNS.map(column => {
        const columnTasks = columns[column.key];
        return (
          <div
            key={column.key}
            className="card"
            style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start', minHeight: 420 }}
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              const task = boardTasks.find(item => item.id === draggedTaskId);
              if (task) moveTask(task, column.key);
              setDraggedTaskId(null);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>{column.label}</div>
              <span style={{ fontSize: 12, color: '#8b8fa3' }}>{columnTasks.length}</span>
            </div>

            {column.key === 'backlog' && (
              <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 12, border: '1px dashed #30364d', background: '#141926' }}>
                <input
                  className="form-input"
                  value={draft.title}
                  onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
                  placeholder="Quick add task"
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                  <input className="form-input" type="date" value={draft.dueDate} onChange={event => setDraft(current => ({ ...current, dueDate: event.target.value }))} />
                  <select className="form-select" value={draft.priority} onChange={event => setDraft(current => ({ ...current, priority: event.target.value as TaskPriority }))}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={addTask} disabled={!draft.title.trim()}>Add</button>
                </div>
              </div>
            )}

            {columnTasks.length === 0 && (
              <div style={{ fontSize: 12, color: '#6b6f85', padding: 12, borderRadius: 12, background: '#111520' }}>
                {column.key === 'done' ? 'Completed cards land here automatically.' : 'No cards in this column yet.'}
              </div>
            )}

            {columnTasks.map(task => (
              <BoardCard
                key={task.id}
                task={task}
                onDragStart={() => setDraggedTaskId(task.id)}
                onDragEnd={() => setDraggedTaskId(null)}
                onMove={target => moveTask(task, target)}
                onMoveHorizontally={direction => moveTaskHorizontally(task, direction)}
                onRemove={() => removeTask(task)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  task,
  onDragStart,
  onDragEnd,
  onMove,
  onMoveHorizontally,
  onRemove,
}: {
  task: Task;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (target: BoardColumn) => void;
  onMoveHorizontally: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const column = getBoardColumn(task);
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 10, cursor: 'grab' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 600, color: '#f5f7ff' }}>{task.title}</div>
        <span className={`tag ${priorityTagClass(task.priority)}`}>{task.priority}</span>
      </div>
      {task.description && <div style={{ fontSize: 12, color: '#8b8fa3' }}>{task.description}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#8b8fa3' }}>
        {task.dueDate && <span>{task.completed ? `Completed ${task.completedAt ? formatProjectTimestamp(task.completedAt) : task.dueDate}` : `Due ${task.dueDate}`}</span>}
        {!task.dueDate && task.completed && task.completedAt && <span>Completed {formatProjectTimestamp(task.completedAt)}</span>}
      </div>
      {column === 'blocked' && (
        <div style={{ fontSize: 12, color: '#fca5a5', padding: 10, borderRadius: 10, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.22)' }}>
          {task.blockedReason || 'No blocked reason recorded.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" aria-label={`Move ${task.title} to the previous column`} onClick={() => onMoveHorizontally(-1)} disabled={column === 'backlog'}>&larr;</button>
        <button className="btn btn-secondary btn-sm" aria-label={`Move ${task.title} to the next column`} onClick={() => onMoveHorizontally(1)} disabled={column === 'done'}>&rarr;</button>
        {column !== 'done' ? (
          <button className="btn btn-secondary btn-sm" onClick={() => onMove('done')}>Done</button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => onMove('backlog')}>Reopen</button>
        )}
        <button className="btn btn-danger btn-sm" onClick={onRemove}>Delete</button>
      </div>
    </article>
  );
}
