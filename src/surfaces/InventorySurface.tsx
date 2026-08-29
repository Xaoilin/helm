import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useShell } from '../store/ShellContext';
import { useInventoryContext } from '../store/contexts/InventoryContext';
import { useProjectContext } from '../store/contexts/ProjectContext';
import type {
  InventoryCategory,
  InventoryCondition,
  InventoryDimensionUnit,
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
  formatInventoryDimensions,
  inventoryMajorCategoryForRecord,
  inventorySubcategoryMeta,
  INVENTORY_SUBCATEGORY_OPTIONS,
  isInventoryLowStock,
  normalizeInventoryItemDraft,
  normalizeInventoryDimensions,
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
const DIMENSION_UNIT_OPTIONS: InventoryDimensionUnit[] = ['mm', 'cm', 'm', 'in'];

function categoryMeta(category: InventoryCategory) {
  return CATEGORY_OPTIONS.find(option => option.value === category) || CATEGORY_OPTIONS.at(-1)!;
}

function groupByMajorCategory<T extends { category?: InventoryCategory; subcategory?: InventorySubcategory }>(records: T[]) {
  const grouped = new Map<InventoryCategory, T[]>();
  records.forEach(record => {
    const category = inventoryMajorCategoryForRecord(record);
    const entries = grouped.get(category);
    if (entries) entries.push(record);
    else grouped.set(category, [record]);
  });
  return CATEGORY_OPTIONS.flatMap(option => {
    const entries = grouped.get(option.value);
    return entries?.length ? [{ ...option, entries }] : [];
  });
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
    formatInventoryDimensions(item.dimensions),
    ...item.tags, ...Object.keys(item.specifications), ...Object.values(item.specifications),
  ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function searchableNeed(need: InventoryNeed): string {
  const subcategory = inventorySubcategoryMeta(need.subcategory);
  return [
    need.name, need.category, need.subcategory, subcategory?.label, need.notes,
    formatInventoryDimensions(need.dimensions),
    ...Object.keys(need.specifications), ...Object.values(need.specifications),
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

function parseDimensions(
  length: string,
  width: string,
  height: string,
  unit: InventoryDimensionUnit,
) {
  if (!length.trim() && !width.trim() && !height.trim()) return undefined;
  return normalizeInventoryDimensions({
    ...(length.trim() ? { length: Number(length) } : {}),
    ...(width.trim() ? { width: Number(width) } : {}),
    ...(height.trim() ? { height: Number(height) } : {}),
    unit,
  });
}

function dimensionInput(value: number | undefined): string {
  return value == null ? '' : String(value);
}

function DimensionFields({
  length,
  width,
  height,
  unit,
  onLength,
  onWidth,
  onHeight,
  onUnit,
}: {
  length: string;
  width: string;
  height: string;
  unit: InventoryDimensionUnit;
  onLength: (value: string) => void;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  onUnit: (value: InventoryDimensionUnit) => void;
}) {
  return (
    <fieldset className="inventory-dimensions inventory-field-wide">
      <legend>Dimensions <span>(optional)</span></legend>
      <p>Enter any known axes; at least one value is required when used.</p>
      <div className="inventory-dimension-grid">
        <label className="inventory-dimension-field"><span>Length</span><input className="form-input" aria-label="Dimension length" inputMode="decimal" type="number" min="0" step="any" value={length} onChange={event => onLength(event.target.value)} placeholder="Optional" /></label>
        <label className="inventory-dimension-field"><span>Width</span><input className="form-input" aria-label="Dimension width" inputMode="decimal" type="number" min="0" step="any" value={width} onChange={event => onWidth(event.target.value)} placeholder="Optional" /></label>
        <label className="inventory-dimension-field"><span>Height</span><input className="form-input" aria-label="Dimension height" inputMode="decimal" type="number" min="0" step="any" value={height} onChange={event => onHeight(event.target.value)} placeholder="Optional" /></label>
        <label className="inventory-dimension-field"><span>Unit</span><select className="form-select" aria-label="Dimension unit" value={unit} onChange={event => onUnit(event.target.value as InventoryDimensionUnit)}>{DIMENSION_UNIT_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
    </fieldset>
  );
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
  const inventory = useInventoryContext();
  const projects = useProjectContext();
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
  const [dimensionLength, setDimensionLength] = useState(dimensionInput(item?.dimensions?.length));
  const [dimensionWidth, setDimensionWidth] = useState(dimensionInput(item?.dimensions?.width));
  const [dimensionHeight, setDimensionHeight] = useState(dimensionInput(item?.dimensions?.height));
  const [dimensionUnit, setDimensionUnit] = useState<InventoryDimensionUnit>(item?.dimensions?.unit || 'mm');
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
        dimensions: parseDimensions(dimensionLength, dimensionWidth, dimensionHeight, dimensionUnit),
        specifications: parseSpecifications(specifications),
        condition,
        location,
        tags: tags.split(',').map(value => value.trim()).filter(Boolean),
        notes,
        projectCatalogKeys: projectKeys,
        lastVerifiedAt: new Date().toISOString(),
        archivedAt: item?.archivedAt,
      });
      if (item) inventory.updateInventoryItem(item.id, draft);
      else inventory.addInventoryItem(draft);
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
        <DimensionFields length={dimensionLength} width={dimensionWidth} height={dimensionHeight} unit={dimensionUnit} onLength={setDimensionLength} onWidth={setDimensionWidth} onHeight={setDimensionHeight} onUnit={setDimensionUnit} />
        <label className="inventory-field inventory-field-wide"><span>Specifications</span><textarea className="form-input" value={specifications} onChange={e => setSpecifications(e.target.value)} rows={4} placeholder={'thread: M3\nmaterial: brass'} /></label>
        <fieldset className="inventory-project-links inventory-field-wide">
          <legend>Projects</legend>
          {projects.projects.filter(project => project.catalogKey).map(project => (
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
  const inventory = useInventoryContext();
  const projects = useProjectContext();
  const [name, setName] = useState(need?.name || linkedItem?.name || '');
  const [subcategory, setSubcategory] = useState<InventorySubcategory>(
    need?.subcategory
      || linkedItem?.subcategory
      || defaultInventorySubcategory(need?.category || linkedItem?.category || 'other'),
  );
  const [imageUrl, setImageUrl] = useState(need?.imageUrl || linkedItem?.imageUrl || '');
  const [quantity, setQuantity] = useState(String(need?.requiredQuantity ?? 1));
  const [unit, setUnit] = useState(need?.unit || linkedItem?.unit || 'pcs');
  const [dimensionLength, setDimensionLength] = useState(dimensionInput(need?.dimensions?.length ?? linkedItem?.dimensions?.length));
  const [dimensionWidth, setDimensionWidth] = useState(dimensionInput(need?.dimensions?.width ?? linkedItem?.dimensions?.width));
  const [dimensionHeight, setDimensionHeight] = useState(dimensionInput(need?.dimensions?.height ?? linkedItem?.dimensions?.height));
  const [dimensionUnit, setDimensionUnit] = useState<InventoryDimensionUnit>(need?.dimensions?.unit || linkedItem?.dimensions?.unit || 'mm');
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
        dimensions: parseDimensions(dimensionLength, dimensionWidth, dimensionHeight, dimensionUnit),
        specifications: parseSpecifications(specifications),
        priority,
        status: need?.status || 'needed',
        notes,
        orderedAt: need?.orderedAt,
        acquiredAt: need?.acquiredAt,
        dismissedAt: need?.dismissedAt,
      });
      if (need) inventory.updateInventoryNeed(need.id, draft);
      else inventory.addInventoryNeed(draft);
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
        <label className="inventory-field"><span>Project</span><select className="form-select" value={projectKey} onChange={e => setProjectKey(e.target.value)}><option value="">No project</option>{projects.projects.filter(project => project.catalogKey).map(project => <option key={project.id} value={project.catalogKey}>{project.name}</option>)}</select></label>
        <label className="inventory-field inventory-field-wide"><span>Product image URL</span><input className="form-input" inputMode="url" type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} maxLength={2048} placeholder="https://…" /></label>
        <DimensionFields length={dimensionLength} width={dimensionWidth} height={dimensionHeight} unit={dimensionUnit} onLength={setDimensionLength} onWidth={setDimensionWidth} onHeight={setDimensionHeight} onUnit={setDimensionUnit} />
        <label className="inventory-field inventory-field-wide"><span>Required specifications</span><textarea className="form-input" value={specifications} onChange={e => setSpecifications(e.target.value)} rows={4} placeholder={'thread: M3\nmaterial: brass'} /></label>
        <label className="inventory-field inventory-field-wide"><span>Notes</span><textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={4} /></label>
        {error && <div className="inventory-error" role="alert">{error}</div>}
        <div className="inventory-modal-actions inventory-field-wide"><button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">{need ? 'Save need' : 'Add need'}</button></div>
      </form>
    </InventoryModal>
  );
}

function PasteReview({ projectCatalogKey, onClose }: { projectCatalogKey?: string; onClose: () => void }) {
  const inventory = useInventoryContext();
  const [input, setInput] = useState('');
  const [candidates, setCandidates] = useState<InventoryPasteCandidate[]>([]);
  const [error, setError] = useState('');

  const review = () => {
    const parsed = parseInventoryPaste(input, inventory.inventoryItems).map(candidate => ({
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
        duplicateItemIds: findLikelyInventoryDuplicates(draft as InventoryItem, inventory.inventoryItems).map(item => item.id),
      };
    }));
  };
  const save = () => {
    try {
      const selected = candidates.filter(candidate => candidate.selected).map(candidate => normalizeInventoryItemDraft(candidate.draft));
      if (selected.length === 0) throw new Error('Select at least one candidate.');
      inventory.addInventoryItems(selected);
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
  const inventory = useInventoryContext();
  const low = isInventoryLowStock(item);
  const meta = categoryMeta(item.category);
  const subcategory = inventorySubcategoryMeta(item.subcategory);
  return (
    <article className={`inventory-card ${low ? 'is-low' : ''}`}>
      <InventoryPhoto imageUrl={item.imageUrl} name={item.name} fallback={meta.icon} />
      <div className="inventory-card-main">
        <div className="inventory-card-heading"><div><h4>{item.name}</h4><p>{[item.brand, item.model].filter(Boolean).join(' · ') || subcategory?.label || meta.label}</p></div>{low && <span className="inventory-low-badge">Low stock</span>}</div>
        <div className="inventory-card-meta"><span>{subcategory?.label || meta.label}</span><span>{item.quantity} {item.unit}</span>{formatInventoryDimensions(item.dimensions) && <span>{formatInventoryDimensions(item.dimensions)}</span>}{item.location && <span>{item.location}</span>}<span>{item.condition.replace('_', ' ')}</span>{projectName && <span>{projectName}</span>}</div>
        {item.tags.length > 0 && <div className="inventory-tags">{item.tags.slice(0, 5).map(tag => <span key={tag}>{tag}</span>)}</div>}
        <div className="inventory-card-actions">
          <div className="inventory-stepper" aria-label={`Adjust ${item.name} quantity`}><button type="button" onClick={() => inventory.adjustInventoryQuantity(item.id, -1)} disabled={item.quantity <= 0} aria-label={`Decrease ${item.name}`}>−</button><strong>{item.quantity}</strong><button type="button" onClick={() => inventory.adjustInventoryQuantity(item.id, 1)} aria-label={`Increase ${item.name}`}>+</button></div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onNeed}>Need more</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { if (window.confirm(`Archive “${item.name}”?`)) inventory.archiveInventoryItem(item.id); }}>Archive</button>
        </div>
      </div>
    </article>
  );
}

function InventoryNeedCard({ need, projectName, onEdit }: { need: InventoryNeed; projectName?: string; onEdit: () => void }) {
  const inventory = useInventoryContext();
  const [error, setError] = useState('');
  const meta = categoryMeta(need.category || 'other');
  const subcategory = inventorySubcategoryMeta(need.subcategory);
  const markAcquired = () => {
    try {
      inventory.completeInventoryNeed(need.id);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <article className={`inventory-card inventory-need-card priority-${need.priority}`}>
      <InventoryPhoto imageUrl={need.imageUrl} name={need.name} fallback="＋" />
      <div className="inventory-card-main">
        <div className="inventory-card-heading"><div><h4>{need.name}</h4><p>{subcategory?.label || meta.label} · {need.requiredQuantity} {need.unit} required{projectName ? ` · ${projectName}` : ''}</p></div><span className={`inventory-need-status status-${need.status}`}>{need.status}</span></div>
        {formatInventoryDimensions(need.dimensions) && <div className="inventory-card-meta"><span>{formatInventoryDimensions(need.dimensions)}</span></div>}
        {need.notes && <p className="inventory-card-notes">{need.notes}</p>}
        <div className="inventory-card-actions">
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-primary btn-sm" type="button" onClick={markAcquired}>Mark acquired</button>}
          {need.status === 'needed' && <button className="btn btn-secondary btn-sm" type="button" onClick={() => inventory.updateInventoryNeed(need.id, { status: 'ordered', orderedAt: new Date().toISOString() })}>Mark ordered</button>}
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-secondary btn-sm" type="button" onClick={onEdit}>Edit</button>}
          {(need.status === 'needed' || need.status === 'ordered') && <button className="btn btn-ghost btn-sm" type="button" onClick={() => inventory.updateInventoryNeed(need.id, { status: 'dismissed', dismissedAt: new Date().toISOString() })}>Dismiss</button>}
        </div>
        {error && <div className="inventory-error" role="alert">{error}</div>}
      </div>
    </article>
  );
}

export function ProjectInventorySection({ catalogKey, projectName }: { catalogKey: string; projectName: string }) {
  const inventory = useInventoryContext();
  const shell = useShell();
  const items = inventory.inventoryItems.filter(item => !item.archivedAt && item.projectCatalogKeys.includes(catalogKey));
  const needs = inventory.inventoryNeeds.filter(need => need.projectCatalogKey === catalogKey && (need.status === 'needed' || need.status === 'ordered'));
  return (
    <section className="project-inventory-panel" aria-label={`${projectName} inventory`}>
      <div className="project-inventory-heading"><div><div className="inventory-eyebrow">PROJECT INVENTORY</div><h2>Tools, stock, and needs</h2><p>{items.length} owned · {needs.length} open needs</p></div><button className="btn btn-primary" type="button" onClick={() => shell.navigate('inventory')}>Open global Inventory</button></div>
      <div className="project-inventory-summary">
        {items.slice(0, 8).map(item => <div key={item.id} className="project-inventory-chip"><InventoryPhoto compact imageUrl={item.imageUrl} name={item.name} fallback={categoryMeta(item.category).icon} /><strong>{item.name}</strong><small>{item.quantity} {item.unit}{formatInventoryDimensions(item.dimensions) ? ` · ${formatInventoryDimensions(item.dimensions)}` : ''}</small></div>)}
        {needs.slice(0, 6).map(need => <div key={need.id} className="project-inventory-chip is-needed"><InventoryPhoto compact imageUrl={need.imageUrl} name={need.name} fallback="＋" /><strong>{need.name}</strong><small>{need.requiredQuantity} {need.unit} needed{formatInventoryDimensions(need.dimensions) ? ` · ${formatInventoryDimensions(need.dimensions)}` : ''}</small></div>)}
        {items.length === 0 && needs.length === 0 && <div className="inventory-empty-inline">Nothing is linked yet. Add or edit an Inventory record and select this project.</div>}
      </div>
    </section>
  );
}

export default function InventorySurface() {
  const inventory = useInventoryContext();
  const projects = useProjectContext();
  const [view, setView] = useState<InventoryView>('owned');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | InventoryCategory>('all');
  const [projectKey, setProjectKey] = useState('all');
  const [location, setLocation] = useState('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const projectNameByKey = useMemo(() => new Map(projects.projects.filter(p => p.catalogKey).map(p => [p.catalogKey!, p.name])), [projects.projects]);
  const locations = useMemo(() => [...new Set(inventory.inventoryItems.map(item => item.location).filter((value): value is string => Boolean(value)))].sort(), [inventory.inventoryItems]);

  const owned = useMemo(() => inventory.inventoryItems.filter(item => {
    if (item.archivedAt) return false;
    if (query && !searchableItem(item).includes(query.toLocaleLowerCase())) return false;
    if (category !== 'all' && inventoryMajorCategoryForRecord(item) !== category) return false;
    if (projectKey !== 'all' && !item.projectCatalogKeys.includes(projectKey)) return false;
    if (location !== 'all' && item.location !== location) return false;
    return true;
  }), [inventory.inventoryItems, query, category, projectKey, location]);
  const needed = useMemo(() => inventory.inventoryNeeds.filter(need => {
    if (query && !searchableNeed(need).includes(query.toLocaleLowerCase())) return false;
    if (category !== 'all' && inventoryMajorCategoryForRecord(need) !== category) return false;
    if (projectKey !== 'all' && need.projectCatalogKey !== projectKey) return false;
    return need.status !== 'dismissed';
  }), [inventory.inventoryNeeds, query, category, projectKey]);
  const ownedGroups = useMemo(() => groupByMajorCategory(owned), [owned]);
  const neededGroups = useMemo(() => groupByMajorCategory(needed), [needed]);
  const lowCount = inventory.inventoryItems.filter(isInventoryLowStock).length;
  const openNeedCount = inventory.inventoryNeeds.filter(need => need.status === 'needed' || need.status === 'ordered').length;

  return (
    <div className="surface inventory-surface">
      <header className="inventory-hero">
        <div className="inventory-hero-copy"><div className="inventory-eyebrow">SABAH ONE INVENTORY</div><h1>Know what you have before you buy.</h1><p>One account-backed catalogue for every project and every Lina planning conversation.</p></div>
        <div className="inventory-hero-actions"><button className="btn btn-secondary" onClick={() => setEditor({ kind: 'paste' })}>Paste and review</button><button className="btn btn-primary" onClick={() => setEditor({ kind: 'item' })}>+ Add owned item</button><button className="btn btn-secondary" onClick={() => setEditor({ kind: 'need' })}>+ Add need</button></div>
      </header>
      <section className="inventory-stats" aria-label="Inventory summary"><div><strong>{inventory.inventoryItems.filter(item => !item.archivedAt).length}</strong><span>Owned records</span></div><div><strong>{lowCount}</strong><span>Low stock</span></div><div><strong>{openNeedCount}</strong><span>Open needs</span></div></section>
      <section className="inventory-toolbar" aria-label="Inventory filters">
        <div className="inventory-view-tabs" role="tablist"><button className={view === 'owned' ? 'active' : ''} role="tab" aria-selected={view === 'owned'} onClick={() => setView('owned')}>Owned</button><button className={view === 'needed' ? 'active' : ''} role="tab" aria-selected={view === 'needed'} onClick={() => setView('needed')}>Needed</button></div>
        <label className="inventory-search"><span className="sr-only">Search inventory</span><input className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools, stock, model, tag, location…" /></label>
        <select className="form-select inventory-category-filter" aria-label="Filter inventory category" value={category} onChange={e => setCategory(e.target.value as 'all' | InventoryCategory)}><option value="all">All major categories</option>{CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select className="form-select inventory-project-filter" aria-label="Filter inventory project" value={projectKey} onChange={e => setProjectKey(e.target.value)}><option value="all">All projects</option>{projects.projects.filter(p => p.catalogKey).map(project => <option key={project.id} value={project.catalogKey}>{project.name}</option>)}</select>
        {view === 'owned' && <select className="form-select inventory-location-filter" aria-label="Filter inventory location" value={location} onChange={e => setLocation(e.target.value)}><option value="all">All locations</option>{locations.map(value => <option key={value} value={value}>{value}</option>)}</select>}
      </section>
      <section className="inventory-results" role="tabpanel" aria-label={`${view} inventory`}>
        <div className="inventory-results-heading"><h2>{view === 'owned' ? 'Owned catalogue' : 'Needs queue'}</h2><span>{view === 'owned' ? owned.length : needed.length} shown</span></div>
        <div className="inventory-category-groups">
          {(view === 'owned' ? ownedGroups : neededGroups).map(group => {
            const headingId = `inventory-${view}-${group.value}-heading`;
            return (
              <section key={group.value} className="inventory-category-section" aria-labelledby={headingId}>
                <header className="inventory-category-heading">
                  <h3 id={headingId}>{group.label}</h3>
                  <span>{group.entries.length} {group.entries.length === 1 ? 'item' : 'items'}</span>
                </header>
                <div className="inventory-card-grid">
                  {view === 'owned'
                    ? (group.entries as InventoryItem[]).map(item => <InventoryItemCard key={item.id} item={item} projectName={item.projectCatalogKeys.length === 1 ? projectNameByKey.get(item.projectCatalogKeys[0]) : undefined} onEdit={() => setEditor({ kind: 'item', item })} onNeed={() => setEditor({ kind: 'need', linkedItem: item, projectCatalogKey: item.projectCatalogKeys[0] })} />)
                    : (group.entries as InventoryNeed[]).map(need => <InventoryNeedCard key={need.id} need={need} projectName={need.projectCatalogKey ? projectNameByKey.get(need.projectCatalogKey) : undefined} onEdit={() => setEditor({ kind: 'need', need })} />)}
                </div>
              </section>
            );
          })}
        </div>
        {(view === 'owned' ? owned.length : needed.length) === 0 && <div className="inventory-empty"><div aria-hidden="true">S1</div><h3>{query || projectKey !== 'all' ? 'No matching records' : view === 'owned' ? 'Your catalogue is ready' : 'No needs recorded'}</h3><p>{query || projectKey !== 'all' ? 'Change the filters or add a new record.' : view === 'owned' ? 'Add a tool, machine, component, material, or consumable.' : 'Record requirements here before buying.'}</p></div>}
      </section>
      {editor?.kind === 'item' && <ItemEditor item={editor.item} projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
      {editor?.kind === 'need' && <NeedEditor need={editor.need} linkedItem={editor.linkedItem} projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
      {editor?.kind === 'paste' && <PasteReview projectCatalogKey={editor.projectCatalogKey} onClose={() => setEditor(null)} />}
    </div>
  );
}
