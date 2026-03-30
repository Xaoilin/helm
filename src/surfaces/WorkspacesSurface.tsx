import { useState } from 'react';
import { useApp } from '../store/AppContext';
import type { Workspace } from '../types/domain';

export default function WorkspacesSurface() {
  const app = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');

  const openAdd = () => {
    setName(''); setPath(''); setDescription(''); setEditing(null); setShowForm(true);
  };

  const openEdit = (ws: Workspace) => {
    setName(ws.name); setPath(ws.path); setDescription(ws.description); setEditing(ws); setShowForm(true);
  };

  const save = () => {
    if (!name.trim() || !path.trim()) return;
    if (editing) {
      app.updateWorkspace(editing.id, { name: name.trim(), path: path.trim(), description: description.trim() });
    } else {
      app.addWorkspace({ name: name.trim(), path: path.trim(), description: description.trim(), isPrimary: false });
    }
    setShowForm(false);
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Workspaces</h1>
          <div className="subtitle">
            {app.workspaces.length === 0
              ? 'No workspaces configured'
              : `${app.workspaces.length} workspace${app.workspaces.length > 1 ? 's' : ''}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Workspace</button>
      </div>
      <div className="surface-body">
        {app.workspaces.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#128193;</div>
            <h3>No workspaces</h3>
            <p>Add your local project directories as workspaces to manage them from HELM.</p>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Workspace</button>
          </div>
        ) : (
          app.workspaces.map(ws => (
            <div key={ws.id} className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">
                    {ws.name}
                    {ws.isPrimary && <span className="tag tag-primary" role="status">Primary</span>}
                  </h3>
                  <div className="card-subtitle">
                    <code style={{ fontSize: 11 }}>{ws.path}</code>
                  </div>
                </div>
              </div>
              {ws.description && <p style={{ fontSize: 13, color: '#8b8fa3', margin: '4px 0 8px' }}>{ws.description}</p>}
              <div className="actions-row">
                {!ws.isPrimary && (
                  <button className="btn btn-secondary btn-sm" onClick={() => app.setPrimaryWorkspace(ws.id)}>Set Primary</button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(ws)}>Edit</button>
                {deletingId === ws.id ? (
                  <div className="confirm-bar" style={{ margin: 0 }} role="alert">
                    Remove this workspace?
                    <button className="btn btn-danger btn-sm" onClick={() => { app.removeWorkspace(ws.id); setDeletingId(null); }}>Remove</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={() => setDeletingId(ws.id)}>Remove</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing ? 'Edit Workspace' : 'Add Workspace'}>
            <h2>{editing ? 'Edit Workspace' : 'Add Workspace'}</h2>
            <div className="form-group">
              <label htmlFor="ws-name">Name</label>
              <input id="ws-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., My SaaS App" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="ws-path">Path</label>
              <input id="ws-path" className="form-input" value={path} onChange={e => setPath(e.target.value)} placeholder="C:\Users\you\projects\my-app" />
            </div>
            <div className="form-group">
              <label htmlFor="ws-description">Description (optional)</label>
              <textarea id="ws-description" className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this project?" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !path.trim()}>
                {editing ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
