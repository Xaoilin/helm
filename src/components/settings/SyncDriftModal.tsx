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

interface JsonDiffRow {
  databaseLine: string | null;
  deviceLine: string | null;
  kind: 'same' | 'database' | 'device';
}

function buildJsonDiffRows(databaseJson: string, deviceJson: string): JsonDiffRow[] {
  const databaseLines = databaseJson.split('\n');
  const deviceLines = deviceJson.split('\n');
  const rows = databaseLines.length;
  const columns = deviceLines.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () => Array(columns + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lcs[row][column] = databaseLines[row] === deviceLines[column]
        ? lcs[row + 1][column + 1] + 1
        : Math.max(lcs[row + 1][column], lcs[row][column + 1]);
    }
  }

  const diffRows: JsonDiffRow[] = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && databaseLines[row] === deviceLines[column]) {
      diffRows.push({ databaseLine: databaseLines[row], deviceLine: deviceLines[column], kind: 'same' });
      row += 1;
      column += 1;
    } else if (column >= columns || (row < rows && lcs[row + 1][column] >= lcs[row][column + 1])) {
      diffRows.push({ databaseLine: databaseLines[row], deviceLine: null, kind: 'database' });
      row += 1;
    } else {
      diffRows.push({ databaseLine: null, deviceLine: deviceLines[column], kind: 'device' });
      column += 1;
    }
  }

  return diffRows;
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
              {(item.remoteValue !== null || item.localValue !== null) && (
                <div className="sync-drift-field-values">
                  {item.remoteValue !== null && <em>Database: {item.remoteValue}</em>}
                  {item.localValue !== null && <em>Device: {item.localValue}</em>}
                </div>
              )}
            </li>
          ))}
          {remaining > 0 && <li><span>+{remaining} more</span></li>}
        </ul>
      )}
    </div>
  );
}

function JsonDiffViewer({ databaseJson, deviceJson }: { databaseJson: string; deviceJson: string }) {
  const rows = buildJsonDiffRows(databaseJson, deviceJson);

  return (
    <div className="sync-drift-json-diff" aria-label="Highlighted JSON differences">
      <div className="sync-drift-json-diff-header">
        <span>Database</span>
        <span>This device</span>
      </div>
      <div className="sync-drift-json-diff-body">
        {rows.map((row, index) => (
          <div className={`sync-drift-json-diff-row ${row.kind}`} key={`${index}:${row.kind}`}>
            <code>{row.databaseLine ?? ''}</code>
            <code>{row.deviceLine ?? ''}</code>
          </div>
        ))}
      </div>
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
  const actionableCandidates = useMemo(
    () => candidates.filter(candidate => candidate.requiresUserChoice),
    [candidates],
  );

  const activeCandidate = useMemo(
    () => actionableCandidates.find(candidate => candidate.groupId === selectedGroupId) || actionableCandidates[0] || null,
    [actionableCandidates, selectedGroupId],
  );

  if (!open || !activeCandidate) return null;

  const activeChoice = choices[activeCandidate.groupId] || activeCandidate.recommendedChoice;
  const resolving = resolvingGroupId === activeCandidate.groupId;

  return (
    <div className="modal-overlay sync-drift-overlay" role="presentation">
      <div className="modal sync-drift-modal" role="dialog" aria-modal="true" aria-labelledby="sync-drift-title">
        <div className="sync-drift-header">
          <div>
            <h2 id="sync-drift-title">Data differences need review</h2>
            <p>
              Only user data differences are shown here. System metadata follows Supabase automatically so Lina does not ask you about cache timestamps or connection bookkeeping.
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Close data differences">
            x
          </button>
        </div>

        <div className="sync-drift-layout">
          <div className="sync-drift-groups" aria-label="Data groups with differences">
            {actionableCandidates.map(candidate => {
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
                  <small>
                    {candidate.kind === 'unreadable'
                      ? 'Unreadable local data'
                      : `${candidate.userChoiceCount || count} ${candidate.userChoiceCount === 1 ? 'difference' : 'differences'} need your choice`}
                  </small>
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
                {activeCandidate.kind === 'unreadable' ? 'Needs review' : 'Needs your choice'}
              </span>
            </div>

            <div className="sync-drift-readable-summary">
              <strong>{activeCandidate.summary}</strong>
              {activeCandidate.autoResolvedCount > 0 && (
                <span>{activeCandidate.autoResolvedCount} system {activeCandidate.autoResolvedCount === 1 ? 'difference' : 'differences'} will be cleaned up with Supabase.</span>
              )}
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
              <DiffList title="Only on this device" items={activeCandidate.diff.localOnly} empty="No device-only user data" />
              <DiffList title="Only in database" items={activeCandidate.diff.remoteOnly} empty="No database-only user data" />
              <DiffList title="Changed content" items={activeCandidate.diff.changed} empty="No changed user data" />
            </div>

            <details className="sync-drift-json">
              <summary>Highlighted JSON diff</summary>
              <JsonDiffViewer databaseJson={activeCandidate.remote.redactedJson} deviceJson={activeCandidate.local.redactedJson} />
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
