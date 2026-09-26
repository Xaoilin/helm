import { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import {
  PROJECT_KIND_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  canSaveProjectDraft,
  getProjectStatusLabel,
  projectDraftFrom,
  withDraftStatus,
  type ProjectDraft,
} from '../../services/projectModel';
import type { Project, ProjectKind, ProjectStatus } from '../../types/domain';

/**
 * Add or edit a project's reference details. The dialog owns its draft and
 * hands a complete draft to `onSave`; the caller decides which writes apply.
 */
export function ProjectEditorDialog({
  project,
  onSave,
  onClose,
  restoreFocusFallback,
}: {
  /** The project being edited, or null to add one. */
  project: Project | null;
  onSave: (draft: ProjectDraft) => void;
  onClose: () => void;
  restoreFocusFallback?: () => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() => projectDraftFrom(project));
  const { dialogRef, requestClose } = useDialog({ open: true, onClose, restoreFocusFallback });
  const canSave = canSaveProjectDraft(draft);
  const title = project ? 'Edit Project' : 'Add Project';

  function update(changes: Partial<ProjectDraft>): void {
    setDraft(current => ({ ...current, ...changes }));
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div ref={dialogRef} className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <h2>{title}</h2>
        <div className="form-group">
          <label htmlFor="project-name">Name</label>
          <input id="project-name" className="form-input" value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="Project name" />
        </div>
        <div className="form-group">
          <label htmlFor="project-summary">Summary</label>
          <textarea id="project-summary" className="form-input" value={draft.summary} onChange={event => update({ summary: event.target.value })} placeholder="What is this project for?" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label htmlFor="project-kind">Type</label>
            <select id="project-kind" className="form-select" value={draft.kind} onChange={event => update({ kind: event.target.value as ProjectKind })}>
              {PROJECT_KIND_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="project-status">Status</label>
            <select
              id="project-status"
              className="form-select"
              value={draft.status}
              onChange={event => setDraft(current => withDraftStatus(current, event.target.value as ProjectStatus))}
            >
              {PROJECT_STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{getProjectStatusLabel(status)}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="project-tags">Tags</label>
            <input id="project-tags" className="form-input" value={draft.tagsInput} onChange={event => update({ tagsInput: event.target.value })} placeholder="client, launch, frontend" />
          </div>
          <div className="form-group">
            <label htmlFor="project-repository">Repository URL</label>
            <input id="project-repository" className="form-input" type="url" value={draft.repositoryUrl} onChange={event => update({ repositoryUrl: event.target.value })} placeholder="https://github.com/…" />
          </div>
          <div className="form-group">
            <label htmlFor="project-deployment">Live URL</label>
            <input id="project-deployment" className="form-input" type="url" value={draft.deploymentUrl} onChange={event => update({ deploymentUrl: event.target.value })} placeholder="https://…" />
          </div>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#cfd3e6' }}>
          <input
            type="checkbox"
            checked={draft.pinned}
            disabled={draft.status === 'archived'}
            onChange={event => update({ pinned: event.target.checked })}
          />
          {draft.status === 'archived'
            ? 'Archived projects cannot be pinned'
            : 'Pin this project at the top of the catalogue'}
        </label>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={requestClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (canSave) onSave(draft); }} disabled={!canSave}>
            {project ? 'Save Project' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
