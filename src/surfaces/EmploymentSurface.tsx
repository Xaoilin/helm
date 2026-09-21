import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { v4 as uuid } from 'uuid';
import {
  EMPLOYMENT_ACTIVE_STATUSES,
  getEmploymentActivity,
  getEmploymentActivityDate,
  groupEmploymentApplications,
  matchesEmploymentFilters,
  type EmploymentApplicationDraft,
  type EmploymentFilters,
} from '../services/employmentTracker';
import { useEmploymentContext } from '../store/contexts/EmploymentContext';
import type {
  EmploymentApplication,
  EmploymentApplicationStatus,
  EmploymentHistoryKind,
  EmploymentRemoteRegion,
  EmploymentRemoteStatus,
  EmploymentWorkType,
} from '../types/domain';

const STATUS_OPTIONS: Array<{ value: EmploymentApplicationStatus; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'recruiter', label: 'Recruiter' },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'closed', label: 'Closed' },
];
const WORK_TYPE_OPTIONS: Array<{ value: EmploymentWorkType; label: string }> = [
  { value: 'contract', label: 'Contract' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'unknown', label: 'Not recorded' },
];
const REMOTE_STATUS_OPTIONS: Array<{ value: EmploymentRemoteStatus; label: string }> = [
  { value: 'confirmed', label: 'Confirmed fully remote' },
  { value: 'needs_verification', label: 'Needs verification' },
];
const REMOTE_REGION_OPTIONS: Array<{ value: EmploymentRemoteRegion; label: string }> = [
  { value: 'uk', label: 'UK eligible' },
  { value: 'emea', label: 'EMEA eligible' },
  { value: 'global', label: 'Global eligible' },
  { value: 'unknown', label: 'Eligibility not recorded' },
];
const HISTORY_KIND_OPTIONS: Array<{ value: EmploymentHistoryKind; label: string }> = [
  { value: 'contact', label: 'Contact' },
  { value: 'application', label: 'Application' },
  { value: 'document', label: 'Document' },
  { value: 'remote_evidence', label: 'Remote evidence' },
  { value: 'note', label: 'Note' },
];

interface EditorDraft {
  company: string;
  role: string;
  url: string;
  workType: EmploymentWorkType;
  remoteRegion: EmploymentRemoteRegion;
  remoteStatus: EmploymentRemoteStatus;
  remoteEvidence: string;
  remoteCaveat: string;
  compensation: string;
  status: EmploymentApplicationStatus;
  applicationDate: string;
  nextAction: string;
  nextActionDate: string;
  notes: string;
  historyKind: EmploymentHistoryKind;
  historyDate: string;
  historySummary: string;
  historyDetails: string;
  historyEvidenceUrl: string;
}

function formatLocalDate(value?: string, includeYear = true): string {
  if (!value) return 'Not recorded';
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1);
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(includeYear ? { year: 'numeric' as const } : {}) });
}

function labelFor<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find(option => option.value === value)?.label ?? value;
}

function buildEditorDraft(application?: EmploymentApplication): EditorDraft {
  return {
    company: application?.company ?? '',
    role: application?.role ?? '',
    url: application?.url ?? '',
    workType: application?.workType ?? 'contract',
    remoteRegion: application?.remoteRegion ?? 'unknown',
    remoteStatus: application?.remoteStatus ?? 'needs_verification',
    remoteEvidence: application?.remoteEvidence ?? '',
    remoteCaveat: application?.remoteCaveat ?? '',
    compensation: application?.compensation ?? '',
    status: application?.status ?? 'lead',
    applicationDate: application?.applicationDate ?? '',
    nextAction: application?.nextAction ?? '',
    nextActionDate: application?.nextActionDate ?? '',
    notes: application?.notes ?? '',
    historyKind: 'contact',
    historyDate: '',
    historySummary: '',
    historyDetails: '',
    historyEvidenceUrl: '',
  };
}

function EmploymentEditor({
  application,
  onClose,
}: {
  application?: EmploymentApplication;
  onClose: () => void;
}) {
  const employment = useEmploymentContext();
  const [draft, setDraft] = useState<EditorDraft>(() => buildEditorDraft(application));
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const companyRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pendingHistoryId = useRef<string | null>(null);

  useEffect(() => {
    companyRef.current?.focus();
  }, []);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary',
    )].filter(element => element.tabIndex >= 0 && !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const update = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const history = [...(application?.history ?? [])];
    if (draft.historySummary.trim()) {
      history.push({
        id: pendingHistoryId.current ??= uuid(),
        kind: draft.historyKind,
        date: draft.historyDate || undefined,
        summary: draft.historySummary,
        details: draft.historyDetails,
        evidenceUrl: draft.historyEvidenceUrl || undefined,
      });
    }
    const payload: EmploymentApplicationDraft = {
      company: draft.company,
      role: draft.role,
      url: draft.url || undefined,
      workType: draft.workType,
      remoteRegion: draft.remoteRegion,
      remoteStatus: draft.remoteStatus,
      remoteEvidence: draft.remoteEvidence,
      remoteCaveat: draft.remoteCaveat || undefined,
      compensation: draft.compensation || undefined,
      status: draft.status,
      applicationDate: draft.applicationDate || undefined,
      nextAction: draft.nextAction,
      nextActionDate: draft.nextActionDate || undefined,
      notes: draft.notes,
      history,
    };
    try {
      if (application) await employment.updateApplication(application.id, payload, application.updatedAt);
      else await employment.addApplication(payload);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const remove = async () => {
    if (!application) return;
    setError('');
    try {
      await employment.removeApplication(application.id, application.updatedAt);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="employment-editor-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="employment-editor" role="dialog" aria-modal="true" aria-labelledby="employment-editor-title" onKeyDown={handleDialogKeyDown}>
        <header className="employment-editor-header">
          <div>
            <span className="employment-eyebrow">ACCOUNT-BACKED RECORD</span>
            <h2 id="employment-editor-title">{application ? 'Edit opportunity' : 'Add opportunity'}</h2>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close Employment editor">&times;</button>
        </header>
        <form onSubmit={save}>
          <div className="employment-form-grid">
            <label><span>Company</span><input ref={companyRef} className="form-input" required value={draft.company} onChange={event => update('company', event.target.value)} /></label>
            <label><span>Role</span><input className="form-input" required value={draft.role} onChange={event => update('role', event.target.value)} /></label>
            <label className="employment-form-wide"><span>Role URL</span><input className="form-input" type="url" placeholder="https://…" value={draft.url} onChange={event => update('url', event.target.value)} /></label>
            <label><span>Work type</span><select className="form-select" value={draft.workType} onChange={event => update('workType', event.target.value as EmploymentWorkType)}>{WORK_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Pipeline status</span><select className="form-select" value={draft.status} onChange={event => update('status', event.target.value as EmploymentApplicationStatus)}>{STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Remote proof</span><select className="form-select" value={draft.remoteStatus} onChange={event => update('remoteStatus', event.target.value as EmploymentRemoteStatus)}>{REMOTE_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>Eligible region</span><select className="form-select" value={draft.remoteRegion} onChange={event => update('remoteRegion', event.target.value as EmploymentRemoteRegion)}>{REMOTE_REGION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="employment-form-wide"><span>Fully remote evidence</span><textarea className="form-input" required rows={2} value={draft.remoteEvidence} onChange={event => update('remoteEvidence', event.target.value)} /></label>
            <label className="employment-form-wide"><span>Remote caveat</span><textarea className="form-input" rows={2} placeholder="Anything that still needs checking" value={draft.remoteCaveat} onChange={event => update('remoteCaveat', event.target.value)} /></label>
            <label><span>Compensation</span><input className="form-input" placeholder="As advertised" value={draft.compensation} onChange={event => update('compensation', event.target.value)} /></label>
            <label><span>Application date</span><input className="form-input" type="date" value={draft.applicationDate} onChange={event => update('applicationDate', event.target.value)} /></label>
            <label className="employment-form-wide"><span>Next action</span><input className="form-input" required value={draft.nextAction} onChange={event => update('nextAction', event.target.value)} /></label>
            <label><span>Next action date</span><input className="form-input" type="date" value={draft.nextActionDate} onChange={event => update('nextActionDate', event.target.value)} /></label>
            <label className="employment-form-wide"><span>Notes</span><textarea className="form-input" rows={3} value={draft.notes} onChange={event => update('notes', event.target.value)} /></label>
          </div>

          <fieldset className="employment-history-editor">
            <legend>Add a contact or evidence update</legend>
            <p>Leave the summary blank when there is no new update to record.</p>
            <div className="employment-form-grid">
              <label><span>Update type</span><select className="form-select" value={draft.historyKind} onChange={event => update('historyKind', event.target.value as EmploymentHistoryKind)}>{HISTORY_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Confirmed date</span><input className="form-input" type="date" value={draft.historyDate} onChange={event => update('historyDate', event.target.value)} /></label>
              <label className="employment-form-wide"><span>Summary</span><input className="form-input" value={draft.historySummary} onChange={event => update('historySummary', event.target.value)} /></label>
              <label className="employment-form-wide"><span>Details</span><textarea className="form-input" rows={2} value={draft.historyDetails} onChange={event => update('historyDetails', event.target.value)} /></label>
              <label className="employment-form-wide"><span>Evidence URL</span><input className="form-input" type="url" placeholder="https://…" value={draft.historyEvidenceUrl} onChange={event => update('historyEvidenceUrl', event.target.value)} /></label>
            </div>
          </fieldset>

          {error && <div className="employment-error" role="alert">{error}</div>}
          {confirmRemove && application && (
            <div className="employment-remove-confirm" role="alert">
              <span>Remove {application.company} from the tracker? This cannot be undone.</span>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setConfirmRemove(false)}>Keep record</button>
              <button className="btn btn-danger btn-sm" type="button" onClick={remove} disabled={employment.saving}>Remove permanently</button>
            </div>
          )}
          <div className="employment-editor-actions">
            {application && !confirmRemove && <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(true)}>Remove record</button>}
            <span className="employment-action-spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={employment.saving}>{employment.saving ? 'Saving…' : 'Save opportunity'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function OpportunityCard({ application, onEdit }: { application: EmploymentApplication; onEdit: () => void }) {
  return (
    <article className="employment-card">
      <header className="employment-card-header">
        <div>
          <div className="employment-card-company">{application.company}</div>
          <h3>{application.role}</h3>
        </div>
        <div className="employment-card-badges">
          <span className={`employment-status status-${application.status}`}>{labelFor(STATUS_OPTIONS, application.status)}</span>
          <span className={`employment-remote status-${application.remoteStatus}`}>{labelFor(REMOTE_STATUS_OPTIONS, application.remoteStatus)}</span>
        </div>
      </header>
      {application.remoteCaveat && <div className="employment-caveat"><strong>Verify remote caveat</strong><span>{application.remoteCaveat}</span></div>}
      <dl className="employment-facts">
        <div><dt>Work type</dt><dd>{labelFor(WORK_TYPE_OPTIONS, application.workType)}</dd></div>
        <div><dt>Eligibility</dt><dd>{labelFor(REMOTE_REGION_OPTIONS, application.remoteRegion)}</dd></div>
        <div><dt>Compensation</dt><dd>{application.compensation || 'Not recorded'}</dd></div>
        <div><dt>Applied</dt><dd>{formatLocalDate(application.applicationDate)}</dd></div>
      </dl>
      <div className="employment-next-action">
        <span>Next action {application.nextActionDate ? `· ${formatLocalDate(application.nextActionDate)}` : '· date not set'}</span>
        <strong>{application.nextAction}</strong>
      </div>
      <p className="employment-card-notes">{application.notes || 'No additional notes.'}</p>
      <div className="employment-remote-evidence"><strong>Remote evidence</strong><span>{application.remoteEvidence}</span></div>
      <details className="employment-history">
        <summary>Contact and evidence history <span>{application.history.length}</span></summary>
        {application.history.length === 0
          ? <p className="employment-history-empty">No history recorded yet.</p>
          : <ol>{application.history.map(entry => <li key={entry.id}><span>{formatLocalDate(entry.date)}</span><div><strong>{entry.summary}</strong><p>{entry.details || 'No details recorded.'}</p>{entry.evidenceUrl && <a href={entry.evidenceUrl} target="_blank" rel="noreferrer">Open evidence</a>}</div></li>)}</ol>}
      </details>
      <footer className="employment-card-footer">
        {application.url ? <a className="btn btn-secondary btn-sm" href={application.url} target="_blank" rel="noreferrer">Open role</a> : <span className="employment-url-missing">URL not recorded</span>}
        <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit opportunity</button>
      </footer>
    </article>
  );
}

export default function EmploymentSurface() {
  const employment = useEmploymentContext();
  const [activeOnly, setActiveOnly] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<EmploymentFilters>({
    query: '', status: 'all', workType: 'all', remoteStatus: 'all',
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmploymentApplication | 'new' | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => employment.applications.filter(application => (
    (!activeOnly || EMPLOYMENT_ACTIVE_STATUSES.includes(application.status))
    && matchesEmploymentFilters(application, filters)
  )), [employment.applications, activeOnly, filters]);
  const groups = useMemo(() => groupEmploymentApplications(filtered), [filtered]);
  const latest = useMemo(() => getEmploymentActivity(filtered).find(entry => entry.date), [filtered]);
  const activeCount = employment.applications.filter(application => application.status !== 'closed').length;
  const filterCount = [filters.status, filters.workType, filters.remoteStatus].filter(value => value !== 'all').length;

  const toggleApplication = (application: EmploymentApplication) => {
    setExpandedId(current => current === application.id ? null : application.id);
  };
  const clearFilters = () => {
    setFilters({ query: '', status: 'all', workType: 'all', remoteStatus: 'all' });
    setActiveOnly(true);
  };
  const openEditor = (application: EmploymentApplication | 'new', trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setEditing(application);
  };
  const closeEditor = () => {
    setEditing(null);
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : addButtonRef.current;
      target?.focus();
    });
  };

  return (
    <div className="surface employment-surface employment-compact">
      <header className="employment-hero">
        <div><h1>Employment</h1><p>Your applications, at a glance.</p></div>
        <div className="employment-summary" aria-label="Employment pipeline summary">
          <span><strong>{employment.applications.length}</strong> tracked</span>
          {(['interview', 'applied', 'recruiter', 'lead', 'offer'] as const).map(status => {
            const count = employment.applications.filter(application => application.status === status).length;
            return (status !== 'offer' || count > 0) && <span key={status} className={`summary-${status}`}><strong>{count}</strong> {status === 'lead' ? 'leads' : status === 'offer' ? 'offers' : status}</span>;
          })}
        </div>
        <button ref={addButtonRef} type="button" className="btn btn-primary" onClick={event => openEditor('new', event.currentTarget)}>+ Add opportunity</button>
      </header>

      {employment.error && <div className="employment-error employment-page-error" role="alert">
        Employment data needs attention: {employment.error}{' '}
        <button className="btn btn-sm" type="button" disabled={employment.saving} onClick={() => void employment.retryLoad()}>Retry loading</button>
      </div>}
      <span className="sr-only" role="status">{employment.saving ? 'Saving Employment change…' : ''}</span>
      <div className="employment-overview-toolbar">
        <div className="employment-view-options" aria-label="Application view">
          <button type="button" aria-label="Active applications" aria-pressed={activeOnly} onClick={() => setActiveOnly(true)}>Active <span>{activeCount}</span></button>
          <button type="button" aria-label="All applications" aria-pressed={!activeOnly} onClick={() => setActiveOnly(false)}>All <span>{employment.applications.length}</span></button>
        </div>
        <label className="employment-search"><span className="sr-only">Search Employment opportunities</span><input className="form-input" value={filters.query} onChange={event => setFilters(current => ({ ...current, query: event.target.value }))} placeholder="Search company, role, note, compensation…" /></label>
        <button type="button" className="btn btn-secondary" aria-expanded={showFilters} aria-controls="employment-filters" onClick={() => setShowFilters(value => !value)}>Filters{filterCount > 0 ? ` (${filterCount})` : ''}</button>
      </div>
      {showFilters && <section id="employment-filters" className="employment-filter-options" aria-label="Employment pipeline filters">
        <label><span>Stage</span><select aria-label="Filter Employment status" className="form-select" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value as EmploymentFilters['status'] }))}><option value="all">All pipeline stages</option>{STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Work type</span><select aria-label="Filter Employment work type" className="form-select" value={filters.workType} onChange={event => setFilters(current => ({ ...current, workType: event.target.value as EmploymentFilters['workType'] }))}><option value="all">All work types</option>{WORK_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span>Remote eligibility</span><select aria-label="Filter Employment remote proof" className="form-select" value={filters.remoteStatus} onChange={event => setFilters(current => ({ ...current, remoteStatus: event.target.value as EmploymentFilters['remoteStatus'] }))}><option value="all">All remote proof</option>{REMOTE_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear filters</button>
      </section>}

      {!employment.loaded ? <p className="employment-loading" role="status">Loading your applications…</p> : filtered.length > 0 ? <>
        <table className="employment-overview" aria-label="Employment applications">
          <caption className="sr-only">Applications grouped by company, most recent recruiting activity first. Expand a role for details.</caption>
          <colgroup><col className="employment-company-column" /><col className="employment-role-column" /><col className="employment-stage-column" /><col className="employment-next-column" /><col className="employment-updated-column" /></colgroup>
          <thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Stage</th><th scope="col">Next step</th><th scope="col">Last updated</th></tr></thead>
          {groups.map((group, groupIndex) => <tbody key={group.key} className="employment-company-group">
            {group.applications.map((application, index) => {
              const expanded = expandedId === application.id;
              const detailsId = `employment-details-${application.id}`;
              const activityDate = getEmploymentActivityDate(application);
              return <Fragment key={application.id}>
                <tr className={`employment-application-row${expanded ? ' is-selected' : ''}`}>
                  {index === 0 && <th scope="rowgroup" rowSpan={group.applications.length + (expandedId && group.applications.some(item => item.id === expandedId) ? 1 : 0)} className="employment-company-cell">
                    <div className="employment-company-label"><span className={`employment-monogram company-colour-${groupIndex % 5}`} aria-hidden="true">{group.company.charAt(0).toLocaleUpperCase()}</span><span><strong>{group.company}</strong><small>{group.applications.length} {group.applications.length === 1 ? 'application' : 'applications'}</small></span></div>
                  </th>}
                  <td className="employment-role-cell"><button type="button" className="employment-role-button" aria-label={`${expanded ? 'Hide' : 'Show'} details for ${application.company}: ${application.role}`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => toggleApplication(application)}><span>{application.role}</span><span className="employment-role-arrow" aria-hidden="true">›</span></button></td>
                  <td className="employment-stage-cell"><span className={`employment-status status-${application.status}`}>{labelFor(STATUS_OPTIONS, application.status)}</span></td>
                  <td className="employment-next-cell"><div className="employment-next-summary"><span title={application.nextAction}>{application.nextAction || 'No next step recorded'}</span>{application.nextActionDate && <small title={formatLocalDate(application.nextActionDate)}>{formatLocalDate(application.nextActionDate, false)}</small>}</div></td>
                  <td className="employment-updated-cell">
                    <div className="employment-updated-summary">
                      {activityDate
                        ? <time dateTime={activityDate} title={`Last recorded recruiting activity: ${formatLocalDate(activityDate)}`}>{formatLocalDate(activityDate)}</time>
                        : <span title="No recorded recruiting activity date">—</span>}
                      {latest?.applicationId === application.id && <span className="employment-latest" title="Most recently updated application">Latest</span>}
                    </div>
                  </td>
                </tr>
                {expanded && <tr className="employment-application-details-row">
                  <td colSpan={4}>
                    <section id={detailsId} className="employment-inline-details" aria-labelledby={`${detailsId}-heading`}>
                      <div className="employment-section-heading"><h2 id={`${detailsId}-heading`}>Details &amp; history</h2><span>{application.company}</span></div>
                      <OpportunityCard application={application} onEdit={() => openEditor(application, document.activeElement instanceof HTMLElement ? document.activeElement : addButtonRef.current!)} />
                    </section>
                  </td>
                </tr>}
              </Fragment>;
            })}
          </tbody>)}
        </table>
        <p className="employment-result-count">{groups.length} {groups.length === 1 ? 'company' : 'companies'} · {filtered.length} of {employment.applications.length} applications shown</p>
      </> : <div className="employment-empty" role="status">
        <h2>No opportunities match</h2><p>{employment.applications.length === 0 ? 'Add an opportunity to start your application list.' : 'Clear a filter or search for another company or role.'}</p>
        <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
      </div>}

      {editing && <EmploymentEditor application={editing === 'new' ? undefined : editing} onClose={closeEditor} />}
    </div>
  );
}
