import { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { milestoneDraftFrom, type MilestoneDraft } from '../../services/projectModel';
import type { Task, TaskPriority } from '../../types/domain';

/** Add or edit a project milestone (a project-linked goal). */
export function MilestoneEditorDialog({
  milestone,
  onSave,
  onClose,
}: {
  /** The milestone being edited, or null to add one. */
  milestone: Task | null;
  onSave: (draft: MilestoneDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MilestoneDraft>(() => milestoneDraftFrom(milestone));
  const { dialogRef, requestClose } = useDialog({ open: true, onClose });
  const canSave = Boolean(draft.title.trim());
  const title = milestone ? 'Edit Milestone' : 'Add Milestone';

  function update(changes: Partial<MilestoneDraft>): void {
    setDraft(current => ({ ...current, ...changes }));
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div ref={dialogRef} className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <h2>{title}</h2>
        <div className="form-group">
          <label htmlFor="milestone-title">Title</label>
          <input id="milestone-title" className="form-input" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="Milestone title" />
        </div>
        <div className="form-group">
          <label htmlFor="milestone-description">Description</label>
          <textarea id="milestone-description" className="form-input" value={draft.description} onChange={event => update({ description: event.target.value })} placeholder="What outcome defines this milestone?" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="milestone-due">Target Date</label>
            <input id="milestone-due" className="form-input" type="date" value={draft.dueDate} onChange={event => update({ dueDate: event.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="milestone-priority">Priority</label>
            <select id="milestone-priority" className="form-select" value={draft.priority} onChange={event => update({ priority: event.target.value as TaskPriority })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={requestClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (canSave) onSave(draft); }} disabled={!canSave}>
            {milestone ? 'Save Milestone' : 'Create Milestone'}
          </button>
        </div>
      </div>
    </div>
  );
}
