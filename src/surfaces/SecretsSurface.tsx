import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useApp } from '../store/AppContext';
import { subscribeHelmSecretChanges } from '../store/persistence';
import {
  listHelmSecrets,
  revealHelmSecret,
  saveHelmSecret,
  setHelmSecretArchived,
} from '../store/supabase';
import type {
  HelmSecretDetail,
  HelmSecretSummary,
  SaveHelmSecretInput,
  SecretKind,
} from '../types/domain';

const SECRET_KIND_OPTIONS: Array<{ value: SecretKind; label: string }> = [
  { value: 'password', label: 'Password' },
  { value: 'api_key', label: 'API key' },
  { value: 'access_token', label: 'Access token' },
  { value: 'database', label: 'Database' },
  { value: 'private_key', label: 'Private key' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'other', label: 'Other' },
];

interface SecretFormState {
  secretId?: string;
  label: string;
  kind: SecretKind;
  environment: string;
  projectCatalogKeys: string[];
  value: string;
  username: string;
  url: string;
  notes: string;
  sourceRef: string | null;
}

const EMPTY_FORM: SecretFormState = {
  label: '',
  kind: 'password',
  environment: '',
  projectCatalogKeys: [],
  value: '',
  username: '',
  url: '',
  notes: '',
  sourceRef: null,
};

function replaceSummary(
  current: HelmSecretSummary[],
  replacement: HelmSecretSummary,
): HelmSecretSummary[] {
  const next = current.filter(secret => secret.secretId !== replacement.secretId);
  next.push(replacement);
  return next.sort((left, right) => {
    const archiveDifference = Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt));
    return archiveDifference || left.label.localeCompare(right.label) || left.secretId.localeCompare(right.secretId);
  });
}

function kindLabel(kind: SecretKind): string {
  return SECRET_KIND_OPTIONS.find(option => option.value === kind)?.label || 'Other';
}

function safeExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default function SecretsSurface() {
  const app = useApp();
  const [secrets, setSecrets] = useState<HelmSecretSummary[]>([]);
  const [revealed, setRevealed] = useState<Record<string, HelmSecretDetail>>({});
  const [loading, setLoading] = useState(true);
  const [busySecretId, setBusySecretId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<SecretKind | 'all'>('all');
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<SecretFormState | null>(null);
  const importedDeviceSecrets = useRef(false);

  const clearRevealed = useCallback(() => {
    setRevealed({});
    setForm(current => current ? { ...current, value: '' } : current);
  }, []);

  const fetchSummaries = useCallback(async () => {
    const response = await listHelmSecrets();
    setSecrets(response.secrets);
    return response.secrets;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchSummaries()
      .catch(fetchError => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clearRevealed, fetchSummaries]);

  useEffect(() => subscribeHelmSecretChanges(event => {
    setRevealed(current => {
      if (!current[event.secretId]) return current;
      const next = { ...current };
      delete next[event.secretId];
      return next;
    });
    void fetchSummaries().catch(fetchError => {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    });
  }), [fetchSummaries]);

  useEffect(() => {
    const hideSensitiveState = () => clearRevealed();
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') hideSensitiveState();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', hideSensitiveState);
    window.addEventListener('pagehide', hideSensitiveState);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', hideSensitiveState);
      window.removeEventListener('pagehide', hideSensitiveState);
    };
  }, [clearRevealed]);

  useEffect(() => {
    if (loading || importedDeviceSecrets.current) return;
    importedDeviceSecrets.current = true;
    const helmProjectKey = app.projects.find(project => project.name.trim().toLowerCase() === 'helm')?.catalogKey
      || 'catalog:helm';
    const candidates: Array<{ sourceRef: string; label: string; value: string | undefined; kind: SecretKind }> = [
      {
        sourceRef: 'device-settings:deepgramApiKey:v1',
        label: 'HELM Deepgram API key',
        value: app.settings.deepgramApiKey,
        kind: 'api_key',
      },
      {
        sourceRef: 'device-settings:elevenLabsApiKey:v1',
        label: 'HELM ElevenLabs API key',
        value: app.settings.elevenLabsApiKey,
        kind: 'api_key',
      },
    ];
    const existingSources = new Set(secrets.map(secret => secret.sourceRef).filter(Boolean));
    const pending = candidates.filter(candidate => (
      Boolean(candidate.value?.trim()) && !existingSources.has(candidate.sourceRef)
    ));
    if (pending.length === 0) return;

    void (async () => {
      let importedCount = 0;
      for (const candidate of pending) {
        try {
          await saveHelmSecret(uuid(), {
            label: candidate.label,
            kind: candidate.kind,
            environment: 'production',
            projectCatalogKeys: [helmProjectKey],
            value: candidate.value!,
            sourceRef: candidate.sourceRef,
          });
          importedCount += 1;
        } catch {
          // A concurrent device may have imported this stable source first.
          // The database copy wins and the original device value is preserved.
        }
      }
      await fetchSummaries();
      if (importedCount > 0) {
        setNotice(`${importedCount} device secret${importedCount === 1 ? '' : 's'} securely imported.`);
      }
    })().catch(importError => {
      setError(importError instanceof Error ? importError.message : String(importError));
    });
  }, [app.projects, app.settings.deepgramApiKey, app.settings.elevenLabsApiKey, fetchSummaries, loading, secrets]);

  const environments = useMemo(() => [...new Set(
    secrets.map(secret => secret.environment).filter((value): value is string => Boolean(value)),
  )].sort(), [secrets]);

  const projectLabels = useMemo(() => new Map(
    app.projects
      .filter(project => project.catalogKey)
      .map(project => [project.catalogKey!, project.name]),
  ), [app.projects]);

  const visibleSecrets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return secrets.filter(secret => {
      if (!showArchived && secret.archivedAt) return false;
      if (kindFilter !== 'all' && secret.kind !== kindFilter) return false;
      if (environmentFilter !== 'all' && secret.environment !== environmentFilter) return false;
      if (projectFilter !== 'all' && !secret.projectCatalogKeys.includes(projectFilter)) return false;
      if (!normalizedQuery) return true;
      const projectNames = secret.projectCatalogKeys.map(key => projectLabels.get(key) || key);
      return [secret.label, secret.kind, secret.environment || '', ...projectNames]
        .some(value => value.toLowerCase().includes(normalizedQuery));
    });
  }, [environmentFilter, kindFilter, projectFilter, projectLabels, query, secrets, showArchived]);

  const toggleReveal = async (secret: HelmSecretSummary) => {
    if (revealed[secret.secretId]) {
      setRevealed(current => {
        const next = { ...current };
        delete next[secret.secretId];
        return next;
      });
      return;
    }
    setBusySecretId(secret.secretId);
    setError(null);
    try {
      const detail = await revealHelmSecret(secret.secretId);
      setRevealed(current => ({ ...current, [secret.secretId]: detail }));
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : String(revealError));
    } finally {
      setBusySecretId(null);
    }
  };

  const copySecret = async (secret: HelmSecretSummary) => {
    setBusySecretId(secret.secretId);
    setError(null);
    try {
      const detail = revealed[secret.secretId] || await revealHelmSecret(secret.secretId);
      await navigator.clipboard.writeText(detail.value);
      setNotice(`${secret.label} copied.`);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    } finally {
      setBusySecretId(null);
    }
  };

  const openEdit = async (secret: HelmSecretSummary) => {
    setBusySecretId(secret.secretId);
    setError(null);
    try {
      const detail = await revealHelmSecret(secret.secretId);
      setForm({
        secretId: secret.secretId,
        label: secret.label,
        kind: secret.kind,
        environment: secret.environment || '',
        projectCatalogKeys: [...secret.projectCatalogKeys],
        value: detail.value,
        username: detail.username || '',
        url: detail.url || '',
        notes: detail.notes || '',
        sourceRef: secret.sourceRef,
      });
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : String(editError));
    } finally {
      setBusySecretId(null);
    }
  };

  const closeForm = () => {
    setForm(null);
  };

  const submitForm = async () => {
    if (!form || !form.label.trim() || (!form.secretId && !form.value)) return;
    setSaving(true);
    setError(null);
    const input: SaveHelmSecretInput = {
      secretId: form.secretId,
      label: form.label.trim(),
      kind: form.kind,
      environment: form.environment.trim() || null,
      projectCatalogKeys: form.projectCatalogKeys,
      value: form.value || null,
      username: form.username.trim() || null,
      url: form.url.trim() || null,
      notes: form.notes.trim() || null,
      sourceRef: form.sourceRef,
    };
    try {
      const saved = await saveHelmSecret(uuid(), input);
      setSecrets(current => replaceSummary(current, saved));
      setRevealed(current => {
        const next = { ...current };
        delete next[saved.secretId];
        return next;
      });
      setForm(null);
      setNotice(`${saved.label} saved securely.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const setArchived = async (secret: HelmSecretSummary, archived: boolean) => {
    setBusySecretId(secret.secretId);
    setError(null);
    try {
      const updated = await setHelmSecretArchived(uuid(), secret.secretId, archived);
      setSecrets(current => replaceSummary(current, updated));
      setRevealed(current => {
        const next = { ...current };
        delete next[secret.secretId];
        return next;
      });
      setNotice(`${secret.label} ${archived ? 'archived' : 'restored'}.`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : String(archiveError));
    } finally {
      setBusySecretId(null);
    }
  };

  const toggleProject = (catalogKey: string) => {
    setForm(current => {
      if (!current) return current;
      const selected = current.projectCatalogKeys.includes(catalogKey);
      return {
        ...current,
        projectCatalogKeys: selected
          ? current.projectCatalogKeys.filter(key => key !== catalogKey)
          : [...current.projectCatalogKeys, catalogKey],
      };
    });
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Secrets</h1>
          <div className="subtitle">Encrypted, account-owned credentials with one-click access</div>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setForm({ ...EMPTY_FORM })}>
          + Add Secret
        </button>
      </div>

      <div className="surface-body secrets-surface">
        <section className="secrets-security-note" aria-label="Secret security model">
          <span aria-hidden="true">🔒</span>
          <div>
            <strong>Encrypted in your account database</strong>
            <p>Values stay hidden until you reveal or copy one, and are cleared from this screen when HELM loses focus.</p>
          </div>
        </section>

        {error && <div className="secrets-message secrets-message-error" role="alert">{error}</div>}
        {notice && (
          <div className="secrets-message secrets-message-success" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
          </div>
        )}

        <div className="secrets-filters" aria-label="Filter secrets">
          <input
            className="form-input secrets-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search labels, projects, types, or environments"
            aria-label="Search secrets"
          />
          <select className="form-select" value={kindFilter} onChange={event => setKindFilter(event.target.value as SecretKind | 'all')} aria-label="Filter by type">
            <option value="all">All types</option>
            {SECRET_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className="form-select" value={environmentFilter} onChange={event => setEnvironmentFilter(event.target.value)} aria-label="Filter by environment">
            <option value="all">All environments</option>
            {environments.map(environment => <option key={environment} value={environment}>{environment}</option>)}
          </select>
          <select className="form-select" value={projectFilter} onChange={event => setProjectFilter(event.target.value)} aria-label="Filter by project">
            <option value="all">All projects</option>
            {app.projects.filter(project => project.catalogKey).map(project => (
              <option key={project.catalogKey} value={project.catalogKey}>{project.name}</option>
            ))}
          </select>
          <label className="secrets-archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
            Show archived
          </label>
        </div>

        {loading ? (
          <div className="empty-state" role="status"><h3>Loading secrets…</h3></div>
        ) : visibleSecrets.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">🔐</div>
            <h3>{secrets.length === 0 ? 'Your vault is ready' : 'No secrets match these filters'}</h3>
            <p>{secrets.length === 0 ? 'Add a password, API key, token, or database credential.' : 'Change the filters to see more credentials.'}</p>
            {secrets.length === 0 && <button className="btn btn-primary" type="button" onClick={() => setForm({ ...EMPTY_FORM })}>+ Add Secret</button>}
          </div>
        ) : (
          <div className="secrets-grid">
            {visibleSecrets.map(secret => {
              const detail = revealed[secret.secretId];
              const busy = busySecretId === secret.secretId;
              return (
                <article className={`secret-card${secret.archivedAt ? ' is-archived' : ''}`} key={secret.secretId}>
                  <div className="secret-card-heading">
                    <div className="secret-card-icon" aria-hidden="true">🔑</div>
                    <div>
                      <h2>{secret.label}</h2>
                      <div className="secret-card-tags">
                        <span>{kindLabel(secret.kind)}</span>
                        {secret.environment && <span>{secret.environment}</span>}
                        {secret.archivedAt && <span>Archived</span>}
                      </div>
                    </div>
                  </div>

                  <div className="secret-value-row">
                    <code aria-label={detail ? `Revealed value for ${secret.label}` : `Hidden value for ${secret.label}`}>
                      {detail ? detail.value : '••••••••••••'}
                    </code>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy || Boolean(secret.archivedAt)} onClick={() => void toggleReveal(secret)}>
                      {detail ? 'Hide' : busy ? 'Loading…' : 'Reveal'}
                    </button>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy || Boolean(secret.archivedAt)} onClick={() => void copySecret(secret)}>
                      Copy
                    </button>
                  </div>

                  {(detail?.username || detail?.url || detail?.notes) && (
                    <dl className="secret-detail-list">
                      {detail.username && <><dt>Username</dt><dd>{detail.username}</dd></>}
                      {detail.url && <><dt>URL</dt><dd>{safeExternalUrl(detail.url)
                        ? <a href={safeExternalUrl(detail.url)!} target="_blank" rel="noreferrer">{detail.url}</a>
                        : detail.url}</dd></>}
                      {detail.notes && <><dt>Notes</dt><dd>{detail.notes}</dd></>}
                    </dl>
                  )}

                  {secret.projectCatalogKeys.length > 0 && (
                    <div className="secret-projects">
                      {secret.projectCatalogKeys.map(key => <span key={key}>{projectLabels.get(key) || key}</span>)}
                    </div>
                  )}

                  <div className="secret-card-actions">
                    {!secret.archivedAt && <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void openEdit(secret)}>Edit</button>}
                    <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => void setArchived(secret, !secret.archivedAt)}>
                      {secret.archivedAt ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {form && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal secret-modal" role="dialog" aria-modal="true" aria-label={form.secretId ? 'Edit secret' : 'Add secret'} onClick={event => event.stopPropagation()}>
            <h2>{form.secretId ? 'Edit Secret' : 'Add Secret'}</h2>
            <div className="secret-form-grid">
              <div className="form-group secret-form-wide">
                <label htmlFor="secret-label">Label</label>
                <input id="secret-label" className="form-input" autoFocus value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Production database password" />
              </div>
              <div className="form-group">
                <label htmlFor="secret-kind">Type</label>
                <select id="secret-kind" className="form-select" value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as SecretKind })}>
                  {SECRET_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="secret-environment">Environment</label>
                <input id="secret-environment" className="form-input" value={form.environment} onChange={event => setForm({ ...form, environment: event.target.value })} placeholder="production" />
              </div>
              <div className="form-group secret-form-wide">
                <label htmlFor="secret-value">Secret value</label>
                <input id="secret-value" className="form-input secret-edit-value" type="password" value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} spellCheck={false} autoComplete="new-password" placeholder="Enter the password or secret" />
              </div>
              <div className="form-group">
                <label htmlFor="secret-username">Username</label>
                <input id="secret-username" className="form-input" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="off" />
              </div>
              <div className="form-group">
                <label htmlFor="secret-url">URL</label>
                <input id="secret-url" className="form-input" type="url" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} placeholder="https://…" />
              </div>
              <div className="form-group secret-form-wide">
                <label htmlFor="secret-notes">Notes</label>
                <textarea id="secret-notes" className="form-input" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
              </div>
            </div>

            <fieldset className="secret-project-picker">
              <legend>Projects</legend>
              {app.projects.filter(project => project.catalogKey).map(project => (
                <label key={project.catalogKey}>
                  <input type="checkbox" checked={form.projectCatalogKeys.includes(project.catalogKey!)} onChange={() => toggleProject(project.catalogKey!)} />
                  <span>{project.name}</span>
                </label>
              ))}
            </fieldset>

            <div className="modal-actions">
              <button className="btn btn-secondary" type="button" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={() => void submitForm()} disabled={saving || !form.label.trim() || (!form.secretId && !form.value)}>
                {saving ? 'Saving…' : 'Save Secret'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
