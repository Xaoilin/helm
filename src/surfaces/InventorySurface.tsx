import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItem,
  InventoryNeed,
  InventoryNeedPriority,
  InventorySubcategory,
  InventoryTrackingMode,
} from '../types/domain';
import {
  defaultInventorySubcategory,
  findLikelyInventoryDuplicates,
  inventoryCategoryForSubcategory,
  inventorySubcategoryMeta,
  INVENTORY_SUBCATEGORY_OPTIONS,
  isInventoryLowStock,
  normalizeInventoryItemDraft,
  normalizeInventoryNeedDraft,
  parseInventoryPaste,
  type InventoryItemDraft,
  type InventoryPasteCandidate,
} from '../inventory/inventoryModel';

type InventoryView = 'owned' | 'needed';
type EditorState =
  | { kind: 'item'; item?: InventoryItem; projectCatalogKey?: string }
  | { kind: 'need'; need?: InventoryNeed; linkedItem?: InventoryItem; projectCatalogKey?: string }
  | { kind: 'paste'; projectCatalogKey?: string }
  | null;

const CATEGORY_OPTIONS: Array<{ value: InventoryCategory; label: string; icon: string }> = [
  { value: 'machine', label: 'Machines', icon: '▣' },
  { value: 'tool', label: 'Tools', icon: '⌁' },
  { value: 'electronics', label: 'Electronics', icon: '⌁' },
  { value: 'component', label: 'Components', icon: '⬡' },
  { value: 'material', label: 'Materials', icon: '◫' },
  { value: 'consumable', label: 'Consumables', icon: '◌' },
  { value: 'fastener', label: 'Fasteners', icon: '⌾' },
  { value: 'safety', label: 'Safety', icon: '◇' },
  { value: 'storage', label: 'Storage', icon: '▤' },
  { value: 'other', label: 'Other', icon: '◆' },
];
const TRACKING_OPTIONS: InventoryTrackingMode[] = ['durable', 'counted', 'measured'];
const CONDITION_OPTIONS: InventoryCondition[] = ['unknown', 'new', 'good', 'worn', 'needs_repair'];

function categoryMeta(category: InventoryCategory) {
  return CATEGORY_OPTIONS.find(option => option.value === category) || CATEGORY_OPTIONS.at(-1)!;
}

function InventoryPhoto({
  imageUrl,
  name,
  fallback,
  compact = false,
}: {
  imageUrl?: string;
  name: string;
  fallback: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  return (
    <div className={`inventory-card-visual ${compact ? 'is-compact' : ''} ${imageUrl && !failed ? 'has-photo' : ''}`}>
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt={`${name} product photo`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : <span aria-hidden="true">{fallback}</span>}
    </div>
  );
}

function searchableItem(item: InventoryItem): string {
  const subcategory = inventorySubcategoryMeta(item.subcategory);
  return [
    item.name, item.category, item.subcategory, subcategory?.label,
    item.brand, item.model, item.location, item.notes,
    ...item.tags, ...Object.keys(item.specifications), ...Object.values(item.specifications),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function specificationsText(value: Record<string, string>): string {
  return Object.entries(value).map(([key, entry]) => `${key}: ${entry}`).join('\n');
}

function parseSpecifications(value: string): Record<string, string> {
  const entries = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const separator = line.indexOf(':');
    if (separator <= 0 || !line.slice(separator + 1).trim()) {
      throw new Error(`Specification line ${index + 1} must use “name: value”.`);
    }
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

function InventoryModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="inventory-modal-backdrop" onMouseDown={onClose}>
      <section
        className="inventory-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="inventory-modal-header">
          <div>
            <div className="inventory-eyebrow">SABAH ONE INVENTORY</div>
            <h2>{title}</h2>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={`Close ${title}`}>&times;</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ItemEditor({
  item,
  projectCatalogKey,
  onClose,
}: {
  item?: InventoryItem;
  projectCatalogKey?: string;
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState(item?.name || '');
  const [subcategory, setSubcategory] = useState<InventorySubcategory>(
    item?.subcategory || defaultInventorySubcategory(item?.category || 'other'),
  );
  const [imageUrl, setImageUrl] = useState(item?.imageUrl || '');
  const [trackingMode, setTrackingMode] = useState<InventoryTrackingMode>(item?.trackingMode || 'counted');
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unit, setUnit] = useState(item?.unit || 'pcs');
  const [threshold, setThreshold] = useState(item?.lowStockThreshold == null ? '' : String(item.lowStockThreshold));
  const [brand, setBrand] = useState(item?.brand || '');
  const [model, setModel] = useState(item?.model || '');
  const [condition, setCondition] = useState<InventoryCondition>(item?.condition || 'unknown');
  const [location, setLocation] = useState(item?.location || '');
  const [tags, setTags] = useState((item?.tags || []).join(', '));
  const [specifications, setSpecifications] = useState(specificationsText(item?.specifications || {}));
  const [notes, setNotes] = useState(item?.notes || '');
  const [projectKeys, setProjectKeys] = useState(
    item?.projectCatalogKeys || (projectCatalogKey ? [projectCatalogKey] : []),
  );
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const draft = normalizeInventoryItemDraft({
        name,
        category: inventoryCategoryForSubcategory(subcategory),
        subcategory,
        imageUrl,
        trackingMode,
        quantity: Number(quantity),
        unit,
        lowStockThreshold: threshold === '' ? undefined : Number(threshold),
        brand,
        model,
        specifications: parseSpecifications(specifications),
        condition,
        location,
        tags: tags.split(',').map(value => value.trim()).filter(Boolean),
        notes,
        projectCatalogKeys: projectKeys,
        lastVerifiedAt: new Date().toISOString(),
        archivedAt: item?.archivedAt,
      });
      if (item) app.updateInventoryItem(item.id, draft);
      else app.addInventoryItem(draft);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <InventoryModal title={item ? 'Edit owned item' : 'Add owned item'} onClose={onClose}>
      <form className="inventory-form" onSubmit={submit}>
        <label className="inventory-field inventory-field-wide"><span>Name</span><input autoFocus className="form-input" value={name} onChange={e => setName(e.target.value)} required maxLength={160} /></label>
        <label className="inventory-field"><span>Category</span><select className="form-select" value={subcategory} onChange={e => setSubcategory(e.target.value as InventorySubcategory)}>{INVENTORY_SUBCATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="inventory-field"><span>Tracking</span><select className="form-select" value={trackingMode} onChange={e => setTrackingMode(e.target.value as InventoryTrackingMode)}>{TRACKING_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="inventory-field"><span>Quantity</span><input className="form-input" inputMode="decimal" type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
        <label className="inventory-field"><span>Unit</span><input className="form-input" value={unit} onChange={e => setUnit(e.target.value)} required maxLength={32} /></label>
        <label className="inventory-field"><span>Low-stock at</span><input className="form-input" type="number" min="0" step="any" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="Optional" /></label>
        <label className="inventory-field"><span>Condition</span><select className="form-select" value={condition} onChange={e => setCondition(e.target.value as InventoryCondition)}>{CONDITION_OPTIONS.map(value => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label>
        <label className="inventory-field"><span>Brand</span><input className="form-input" value={brand} onChange={e => setBrand(e.target.value)} maxLength={120} /></label>
        <label className="inventory-field"><span>Model</span><input className="form-input" value={model} onChange={e => setModel(e.target.value)} maxLength={120} /></label>
        <label className="inventory-field inventory-field-wide"><span>Product image URL</span><input className="form-input" inputMode="url" type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} maxLength={2048} placeholder="https://…" /></label>
        <label className="inventory-field inventory-field-wide"><span>Location</span><input className="form-input" value={location} onChange={e => setLocation(e.target.value)} maxLength={160} placeholder="Workshop drawer, office shelf…" /></label>
        <label className="inventory-field inventory-field-wide"><span>Tags</span><input className="form-input" value={tags} onChange={e => setTags(e.target.value)} placeholder="3d printing, soldering, portable" /></label>
        <label className="inventory-field inventory-field-wide"><span>Specifications</span><textarea className="form-input" value={specifications} onChange={e => setSpecifications(e.target.value)} rows={4} placeholder={'thread: M3\nmaterial: brass'} /></label>
        <fieldset className="inventory-project-links inventory-field-wide">
          <legend>Projects</legend>
          {app.projects.filter(project => project.catalogKey).map(project => (
            <label key={project.id}>
              <input
                type="checkbox"
                checked={projectKeys.includes(project.catalogKey!)}
                onChange={event => setProjectKeys(current => event.target.checked
                  ? [...new Set([...current, project.catalogKey!])]
                  : current.filter(key => key !== project.catalogKey))}
              />
              <span>{project.name}</span>
            </label>
          ))}
        </fieldset>
        <label className="inventory-field inventory-field-wide"><span>Notes</span><textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={3} /></label>
        {error && <div className="inventory-error" role="alert">{error}</div>}
        <div className="inventory-modal-actions inventory-field-wide">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit">{item ? 'Save item' : 'Add item'}</button>
        </div>
      </form>
    </InventoryModal>
  );
}

function NeedEditor({
  need,
  linkedItem,
  projectCatalogKey,
  onClose,
}: {
  need?: InventoryNeed;
  linkedItem?: InventoryItem;
  projectCatalogKey?: string;
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState(need?.name || linkedItem?.name || '');
  const [subcategory, setSubcategory] = useState<InventorySubcategory>(
    need?.subcategory
      || linkedItem?.subcategory
      || defaultInventorySubcategory(need?.category || linkedItem?.category || 'other'),
  );
  const [imageUrl, setImageUrl] = useState(need?.imageUrl || linkedItem?.imageUrl || '');
  const [quantity, setQuantity] = useState(String(need?.requiredQuantity ?? 1));
  const [unit, setUnit] = useState(need?.unit || linkedItem?.unit || 'pcs');
  const [priority, setPriority] = useState<InventoryNeedPriority>(need?.priority || 'normal');
  const [projectKey, setProjectKey] = useState(need?.projectCatalogKey || projectCatalogKey || '');
  const [notes, setNotes] = useState(need?.notes || '');
  const [specifications, setSpecifications] = useState(specificationsText(need?.specifications || linkedItem?.specifications || {}));
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const draft = normalizeInventoryNeedDraft({
        name,
        category: inventoryCategoryForSubcategory(subcategory),
        subcategory,
        imageUrl,
        linkedItemId: need?.linkedItemId || linkedItem?.id,
        projectCatalogKey: projectKey || undefined,
        requiredQuantity: Number(quantity),
        unit,
        specifications: parseSpecifications(specifications),
        priority,
        status: need?.status || 'needed',
        notes,
        orderedAt: need?.orderedAt,
        acquiredAt: need?.acquiredAt,
        dismissedAt: need?.dismissedAt,
      });
      if (need) app.updateInventoryNeed(need.id, draft);
      else app.addInventoryNeed(draft);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <InventoryModal title={need ? 'Edit need' : 'Need more'} onClose={onClose}>
      <form className="inventory-form" onSubmit={submit}>
        <label className="inventory-field inventory-field-wide"><span>Name</span><input autoFocus className="form-input" value={name} onChange={e => setName(e.target.value)} required maxLength={160} /></label>
        <label className="inventory-field"><span>Category</span><select className="form-select" value={subcategory} onChange={e => setSubcategory(e.target.value as InventorySubcategory)}>{INVENTORY_SUBCATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="inventory-field"><span>Required quantity</span><input className="form-input" type="number" min="0" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
        <label className="inventory-field"><span>Unit</span><input className="form-input" value={unit} onChange={e => setUnit(e.target.value)} required maxLength={32} /></label>
        <label className="inventory-field"><span>Priority</span><select className="form-select" value={priority} onChange={e => setPriority(e.target.value as InventoryNeedPriority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        <label className="inventory-field"><span>Project</span><select className="form-select" value={projectKey} onChange={e => setProjectKey(e.target.value)}><option value="">No project</option>{app.projects.filter(project => project.catalogKey).map(project => <option key={project.id} value={project.catalogKey}>{project.name}</option>)}</select></label>
        <label className="inventory-field inventory-field-wide"><span>Product image URL</span><input className="form-input" inputMode="url" type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} maxLength={2048} placeholder="https://…" /></label>
        <label className="inventory-field inventory-field-wide"><span>Required specifications</span><textarea className="form-input" value={specifications} onChange={e => setSpecifications(e.target.value)} rows={4} placeholder={'thread: M3\nmaterial: brass'} /></label>
        <label className="inventory-field inventory-field-wide"><span>Notes</span><textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={4} /></label>
        {error && <div className="inventory-error" role="alert">{error}</div>}
        <div className="inventory-modal-actions inventory-field-wide"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">{need ? 'Save need' : 'Add need'}</button></div>
      </form>
    </InventoryModal>
  );
}

function PasteReview({ projectCatalogKey, onClose }: { projectCatalogKey?: string; onClose: () => void }) {
  const app = useApp();
  const [input, setInput] = useState('');
  const [candidates, setCandidates] = useState<InventoryPasteCandidate[]>([]);
  const [error, setError] = useState('');

  const review = () => {
    const parsed = parseInventoryPaste(input, app.inventoryItems).map(candidate => ({
      ...candidate,
      draft: {
        ...candidate.draft,
        projectCatalogKeys: projectCatalogKey ? [projectCatalogKey] : candidate.draft.projectCatalogKeys,
      },
    }));
    if (parsed.length === 0) setError('Paste at least one non-empty line.');
    else { setCandidates(parsed); setError(''); }
  };
  const updateCandidate = (id: string, patch: Partial<InventoryItemDraft> & { selected?: boolean }) => {
    setCandidates(current => current.map(candidate => {
      if (candidate.id !== id) return candidate;
      const draft = { ...candidate.draft, ...patch };
      return {
        ...candidate,
        ...('selected' in patch ? { selected: Boolean(patch.selected) } : {}),
        draft,
        duplicateItemIds: findLikelyInventoryDuplicates(draft as InventoryItem, app.inventoryItems).map(item => item.id),
      };
    }));
  };
  const save = () => {
    try {
      const selected = candidates.filter(candidate => candidate.selected).map(candidate => normalizeInventoryItemDraft(candidate.draft));
      if (selected.length === 0) throw new Error('Select at least one candidate.');
      app.addInventoryItems(selected);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <InventoryModal title="Paste and review" onClose={onClose}>
      {candidates.length === 0 ? (
        <div className="inventory-paste-start">
          <p>Paste one item per line. Sabah One will propose fields; nothing is saved until you review and select it.</p>
          <textarea autoFocus className="form-input" rows={10} value={input} onChange={e => setInput(e.target.value)} placeholder={'2x digital calipers\nM3 heat-set inserts x 100\nBambu Lab P1S'} />
          {error && <div className="inventory-error" role="alert">{error}</div>}
          <div className="inventory-modal-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" onClick={review}>Review candidates</button></div>
        </div>
      ) : (
        <div className="inventory-review">
          <div className="inventory-review-summary">Review {candidates.length} candidate{candidates.length === 1 ? '' : 's'}. Amber fields need attention; duplicate warnings are never auto-merged.</div>
          {candidates.map(candidate => (
            <article className={`inventory-review-row ${candidate.selected ? '' : 'is-skipped'}`} key={candidate.id}>
              <label className="inventory-review-select"><input type="checkbox" checked={candidate.selected} onChange={e => updateCandidate(candidate.id, { selected: e.target.checked })} /><span>Save</span></label>
              <input className={`form-input ${candidate.uncertainFields.includes('name') ? 'is-uncertain' : ''}`} aria-label="Candidate name" value={candidate.draft.name} onChange={e => updateCandidate(candidate.id, { name: e.target.value })} />
              <input className={`form-input ${candidate.uncertainFields.includes('quantity') ? 'is-uncertain' : ''}`} aria-label="Candidate quantity" type="number" min="0" step="any" value={candidate.draft.quantity} onChange={e => updateCandidate(candidate.id, { quantity: Number(e.target.value) })} />
              <input className={`form-input ${candidate.uncertainFields.includes('unit') ? 'is-uncertain' : ''}`} aria-label="Candidate unit" value={candidate.draft.unit} onChange={e => updateCandidate(candidate.id, { unit: e.target.value })} />
              <select
                className={`form-select ${candidate.uncertainFields.includes('subcategory') ? 'is-uncertain' : ''}`}
                aria-label="Candidate category"
                value={candidate.draft.subcategory || defaultInventorySubcategory(candidate.draft.category)}
                onChange={e => {
                  const next = e.target.value as InventorySubcategory;
                  updateCandidate(candidate.id, {
                    category: inventoryCategoryForSubcategory(next),
                    subcategory: next,
                  });
                }}
              >
                {INVENTORY_SUBCATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <div className="inventory-review-flags">
                {candidate.duplicateItemIds.length > 0 && <span className="inventory-duplicate-warning">Likely duplicate</span>}
                {candidate.uncertainFields.length > 0 && <span>{candidate.uncertainFields.join(', ')} inferred</span>}
              </div>
            </article>
          ))}
          {error && <div className="inventory-error" role="alert">{error}</div>}
          <div className="inventory-modal-actions"><button className="btn btn-secondary" type="button" onClick={() => setCandidates([])}>Back</button><button className="btn btn-primary" type="button" onClick={save}>Save selected</button></div>
        </div>
      )}
    </InventoryModal>
  );
}

function InventoryItemCard({ item, projectName, onEdit, onNeed }: { item: InventoryItem; projectName?: string; onEdit: () => void; onNeed: () => void }) {
  const app = useApp();
  const low = isInventoryLowStock(item);
  const meta = categoryMeta(item.category);
  const subcategory = inventorySubcategoryMeta(item.subcategory);
  return (
    <article className={`inventory-card ${low ? 'is-low' : ''}`}>
      <InventoryPhoto imageUrl={item.imageUrl} name={item.name} fallback={meta.icon} />
      <div className="inventory-card-main">
        <div className="inventory-card-heading"><div><h3>{item.name}</h3><p>{[item.brand, item.model].filter(Boolean).join(' · ') || subcategory?.label || meta.label}</p></div>{low && <span className="inventory-low-badge">Low stock</span>}</div>
        <div className="inventory-card-meta"><span>{subcategory?.label || meta.label}</span><span>{item.quantity} {item.unit}</span>{item.location && <span>{item.location}</span>}<span>{item.condition.replace('_', ' ')}</span>{projectName && <span>{projectName}</span>}</div>
        {item.tags.length > 0 && <div className="inventory-tags">{item.tags.slice(0, 5).map(tag => <span key={tag}>{tag}</span>)}</div>}
        <div className="inventory-card-actions">
          <div className="inventory-stepper" aria-label={`Adjust ${item.name} quantity`}><button type="button" onClick={() => app.adjustInventoryQuantity(item.id, -1)} disabled={item.quantity <= 0} aria-label={`Decrease ${item.name}`}>−</button><strong>{item.quantity}</strong><button type="button" onClick={() => app.adjustInventoryQuantity(item.id, 1)} aria-label={`Increase ${item.name}`}>+</button></div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onNeed}>Need more</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { if (window.confirm(`Archive “${item.name}”?`)) app.archiveInventoryItem(item.id); }}>Archive</button>
        </div>
      </div>
    </article>
  );
}

function InventoryNeedCard({ need, projectName, onEdit }: { need: InventoryNeed; projectName?: string; onEdit: () => void }) {
  const app = useApp();
  const [error, setError] = useState('');
  const meta = categoryMeta(need.category || 'other');
  const subcategory = inventorySubcategoryMeta(need.subcategory);
  const markAcquired = () => {
    try {
      app.completeInventoryNeed(need.id);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <article className={`inventory-card inventory-need-card priority-${need.priority}`}>
      <InventoryPhoto imageUrl={need.imageUrl} name={need.name} fallback="＋" />
      <div className="inventory-card-main">
        <div className="inventory-card-heading"><div><h3>{need.name}</h3><p>{subcategory?.label || meta.label} · {need.requiredQuantity} {need.unit} required{projectName ? ` · ${projectName}` : ''}</p></div><span className={`inventory-need-status status-${need.status}`}>{need.status}</span></div>
        {need.notes && <p className="inventory-card-notes">{need.notes}</p>}
        <div className="inventory-card-actions">
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-primary btn-sm" type="button" onClick={markAcquired}>Mark acquired</button>}
          {need.status === 'needed' && <button className="btn btn-secondary btn-sm" type="button" onClick={() => app.updateInventoryNeed(need.id, { status: 'ordered', orderedAt: new Date().toISOString() })}>Mark ordered</button>}
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit</button>}
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-ghost btn-sm" type="button" onClick={() => app.updateInventoryNeed(need.id, { status: 'dismissed', dismissedAt: new Date().toISOString() })}>Dismiss</button>}
        </div>
        {error && <div className="inventory-error" role="alert">{error}</div>}
      </div>
    </article>
  );
}

export function ProjectInventorySection({ catalogKey, projectName }: { catalogKey: string; projectName: string }) {
  const app = useApp();
  const items = app.inventoryItems.filter(item => !item.archivedAt && item.projectCatalogKeys.includes(catalogKey));
  const needs = app.inventoryNeeds.filter(need => need.projectCatalogKey === catalogKey && (need.status === 'needed' || need.status === 'ordered'));
  return (
    <section className="project-inventory-panel" aria-label={`${projectName} inventory`}>
      <div className="project-inventory-heading"><div><div className="inventory-eyebrow">PROJECT INVENTORY</div><h2>Tools, stock, and needs</h2><p>{items.length} owned · {needs.length} open needs</p></div><button className="btn btn-primary" type="button" onClick={() => app.navigate('inventory')}>Open global Inventory</button></div>
      <div className="project-inventory-summary">
        {items.slice(0, 8).map(item => <div key={item.id} className="project-inventory-chip"><InventoryPhoto compact imageUrl={item.imageUrl} name={item.name} fallback={categoryMeta(item.category).icon} /><strong>{item.name}</strong><small>{item.quantity} {item.unit}</small></div>)}
        {needs.slice(0, 6).map(need => <div key={need.id} className="project-inventory-chip is-needed"><InventoryPhoto compact imageUrl={need.imageUrl} name={need.name} fallback="＋" /><strong>{need.name}</strong><small>{need.requiredQuantity} {need.unit} needed</small></div>)}
        {items.length === 0 && needs.length === 0 && <div className="inventory-empty-inline">Nothing is linked yet. Add or edit an Inventory record and select this project.</div>}
      </div>
    </section>
  );
}

export default function InventorySurface() {
  const app = useApp();
  const [view, setView] = useState<InventoryView>('owned');
  const [query, setQuery] = useState('');
  const [subcategory, setSubcategory] = useState<'all' | InventorySubcategory>('all');
  const [projectKey, setProjectKey] = useState('all');
  const [location, setLocation] = useState('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const projectNameByKey = useMemo(() => new Map(app.projects.filter(p => p.catalogKey).map(p => [p.catalogKey!, p.name])), [app.projects]);
  const locations = useMemo(() => [...new Set(app.inventoryItems.map(item => item.location).filter((value): value is string => Boolean(value)))].sort(), [app.inventoryItems]);

  const owned = useMemo(() => app.inventoryItems.filter(item => {
    if (item.archivedAt) return false;
    if (query && !searchableItem(item).includes(query.toLocaleLowerCase())) return false;
    if (subcategory !== 'all' && item.subcategory !== subcategory) return false;
    if (projectKey !== 'all' && !item.projectCatalogKeys.includes(projectKey)) return false;
    if (location !== 'all' && item.location !== location) return false;
    return true;
  }), [app.inventoryItems, query, subcategory, projectKey, location]);
  const needed = useMemo(() => app.inventoryNeeds.filter(need => {
    const subcategoryLabel = inventorySubcategoryMeta(need.subcategory)?.label || '';
    if (query && !`${need.name} ${need.notes} ${need.subcategory || ''} ${subcategoryLabel}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
    if (subcategory !== 'all' && need.subcategory !== subcategory) return false;
    if (projectKey !== 'all' && need.projectCatalogKey !== projectKey) return false;
    return need.status !== 'dismissed';
  }), [app.inventoryNeeds, query, subcategory, projectKey]);
  const lowCount = app.inventoryItems.filter(isInventoryLowStock).length;
  const openNeedCount = app.inventoryNeeds.filter(need => need.status === 'needed' || need.status === 'ordered').length;

  return (
    <div className="surface inventory-surface">
      <header className="inventory-hero">
        <div className="inventory-hero-copy"><div className="inventory-eyebrow">SABAH ONE INVENTORY</div><h1>Know what you have before you buy.</h1><p>One account-backed catalogue for every project and every Lina planning conversation.</p></div>
        <div className="inventory-hero-actions"><button className="btn btn-secondary" onClick={() => setEditor({ kind: 'paste' })}>Paste and review</button><button className="btn btn-primary" onClick={() => setEditor({ kind: 'item' })}>+ Add owned item</button><button className="btn btn-secondary" onClick={() => setEditor({ kind: 'need' })}>+ Add need</button></div>
      </header>
      <section className="inventory-stats" aria-label="Inventory summary"><div><strong>{app.inventoryItems.filter(item => !item.archivedAt).length}</strong><span>Owned records</span></div><div><strong>{lowCount}</strong><span>Low stock</span></div><div><strong>{openNeedCount}</strong><span>Open needs</span></div></section>
      <section className="inventory-toolbar" aria-label="Inventory filters">
        <div className="inventory-view-tabs" role="tablist"><button className={view === 'owned' ? 'active' : ''} role="tab" aria-selected={view === 'owned'} onClick={() => setView('owned')}>Owned</button><button className={view === 'needed' ? 'active' : ''} role="tab" aria-selected={view === 'needed'} onClick={() => setView('needed')}>Needed</button></div>
        <label className="inventory-search"><span className="sr-only">Search inventory</span><input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools, stock, model, tag, location…" /></label>
        <select className="form-select" aria-label="Filter inventory category" value={subcategory} onChange={e => setSubcategory(e.target.value as 'all' | InventorySubcategory)}><option value="all">All categories</option>{INVENTORY_SUBCATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select className="form-select" aria-label="Filter inventory project" value={projectKey} onChange={e => setProjectKey(e.target.value)}><option value="all">All projects</option>{app.projects.filter(p => p.catalogKey).map(project => <option key={project.id} value={project.catalogKey}>{project.name}</option>)}</select>
        {view === 'owned' && <select className="form-select" aria-label="Filter inventory location" value={location} onChange={e => setLocation(e.target.value)}><option value="all">All locations</option>{locations.map(value => <option key={value} value={value}>{value}</option>)}</select>}
      </section>
      <section className="inventory-results" role="tabpanel" aria-label={`${view} inventory`}>
        <div className="inventory-results-heading"><h2>{view === 'owned' ? 'Owned catalogue' : 'Needs queue'}</h2><span>{view === 'owned' ? owned.length : needed.length} shown</span></div>
        <div className="inventory-card-grid">
          {view === 'owned' ? owned.map(item => <InventoryItemCard key={item.id} item={item} projectName={item.projectCatalogKeys.length === 1 ? projectNameByKey.get(item.projectCatalogKeys[0]) : undefined} onEdit={() => setEditor({ kind: 'item', item })} onNeed={() => setEditor({ kind: 'need', linkedItem: item, projectCatalogKey: item.projectCatalogKeys[0] })} />) : needed.map(need => <InventoryNeedCard key={need.id} need={need} projectName={need.projectCatalogKey ? projectNameByKey.get(need.projectCatalogKey) : undefined} onEdit={() => setEditor({ kind: 'need', need })} />)}
        </div>
        {(view === 'owned' ? owned.length : needed.length) === 0 && <div className="inventory-empty"><div aria-hidden="true">S1</div><h3>{query || projectKey !== 'all' ? 'No matching records' : view === 'owned' ? 'Your catalogue is ready' : 'No needs recorded'}</h3><p>{query || projectKey !== 'all' ? 'Change the filters or add a new record.' : view === 'owned' ? 'Add a tool, machine, component, material, or consumable.' : 'Record requirements here before buying.'}</p></div>}
      </section>
      {editor?.kind === 'item' && <ItemEditor item={editor.item} projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
      {editor?.kind === 'need' && <NeedEditor need={editor.need} linkedItem={editor.linkedItem} projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
      {editor?.kind === 'paste' && <PasteReview projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
    </div>
  );
}
