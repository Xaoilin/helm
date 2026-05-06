import { useMemo, useState } from 'react';
import type {
  SyncDriftCandidate,
  SyncDriftDiffItem,
  SyncResolutionChoice,
} from '../../store/persistence';

interface SyncDriftModalProps {
  candidates: SyncDriftCandidate[];
  open: boolean;
  resolvingGroupId: string | null;
  onClose: () => void;
  onResolve: (candidate: SyncDriftCandidate, choice: SyncResolutionChoice) => void;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} bytes`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function formatSource(source: string): string {
  switch (source) {
    case 'database':
      return 'Supabase';
    case 'tauri':
      return 'Device file store';
    case 'localStorage':
      return 'Browser cache';
    case 'mixed':
      return 'Multiple stores';
    default:
      return 'No data';
  }
}

function itemSummary(items: SyncDriftDiffItem[], empty: string): string {
  if (items.length === 0) return empty;
  return `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
}

function DiffList({ title, items, empty }: { title: string; items: SyncDriftDiffItem[]; empty: string }) {
  const visibleItems = items.slice(0, 8);
  const remaining = items.length - visibleItems.length;

  return (
    <div className="sync-drift-diff-block">
      <div className="sync-drift-diff-heading">
        <span>{title}</span>
        <strong>{itemSummary(items, empty)}</strong>
      </div>
      {items.length > 0 && (
        <ul className="sync-drift-diff-list">
          {visibleItems.map(item => (
            <li key={`${item.key}:${item.id}`}>
              <span>{item.label}</span>
              <small>{item.keyLabel} - {item.detail}</small>
            </li>
          ))}
          {remaining > 0 && <li><span>+{remaining} more</span></li>}
        </ul>
      )}
    </div>
  );
}

export default function SyncDriftModal({
  candidates,
  open,
  resolvingGroupId,
  onClose,
  onResolve,
}: SyncDriftModalProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, SyncResolutionChoice>>({});

  const activeCandidate = useMemo(
    () => candidates.find(candidate => candidate.groupId === selectedGroupId) || candidates[0] || null,
    [candidates, selectedGroupId],
  );

  if (!open || !activeCandidate) return null;

  const activeChoice = choices[activeCandidate.groupId] || activeCandidate.recommendedChoice;
  const resolving = resolvingGroupId === activeCandidate.groupId;
  const differenceCount = activeCandidate.diff.localOnly.length
    + activeCandidate.diff.remoteOnly.length
    + activeCandidate.diff.changed.length;

  return (
    <div className="modal-overlay sync-drift-overlay" role="presentation">
      <div className="modal sync-drift-modal" role="dialog" aria-modal="true" aria-labelledby="sync-drift-title">
        <div className="sync-drift-header">
          <div>
            <h2 id="sync-drift-title">Data differences need review</h2>
            <p>
              Supabase is the signed-in source of truth. These local device copies are different enough that Lina needs your choice before clearing or replacing anything.
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Close data differences">
            x
          </button>
        </div>

        <div className="sync-drift-layout">
          <div className="sync-drift-groups" aria-label="Data groups with differences">
            {candidates.map(candidate => {
              const selected = candidate.groupId === activeCandidate.groupId;
              const count = candidate.diff.localOnly.length + candidate.diff.remoteOnly.length + candidate.diff.changed.length;
              return (
                <button
                  key={candidate.groupId}
                  type="button"
                  className={`sync-drift-group-button${selected ? ' active' : ''}`}
                  onClick={() => setSelectedGroupId(candidate.groupId)}
                >
                  <span>{candidate.label}</span>
                  <small>{candidate.kind === 'unreadable' ? 'Unreadable local data' : `${count} differences`}</small>
                </button>
              );
            })}
          </div>

          <div className="sync-drift-detail">
            <div className="sync-drift-section-title">
              <div>
                <h3>{activeCandidate.label}</h3>
                <p>{activeCandidate.description}</p>
              </div>
              <span className={`sync-drift-pill ${activeCandidate.kind}`}>
                {activeCandidate.kind === 'unreadable' ? 'Needs review' : `${differenceCount} differences`}
              </span>
            </div>

            <div className="sync-drift-choice">
              <label className={activeChoice === 'keep_database' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`sync-choice-${activeCandidate.groupId}`}
                  checked={activeChoice === 'keep_database'}
                  onChange={() => setChoices(current => ({ ...current, [activeCandidate.groupId]: 'keep_database' }))}
                />
                <span>
                  <strong>Keep database</strong>
                  <small>Use Supabase and clear this device copy.</small>
                </span>
              </label>
              <label className={activeChoice === 'use_device' ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`sync-choice-${activeCandidate.groupId}`}
                  checked={activeChoice === 'use_device'}
                  disabled={!activeCandidate.canUseDevice}
                  onChange={() => setChoices(current => ({ ...current, [activeCandidate.groupId]: 'use_device' }))}
                />
                <span>
                  <strong>Use this device</strong>
                  <small>{activeCandidate.canUseDevice ? 'Write this device copy to Supabase.' : 'Unavailable because the local JSON cannot be read.'}</small>
                </span>
              </label>
            </div>

            <div className="sync-drift-side-grid">
              <div>
                <h4>Database</h4>
                <p>{formatSource(activeCandidate.remote.source)} - {formatBytes(activeCandidate.remote.sizeBytes)}</p>
              </div>
              <div>
                <h4>This device</h4>
                <p>{formatSource(activeCandidate.local.source)} - {formatBytes(activeCandidate.local.sizeBytes)}</p>
              </div>
            </div>

            <div className="sync-drift-diff-grid">
              <DiffList title="Only on this device" items={activeCandidate.diff.localOnly} empty="No local-only items" />
              <DiffList title="Only in database" items={activeCandidate.diff.remoteOnly} empty="No database-only items" />
              <DiffList title="Changed in both" items={activeCandidate.diff.changed} empty="No changed items" />
            </div>

            <details className="sync-drift-json">
              <summary>Exact JSON</summary>
              <div className="sync-drift-json-grid">
                <div>
                  <h4>Database</h4>
                  <pre>{activeCandidate.remote.redactedJson}</pre>
                </div>
                <div>
                  <h4>This device</h4>
                  <pre>{activeCandidate.local.redactedJson}</pre>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={resolving}>Later</button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={resolving || (activeChoice === 'use_device' && !activeCandidate.canUseDevice)}
            onClick={() => onResolve(activeCandidate, activeChoice)}
          >
            {resolving ? 'Resolving...' : 'Resolve selected'}
          </button>
        </div>
      </div>
    </div>
  );
}
