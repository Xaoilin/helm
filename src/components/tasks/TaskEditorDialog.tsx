import { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { EMOJI_PALETTE, getHabitEmoji } from '../../services/habitEmoji';
import { PRAYER_TASK_ORDER } from '../../services/prayerTasks';
import {
  areTaskFormsEqual,
  canSaveTaskForm,
  type RecurringFrequency,
  type TaskFormState,
} from '../../services/taskModel';
import type { PrayerName, Project, TaskCategory, TaskPriority } from '../../types/domain';

interface TaskEditorDialogProps {
  initialForm: TaskFormState;
  isEditing: boolean;
  goalTags: string[];
  projects: Project[];
  onSave: (form: TaskFormState) => void;
  onClose: () => void;
}

/** Add/Edit Task modal. Holds the draft and asks before discarding unsaved changes. */
export default function TaskEditorDialog({ initialForm, isEditing, goalTags, projects, onSave, onClose }: TaskEditorDialogProps) {
  const [form, setForm] = useState<TaskFormState>(initialForm);
  const { dialogRef, requestClose } = useDialog({
    open: true,
    onClose,
    dirty: !areTaskFormsEqual(form, initialForm),
  });
  const update = <Key extends keyof TaskFormState>(key: Key, value: TaskFormState[Key]) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const { category, habitEmoji } = form;
  const heading = isEditing ? 'Edit Task' : 'Add Task';

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div
        ref={dialogRef}
        className="modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={heading}
      >
        <h2>{heading}</h2>
        <div className="form-group">
          <label htmlFor={category === 'prayer' ? 'task-prayer-name' : 'task-title'}>{category === 'prayer' ? 'Prayer' : 'Title'}</label>
          {category === 'prayer' ? (
            <select
              id="task-prayer-name"
              className="form-select"
              value={form.prayerName}
              onChange={e => update('prayerName', e.target.value as PrayerName)}
            >
              {PRAYER_TASK_ORDER.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <input id="task-title" className="form-input" value={form.title} onChange={e => update('title', e.target.value)} placeholder="What needs to be done?" />
          )}
        </div>
        <div className="form-group">
          <label htmlFor="task-desc">Description (optional)</label>
          <textarea id="task-desc" className="form-input" value={form.description} onChange={e => update('description', e.target.value)} placeholder="Details, notes, links..." />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="task-category">Type</label>
            <select id="task-category" className="form-select" value={category} onChange={e => update('category', e.target.value as TaskCategory)}>
              <option value="task">One-off Task</option>
              <option value="prayer">Prayer Task</option>
              <option value="daily">Daily Habit</option>
              <option value="goal">Long-term Goal</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="task-priority">Priority</label>
            <select id="task-priority" className="form-select" value={form.priority} onChange={e => update('priority', e.target.value as TaskPriority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        {category !== 'daily' && category !== 'prayer' && (
          <div className="form-group">
            <label htmlFor="task-due">{category === 'goal' ? 'Target Date' : 'Due Date'} (optional)</label>
            <input id="task-due" className="form-input" type="date" value={form.dueDate} onChange={e => update('dueDate', e.target.value)} />
          </div>
        )}
        {category === 'daily' && (
          <>
            <div className="form-group">
              <label htmlFor="task-freq">Repeats</label>
              <select id="task-freq" className="form-select" value={form.recurringFreq} onChange={e => update('recurringFreq', e.target.value as RecurringFrequency)}>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays only</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div className="form-group">
              <label>Icon</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 28 }}>{getHabitEmoji(form.title, habitEmoji)}</span>
                <span style={{ fontSize: 11, color: '#6b6f85' }}>{habitEmoji ? 'Custom' : 'Auto-detected'}</span>
                {habitEmoji && <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }} onClick={() => update('habitEmoji', '')}>Reset</button>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {EMOJI_PALETTE.map(em => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => update('habitEmoji', em)}
                    style={{
                      fontSize: 18, padding: '4px 6px', background: habitEmoji === em ? '#1e2140' : 'transparent',
                      border: habitEmoji === em ? '1px solid #4f5bff' : '1px solid transparent',
                      borderRadius: 6, cursor: 'pointer',
                    }}
                  >{em}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {category === 'goal' && goalTags.length > 0 && (
          <div className="form-group">
            <label htmlFor="task-goaltag">Category</label>
            <select id="task-goaltag" className="form-select" value={form.goalTag} onChange={e => update('goalTag', e.target.value)}>
              <option value="">None</option>
              {goalTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        {category !== 'daily' && category !== 'prayer' && projects.length > 0 && (
          <div className="form-group">
            <label htmlFor="task-project">Project (optional)</label>
            <select id="task-project" className="form-select" value={form.taskProjectId} onChange={e => update('taskProjectId', e.target.value)}>
              <option value="">None</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={requestClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!canSaveTaskForm(form)}>
            {isEditing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
