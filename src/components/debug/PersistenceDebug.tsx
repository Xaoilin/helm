import { useEffect, useState } from 'react';
import {
  getPersistenceHealthSnapshot,
  listLocalImportCandidates,
  subscribePersistenceHealth,
  type LocalImportCandidate,
  type PersistenceHealthSnapshot,
} from '../../store/persistence';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#8b8fa3', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#f5f6ff', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'None';
}

export default function PersistenceDebug() {
  const [snapshot, setSnapshot] = useState<PersistenceHealthSnapshot>(() => getPersistenceHealthSnapshot());
  const [candidates, setCandidates] = useState<LocalImportCandidate[]>([]);
  const previewCandidates = candidates.slice(0, 10);
  const extraCandidateCount = Math.max(0, candidates.length - previewCandidates.length);

  useEffect(() => subscribePersistenceHealth(setSnapshot), []);

  useEffect(() => {
    let cancelled = false;
    listLocalImportCandidates().then(nextCandidates => {
      if (!cancelled) setCandidates(nextCandidates);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot.localImportCandidateCount, snapshot.mode]);

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Persistence</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 14,
          alignItems: 'start',
        }}
      >
        <Field label="Mode" value={snapshot.mode === 'database' ? 'Supabase database' : 'Local-first'} />
        <Field label="Last remote read" value={snapshot.lastRemoteReadKey || 'None'} />
        <Field label="Last remote read error" value={snapshot.lastRemoteReadError || 'None'} />
        <Field label="Last remote write" value={snapshot.lastRemoteWriteKey || 'None'} />
        <Field label="Last remote write error" value={snapshot.lastRemoteWriteError || 'None'} />
        <Field label="Remote read failures" value={formatList(snapshot.remoteReadFailedKeys)} />
        <Field label="Queued writes" value={String(snapshot.supabaseQueue.queuedCount)} />
        <Field label="Realtime" value={snapshot.supabaseRealtime.state} />
        <Field label="Realtime error" value={snapshot.supabaseRealtime.lastError || 'None'} />
        <Field label="Local import candidates" value={String(candidates.length)} />
        <Field label="Sync drift conflicts" value={String(snapshot.syncDriftConflictCount)} />
        <Field label="Last drift scan" value={snapshot.lastSyncDriftScanAt || 'None'} />
        <Field label="Last drift resolution" value={snapshot.lastSyncDriftResolutionAt || 'None'} />
        <Field label="Last drift error" value={snapshot.lastSyncDriftError || 'None'} />
        <Field label="Calendar cache cleanup" value={snapshot.lastCalendarCacheCleanupAt || 'None'} />
        <Field label="Calendar cleanup reason" value={snapshot.lastCalendarCacheCleanupReason || 'None'} />
        <Field label="Calendar refresh requested" value={snapshot.lastCalendarSyncRequestAt || 'None'} />
        <Field label="Calendar refresh reason" value={snapshot.lastCalendarSyncRequestReason || 'None'} />
      </div>
      {candidates.length > 0 && (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#d9dcef' }}>
            {snapshot.mode === 'database' ? 'Local copies available for import' : 'Local store keys on this device'}
          </div>
          {previewCandidates.map(candidate => (
            <div
              key={candidate.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                borderTop: '1px solid #24283a',
                paddingTop: 8,
                fontSize: 12,
                color: '#9499b0',
              }}
            >
              <strong style={{ color: '#d9dcef' }}>{candidate.label}</strong>
              {' '}
              <span>{candidate.remoteExists === true ? 'DB has data' : candidate.remoteExists === false ? 'DB empty' : 'DB unknown'}</span>
            </div>
          ))}
          {extraCandidateCount > 0 && (
            <div style={{ fontSize: 12, color: '#8b8fa3' }}>+{extraCandidateCount} more</div>
          )}
        </div>
      )}
    </div>
  );
}
