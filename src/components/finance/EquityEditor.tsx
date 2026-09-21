import { useId, useState } from 'react';
import type { FormEvent, HTMLInputTypeAttribute } from 'react';
import { useDialog } from '../../hooks/useDialog';
import type { EquityGrant, EquityPlan, EquityPosition, EquityPositionDraft } from '../../types/domain';
import './EquityEditor.css';

interface EquityEditorProps {
  position?: EquityPosition;
  saving: boolean;
  onSave: (draft: EquityPositionDraft) => Promise<void>;
  onClose: () => void;
}

function initialDraft(position?: EquityPosition): EquityPositionDraft {
  if (position) {
    const { company, asOf, ownedShares, stockPlan, optionPlan, employmentNote, grants, actions, details, sources, scenario } = position;
    return structuredClone({ company, asOf, ownedShares, stockPlan, optionPlan, employmentNote, grants, actions, details, sources, scenario });
  }
  const plan: EquityPlan = { summary: '', status: 'undecided', waitingFor: '', nextAction: '' };
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return {
    company: '', asOf: '', ownedShares: 0, stockPlan: { ...plan }, optionPlan: { ...plan },
    employmentNote: '', grants: [], actions: [], details: [], sources: [],
    scenario: { pricesUsd: [], withholdingRate: 0, usdToGbp: 1, asOf: today, notes: '' },
  };
}

interface FieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  multiline?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
  placeholder?: string;
}

function Field({ label, value, onChange, multiline, ...inputProps }: FieldProps) {
  const id = useId();
  return <div className="form-group">
    <label htmlFor={id}>{label}</label>
    {multiline
      ? <textarea id={id} className="form-input" value={value} rows={2} required={inputProps.required} onChange={event => onChange(event.target.value)} />
      : <input {...inputProps} id={id} className="form-input" value={value} onChange={event => onChange(event.target.value)} />}
  </div>;
}

function PlanFields({ title, plan, onChange }: { title: string; plan: EquityPlan; onChange: (plan: EquityPlan) => void }) {
  const id = useId();
  return <details className="equity-editor-section">
    <summary>{title}</summary>
    <Field label="Current plan" multiline value={plan.summary} onChange={summary => onChange({ ...plan, summary })} />
    <div className="equity-editor-grid">
      <div className="form-group">
        <label htmlFor={id}>Plan status</label>
        <select id={id} className="form-select" value={plan.status} onChange={event => onChange({ ...plan, status: event.target.value as EquityPlan['status'] })}>
          <option value="undecided">Undecided</option><option value="tentative">Tentative</option><option value="agreed">Agreed</option>
        </select>
      </div>
      <Field label="Review month (optional)" type="month" value={plan.reviewMonth ?? ''} onChange={reviewMonth => onChange({ ...plan, reviewMonth: reviewMonth || undefined })} />
    </div>
    <Field label="Waiting for" multiline value={plan.waitingFor} onChange={waitingFor => onChange({ ...plan, waitingFor })} />
    <Field label="Next action" multiline value={plan.nextAction} onChange={nextAction => onChange({ ...plan, nextAction })} />
  </details>;
}

export function EquityEditor({ position, saving, onSave, onClose }: EquityEditorProps) {
  const [baseline] = useState(() => initialDraft(position));
  const [draft, setDraft] = useState(() => structuredClone(baseline));
  const [prices, setPrices] = useState(() => baseline.scenario.pricesUsd.join(', '));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = saving || pending;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || prices !== baseline.scenario.pricesUsd.join(', ');
  const { dialogRef, requestClose } = useDialog({ open: true, onClose, dirty, busy });
  const titleId = useId();
  const update = <K extends keyof EquityPositionDraft>(key: K, value: EquityPositionDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const updateGrant = (index: number, patch: Partial<EquityGrant>) => update('grants', draft.grants.map((grant, i) => i === index ? { ...grant, ...patch } : grant));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const parts = prices.trim() ? prices.split(',').map(part => part.trim()) : [];
    if (parts.some(part => !part || !Number.isFinite(Number(part)) || Number(part) <= 0)) {
      setError('Enter scenario prices as positive USD amounts separated by commas, or leave them blank.');
      return;
    }
    setPending(true);
    try {
      await onSave({ ...draft, company: draft.company.trim(), scenario: { ...draft.scenario, pricesUsd: parts.map(Number) } });
      onClose();
    } catch (cause) {
      setError(`Could not save equity. ${cause instanceof Error ? cause.message : 'Check your connection and try again.'}`);
    } finally {
      setPending(false);
    }
  };

  return <div className="modal-overlay equity-editor-overlay" onMouseDown={requestClose}>
    <div ref={dialogRef} className="modal equity-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
      <h2 id={titleId}>{position ? 'Edit equity' : 'Add equity'}</h2>
      <p className="equity-editor-help">Keep holdings, plans and evidence up to date. Scenario estimates stay separate from cash balances.</p>
      <form onSubmit={submit} onInvalidCapture={event => {
        let ancestor = (event.target as HTMLElement).parentElement;
        while (ancestor) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
      }}>
        <fieldset disabled={busy} className="equity-editor-fields">
          <div className="equity-editor-grid">
            <Field label="Company" required value={draft.company} onChange={value => update('company', value)} />
            <Field label="Holdings as of" required type="date" value={draft.asOf} onChange={value => update('asOf', value)} />
          </div>
          <Field label="Already-owned shares" required type="number" min={0} step={1} value={draft.ownedShares} onChange={value => update('ownedShares', Number(value))} />
          <PlanFields title="Stocks plan" plan={draft.stockPlan} onChange={value => update('stockPlan', value)} />
          <PlanFields title="Options plan" plan={draft.optionPlan} onChange={value => update('optionPlan', value)} />
          <details className="equity-editor-section">
            <summary>Employment and option grants ({draft.grants.length})</summary>
            <Field label="Employment context" multiline value={draft.employmentNote} onChange={value => update('employmentNote', value)} />
            <p className="equity-editor-help">Record unexercised options only. Original grant expiry and a confirmed post-employment deadline are separate dates.</p>
            {draft.grants.map((grant, index) => <fieldset className="equity-editor-entry" key={index}>
              <legend>Grant {index + 1}</legend>
              <div className="equity-editor-grid">
                <Field label="Grant ID" required value={grant.id} onChange={id => updateGrant(index, { id })} />
                <Field label="Grant date" required type="date" value={grant.grantDate} onChange={grantDate => updateGrant(index, { grantDate })} />
                <Field label="Vested unexercised" required type="number" min={0} step={1} value={grant.vested} onChange={value => updateGrant(index, { vested: Number(value) })} />
                <Field label="Unvested" required type="number" min={0} step={1} value={grant.unvested} onChange={value => updateGrant(index, { unvested: Number(value) })} />
                <Field label="Strike (USD)" required type="number" min={0} step="any" value={grant.strikeUsd} onChange={value => updateGrant(index, { strikeUsd: Number(value) })} />
                <Field label="Original grant expiry" required type="date" value={grant.originalExpiry} onChange={originalExpiry => updateGrant(index, { originalExpiry })} />
                <Field label="Confirmed post-employment expiry (optional)" type="date" value={grant.postEmploymentExpiry ?? ''} onChange={value => updateGrant(index, { postEmploymentExpiry: value || undefined })} />
              </div>
              <label className="equity-editor-check"><input type="checkbox" checked={Boolean(grant.nextVest)} onChange={event => updateGrant(index, { nextVest: event.target.checked ? { date: '', quantity: 0, condition: '' } : undefined })} /> Record a conditional next vest</label>
              {grant.nextVest && <div className="equity-editor-vesting">
                <div className="equity-editor-grid">
                  <Field label="Expected vest date" required type="date" value={grant.nextVest.date} onChange={date => updateGrant(index, { nextVest: { ...grant.nextVest!, date } })} />
                  <Field label="Alternate date to confirm (optional)" type="date" value={grant.nextVest.alternateDate ?? ''} onChange={value => updateGrant(index, { nextVest: { ...grant.nextVest!, alternateDate: value || undefined } })} />
                  <Field label="Expected quantity" required type="number" min={0} step={1} value={grant.nextVest.quantity} onChange={value => updateGrant(index, { nextVest: { ...grant.nextVest!, quantity: Number(value) } })} />
                </div>
                <Field label="Vesting condition" required multiline value={grant.nextVest.condition} onChange={condition => updateGrant(index, { nextVest: { ...grant.nextVest!, condition } })} />
              </div>}
              <button className="btn btn-secondary" type="button" onClick={() => update('grants', draft.grants.filter((_, i) => i !== index))}>Remove grant {index + 1}</button>
            </fieldset>)}
            <button className="btn btn-secondary" type="button" onClick={() => update('grants', [...draft.grants, { id: '', grantDate: '', vested: 0, unvested: 0, strikeUsd: 0, originalExpiry: '' }])}>Add grant</button>
          </details>
          <details className="equity-editor-section">
            <summary>Actions and deadlines ({draft.actions.length})</summary>
            {draft.actions.map((action, index) => <fieldset className="equity-editor-entry" key={action.id}>
              <legend>Action {index + 1}</legend>
              <Field label="Action" required value={action.title} onChange={title => update('actions', draft.actions.map(item => item.id === action.id ? { ...item, title } : item))} />
              <Field label="Timing or condition" value={action.timing} onChange={timing => update('actions', draft.actions.map(item => item.id === action.id ? { ...item, timing } : item))} />
              <Field label="Confirmed due date (optional)" type="date" value={action.dueDate ?? ''} onChange={value => update('actions', draft.actions.map(item => item.id === action.id ? { ...item, dueDate: value || undefined } : item))} />
              <label className="equity-editor-check"><input type="checkbox" checked={action.done} onChange={event => update('actions', draft.actions.map(item => item.id === action.id ? { ...item, done: event.target.checked } : item))} /> Completed</label>
              <button className="btn btn-secondary" type="button" onClick={() => update('actions', draft.actions.filter(item => item.id !== action.id))}>Remove action {index + 1}</button>
            </fieldset>)}
            <button className="btn btn-secondary" type="button" onClick={() => update('actions', [...draft.actions, { id: crypto.randomUUID(), title: '', timing: '', done: false }])}>Add action</button>
          </details>
          <details className="equity-editor-section">
            <summary>Policies and other details ({draft.details.length})</summary>
            {draft.details.map((detail, index) => <fieldset className="equity-editor-entry" key={detail.id}>
              <legend>Detail {index + 1}</legend>
              <Field label="Title" required value={detail.title} onChange={title => update('details', draft.details.map(item => item.id === detail.id ? { ...item, title } : item))} />
              <Field label="Detail" required multiline value={detail.body} onChange={body => update('details', draft.details.map(item => item.id === detail.id ? { ...item, body } : item))} />
              <button className="btn btn-secondary" type="button" onClick={() => update('details', draft.details.filter(item => item.id !== detail.id))}>Remove detail {index + 1}</button>
            </fieldset>)}
            <button className="btn btn-secondary" type="button" onClick={() => update('details', [...draft.details, { id: crypto.randomUUID(), title: '', body: '' }])}>Add detail</button>
          </details>
          <details className="equity-editor-section">
            <summary>Sources ({draft.sources.length})</summary>
            {draft.sources.map((source, index) => <fieldset className="equity-editor-entry" key={source.id}>
              <legend>Source {index + 1}</legend>
              <Field label="Source name" required value={source.label} onChange={label => update('sources', draft.sources.map(item => item.id === source.id ? { ...item, label } : item))} />
              <Field label="Source URL" required type="url" value={source.url} onChange={url => update('sources', draft.sources.map(item => item.id === source.id ? { ...item, url } : item))} />
              <Field label="Source as of" required type="date" value={source.asOf} onChange={asOf => update('sources', draft.sources.map(item => item.id === source.id ? { ...item, asOf } : item))} />
              <button className="btn btn-secondary" type="button" onClick={() => update('sources', draft.sources.filter(item => item.id !== source.id))}>Remove source {index + 1}</button>
            </fieldset>)}
            <button className="btn btn-secondary" type="button" onClick={() => update('sources', [...draft.sources, { id: crypto.randomUUID(), label: '', url: '', asOf: '' }])}>Add source</button>
          </details>
          <details className="equity-editor-section">
            <summary>Option scenario assumptions</summary>
            <p className="equity-editor-help">Illustrations only, before fees. Confirm your own withholding and exchange rate; these assumptions do not value already-owned shares.</p>
            <Field label="Scenario prices (USD, separated by commas)" value={prices} onChange={setPrices} />
            <div className="equity-editor-grid">
              <Field label="Modeled withholding (%)" required type="number" min={0} max={100} step="any" value={Number((draft.scenario.withholdingRate * 100).toFixed(8))} onChange={value => update('scenario', { ...draft.scenario, withholdingRate: Number(value) / 100 })} />
              <Field label="GBP per USD" required type="number" min={0.000001} step="any" value={draft.scenario.usdToGbp} onChange={value => update('scenario', { ...draft.scenario, usdToGbp: Number(value) })} />
              <Field label="Assumptions as of" required type="date" value={draft.scenario.asOf} onChange={value => update('scenario', { ...draft.scenario, asOf: value })} />
            </div>
            <Field label="Pricing and calculation notes" multiline value={draft.scenario.notes} onChange={notes => update('scenario', { ...draft.scenario, notes })} />
          </details>
        </fieldset>
        {error && <p className="equity-editor-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={requestClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save equity'}</button>
        </div>
      </form>
    </div>
  </div>;
}
