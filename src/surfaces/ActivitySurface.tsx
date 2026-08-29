import { useState } from 'react';
import { useAssistantActivityContext } from "../store/contexts/AssistantActivityContext";
import { useAssistantUndo } from "../store/contexts/AssistantUndoContext";
import type { AssistantActivityEntry } from '../types/domain';

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actorLabel(entry: AssistantActivityEntry): string {
  switch (entry.actor) {
    case 'voice':
      return 'Voice';
    case 'system':
      return 'System';
    case 'chat':
    default:
      return 'Chat';
  }
}

function statusLabel(entry: AssistantActivityEntry): string {
  if (entry.status === 'undone') return 'Undone';
  if (entry.status === 'undo_failed') return 'Undo failed';
  return entry.undoOperation ? 'Undo available' : 'Logged';
}

function statusTone(entry: AssistantActivityEntry): string {
  if (entry.status === 'undone') return 'success';
  if (entry.status === 'undo_failed') return 'danger';
  return entry.undoOperation ? 'ready' : 'neutral';
}

function domainLabel(entry: AssistantActivityEntry): string {
  return entry.domain.charAt(0).toUpperCase() + entry.domain.slice(1);
}

export default function ActivitySurface() {
  const activity = useAssistantActivityContext();
  const assistantUndo = useAssistantUndo();
  const [notice, setNotice] = useState<string>('');
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const entries = activity.assistantActivityLog;
  const undoableCount = entries.filter(entry => entry.undoOperation && entry.status === 'applied').length;
  const voiceCount = entries.filter(entry => entry.actor === 'voice').length;

  function handleUndo(entry: AssistantActivityEntry) {
    if (!entry.undoOperation || entry.status !== 'applied') return;
    setUndoingId(entry.id);
    const result = assistantUndo.undoAssistantActivity(entry.id);
    setNotice(result.message);
    setUndoingId(null);
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Activity</h1>
          <div className="subtitle">Audit trail for Lina actions, with undo when Sabah One has a grounded inverse operation.</div>
        </div>
      </div>

      <div className="surface-body activity-surface">
        <div className="activity-stats" aria-label="Lina activity summary">
          <div className="activity-stat">
            <span>Total actions</span>
            <strong>{entries.length}</strong>
          </div>
          <div className="activity-stat">
            <span>Undoable now</span>
            <strong>{undoableCount}</strong>
          </div>
          <div className="activity-stat">
            <span>Voice actions</span>
            <strong>{voiceCount}</strong>
          </div>
        </div>

        {notice && (
          <div className="activity-notice" role="status">
            {notice}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="activity-empty">
            <div className="activity-empty-title">No Lina actions logged yet</div>
            <div className="activity-empty-copy">
              Ask Lina to create a task, schedule an event, record a transaction, or save a note and the action will appear here.
            </div>
          </div>
        ) : (
          <div className="activity-list" aria-label="Lina action log">
            {entries.map(entry => {
              const canUndo = Boolean(entry.undoOperation && entry.status === 'applied');
              return (
                <article className="activity-entry" key={entry.id}>
                  <div className="activity-entry-main">
                    <div className="activity-entry-topline">
                      <span className={`activity-status ${statusTone(entry)}`}>{statusLabel(entry)}</span>
                      <span>{domainLabel(entry)}</span>
                      <span>{actorLabel(entry)}</span>
                      <time dateTime={entry.createdAt}>{formatActivityTime(entry.createdAt)}</time>
                    </div>
                    <h2>{entry.summary}</h2>
                    {entry.sourceTranscript && (
                      <div className="activity-transcript">
                        <span>Request</span>
                        <p>{entry.sourceTranscript}</p>
                      </div>
                    )}
                    {entry.details.length > 0 && (
                      <ul className="activity-details">
                        {entry.details.slice(0, 5).map(detail => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    )}
                    {entry.undoError && (
                      <div className="activity-error">{entry.undoError}</div>
                    )}
                  </div>
                  <div className="activity-entry-actions">
                    {canUndo ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleUndo(entry)}
                        disabled={undoingId === entry.id}
                      >
                        {undoingId === entry.id ? 'Undoing...' : 'Undo'}
                      </button>
                    ) : (
                      <span className="activity-no-undo">
                        {entry.status === 'undone' ? 'Action undone' : 'No undo'}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
