import { useState } from 'react';
import { useApp } from '../store/AppContext';
import type { Credential, CredentialSource } from '../types/domain';

export default function CredentialsSurface() {
  const app = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Credential | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  // Form state
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState<CredentialSource>('local-vault');

  const onePasswordConnected = app.integrations.find(i => i.provider === '1password')?.status === 'connected';

  const openAdd = () => {
    setName(''); setUsername(''); setPassword(''); setUrl(''); setNotes('');
    setSource('local-vault'); setEditing(null); setShowForm(true);
  };

  const openEdit = (cred: Credential) => {
    setName(cred.name); setUsername(cred.username); setPassword(cred.password);
    setUrl(cred.url || ''); setNotes(cred.notes || ''); setSource(cred.source);
    setEditing(cred); setShowForm(true);
  };

  const save = () => {
    if (!name.trim() || !username.trim()) return;
    const data = { name: name.trim(), username: username.trim(), password, url: url.trim() || undefined, notes: notes.trim() || undefined, source };
    if (editing) {
      app.updateCredential(editing.id, data);
    } else {
      app.addCredential(data);
    }
    setShowForm(false);
  };

  const toggleReveal = (id: string) => {
    setRevealedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let pass = '';
    for (let i = 0; i < 20; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    setPassword(pass);
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Credentials</h1>
          <div className="subtitle">
            {app.credentials.length === 0 ? 'No stored credentials' : `${app.credentials.length} credential${app.credentials.length > 1 ? 's' : ''}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Credential</button>
      </div>
      <div className="surface-body">
        {/* 1Password preference box */}
        <div className="info-box">
          <strong>1Password is the preferred credential source.</strong><br />
          {onePasswordConnected
            ? 'The 1Password integration is connected. Credentials from 1Password will be preferred over the local vault.'
            : 'The 1Password integration is not connected. Go to Integrations to set it up. Until then, credentials are stored in the local fallback vault.'}
          <br /><br />
          <strong>Fallback local vault:</strong> Credentials added here are stored locally on this machine. They are not encrypted at rest in this MVP. For production use, connect 1Password.
        </div>

        {app.settings.credentialSource === 'onepassword-first' && !onePasswordConnected && (
          <div className="info-box warning">
            Your settings prefer 1Password, but it is not connected. Local vault is active as fallback.
          </div>
        )}

        {app.credentials.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#128273;</div>
            <h3>No credentials stored</h3>
            <p>Add credentials to the local vault, or connect 1Password for managed credential access.</p>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Credential</button>
          </div>
        ) : (
          app.credentials.map(cred => (
            <div key={cred.id} className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">{cred.name}</h3>
                  <div className="card-subtitle">
                    {cred.username} &middot; {cred.source === '1password' ? '1Password' : 'Local Vault'}
                    {cred.url && ` \u00b7 ${cred.url}`}
                  </div>
                </div>
                <span className={`tag ${cred.source === '1password' ? 'tag-connected' : 'tag-disconnected'}`} role="status">
                  {cred.source === '1password' ? '1Password' : 'Local'}
                </span>
              </div>
              <div className="password-field" style={{ margin: '8px 0' }}>
                <span style={{ fontSize: 12, color: '#6b6f85' }}>Password:</span>
                {revealedIds.has(cred.id) ? (
                  <code style={{ fontSize: 12, color: '#e1e4ea', background: '#0f1117', padding: '2px 6px', borderRadius: 4 }}>{cred.password}</code>
                ) : (
                  <span className="masked">{'*'.repeat(12)}</span>
                )}
                <button className="btn-icon btn-sm" onClick={() => toggleReveal(cred.id)} style={{ fontSize: 11 }}>
                  {revealedIds.has(cred.id) ? 'Hide' : 'Show'}
                </button>
                <button className="btn-icon btn-sm" onClick={() => navigator.clipboard.writeText(cred.password)} style={{ fontSize: 11 }}>
                  Copy
                </button>
              </div>
              {cred.notes && <p style={{ fontSize: 12, color: '#6b6f85', margin: '4px 0' }}>{cred.notes}</p>}
              <div className="actions-row" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(cred)}>Edit</button>
                {deletingId === cred.id ? (
                  <div className="confirm-bar" style={{ margin: 0 }} role="alert">
                    Delete this credential permanently?
                    <button className="btn btn-danger btn-sm" onClick={() => { app.removeCredential(cred.id); setDeletingId(null); }}>Delete</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDeletingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={() => setDeletingId(cred.id)}>Delete</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editing ? 'Edit Credential' : 'Add Credential'}>
            <h2>{editing ? 'Edit Credential' : 'Add Credential'}</h2>
            <div className="form-group">
              <label htmlFor="cred-name">Name</label>
              <input id="cred-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., GitHub Token" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="cred-username">Username / Key Name</label>
              <input id="cred-username" className="form-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="username or key identifier" />
            </div>
            <div className="form-group">
              <label htmlFor="cred-password">Password / Secret</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="cred-password" className="form-input" type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="secret value" />
                <button className="btn btn-secondary btn-sm" onClick={generatePassword} type="button">Generate</button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="cred-url">URL (optional)</label>
              <input id="cred-url" className="form-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="form-group">
              <label htmlFor="cred-notes">Notes (optional)</label>
              <textarea id="cred-notes" className="form-input" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="cred-source">Source</label>
              <select id="cred-source" className="form-select" value={source} onChange={e => setSource(e.target.value as CredentialSource)}>
                <option value="local-vault">Local Vault (fallback)</option>
                <option value="1password" disabled={!onePasswordConnected}>1Password {!onePasswordConnected ? '(not connected)' : ''}</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !username.trim()}>
                {editing ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
