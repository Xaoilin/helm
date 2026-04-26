import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import type { CaptureClassification, CaptureItem, CaptureItemSource, CaptureStatus } from '../types/domain';

type InboxFilter = 'active' | 'unprocessed' | 'classified' | 'archived';

const CLASSIFICATION_OPTIONS: Array<{ value: CaptureClassification; label: string }> = [
  { value: 'unknown', label: 'Unsorted' },
  { value: 'task', label: 'Task' },
  { value: 'project_note', label: 'Project note' },
  { value: 'calendar_idea', label: 'Calendar idea' },
  { value: 'trip_item', label: 'Trip item' },
  { value: 'health_log', label: 'Health log' },
  { value: 'knowledge_entry', label: 'Knowledge entry' },
];

const SOURCE_LABELS: Record<CaptureItemSource, string> = {
  chat: 'Chat',
  voice: 'Voice',
  shortcut: 'Shortcut',
  quick_button: 'Quick button',
  manual: 'Manual',
};

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getClassificationLabel(value: CaptureClassification): string {
  return CLASSIFICATION_OPTIONS.find(option => option.value === value)?.label || 'Unsorted';
}

function getPreviewLabel(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact;
}

function nextStatusForClassification(item: CaptureItem, classification: CaptureClassification): CaptureStatus {
  if (item.status === 'archived') return 'archived';
  return classification === 'unknown' ? 'unprocessed' : 'classified';
}

export default function CaptureInboxSurface() {
  const app = useApp();
  const [draft, setDraft] = useState('');
  const [draftClassification, setDraftClassification] = useState<CaptureClassification>('unknown');
  const [filter, setFilter] = useState<InboxFilter>('active');

  const counts = useMemo(() => ({
    active: app.captureItems.filter(item => item.status !== 'archived').length,
    unprocessed: app.captureItems.filter(item => item.status === 'unprocessed').length,
    classified: app.captureItems.filter(item => item.status === 'classified').length,
    archived: app.captureItems.filter(item => item.status === 'archived').length,
  }), [app.captureItems]);

  const filteredItems = useMemo(() => {
    const items = [...app.captureItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter === 'active') return items.filter(item => item.status !== 'archived');
    return items.filter(item => item.status === filter);
  }, [app.captureItems, filter]);

  const handleSave = () => {
    const content = draft.trim();
    if (!content) return;

    app.addCaptureItem({
      content,
      source: 'manual',
      classification: draftClassification,
      status: draftClassification === 'unknown' ? 'unprocessed' : 'classified',
      sourceSurface: 'inbox',
      processedAt: draftClassification === 'unknown' ? undefined : new Date().toISOString(),
    });
    setDraft('');
    setDraftClassification('unknown');
    setFilter('active');
  };

  const updateClassification = (item: CaptureItem, classification: CaptureClassification) => {
    app.updateCaptureItem(item.id, {
      classification,
      status: nextStatusForClassification(item, classification),
      processedAt: classification === 'unknown' ? undefined : new Date().toISOString(),
    });
  };

  const toggleArchive = (item: CaptureItem) => {
    if (item.status === 'archived') {
      app.updateCaptureItem(item.id, {
        status: item.classification === 'unknown' ? 'unprocessed' : 'classified',
      });
      return;
    }

    app.updateCaptureItem(item.id, {
      status: 'archived',
      processedAt: new Date().toISOString(),
    });
  };

  const filterTabs: Array<{ id: InboxFilter; label: string; count: number }> = [
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'unprocessed', label: 'Unprocessed', count: counts.unprocessed },
    { id: 'classified', label: 'Classified', count: counts.classified },
    { id: 'archived', label: 'Archived', count: counts.archived },
  ];

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Inbox</h1>
          <div className="subtitle">
            {counts.unprocessed} unprocessed &middot; {counts.classified} classified &middot; {counts.archived} archived
          </div>
        </div>
      </div>

      <div className="surface-body capture-inbox-surface">
        <section className="capture-composer" aria-label="Capture composer">
          <div className="capture-composer-main">
            <textarea
              className="form-input capture-composer-input"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  handleSave();
                }
              }}
              aria-label="New capture"
              placeholder="Write capture..."
            />
          </div>
          <div className="capture-composer-actions">
            <select
              className="form-select"
              value={draftClassification}
              onChange={event => setDraftClassification(event.target.value as CaptureClassification)}
              aria-label="New capture classification"
            >
              {CLASSIFICATION_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!draft.trim()}>
              Capture
            </button>
          </div>
        </section>

        <div className="capture-filter-row" role="tablist" aria-label="Inbox filters">
          {filterTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`capture-filter-tab ${filter === tab.id ? 'active' : ''}`}
              onClick={() => setFilter(tab.id)}
              role="tab"
              aria-selected={filter === tab.id}
            >
              <span>{tab.label}</span>
              <strong>{tab.count}</strong>
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">IN</div>
            <h3>No captures here</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFilter('active')}>
              Active inbox
            </button>
          </div>
        ) : (
          <div className="capture-list" aria-label="Capture inbox items">
            {filteredItems.map(item => (
              <article className={`capture-item ${item.status}`} key={item.id}>
                <div className="capture-item-main">
                  <div className="capture-item-topline">
                    <span className={`capture-status ${item.status}`}>{item.status}</span>
                    <span>{SOURCE_LABELS[item.source]}</span>
                    <time dateTime={item.createdAt}>{formatCaptureTime(item.createdAt)}</time>
                    {item.sourceSurface && <span>{item.sourceSurface}</span>}
                  </div>
                  <p>{item.content}</p>
                </div>
                <div className="capture-item-actions">
                  <select
                    className="form-select"
                    value={item.classification}
                    onChange={event => updateClassification(item, event.target.value as CaptureClassification)}
                    aria-label={`Classify ${getPreviewLabel(item.content)}`}
                  >
                    {CLASSIFICATION_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="capture-classification">{getClassificationLabel(item.classification)}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleArchive(item)}>
                    {item.status === 'archived' ? 'Reopen' : 'Archive'}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => app.removeCaptureItem(item.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
