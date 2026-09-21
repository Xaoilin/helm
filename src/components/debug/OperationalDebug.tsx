import { useEffect, useState } from 'react';
import { exportOperationalDiagnostics, getOperationalSnapshot, subscribeOperationalEvents } from '../../services/operationalTelemetry';

export default function OperationalDebug() {
  const [snapshot, setSnapshot] = useState(getOperationalSnapshot);
  const [exported, setExported] = useState(false);
  useEffect(() => subscribeOperationalEvents(setSnapshot), []);
  const exportDiagnostics = () => {
    const url = URL.createObjectURL(new Blob([exportOperationalDiagnostics()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sabah-one-operational-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setExported(true);
  };
  return (
    <section className="card" aria-label="Operational diagnostics" style={{ padding: 20, minWidth: 0 }}>
      <h2 style={{ fontSize: 18 }}>Operational diagnostics</h2>
      <p style={{ color: 'var(--text-secondary, #a1a6bd)', lineHeight: 1.5 }}>Recent connection and recovery events. This session keeps up to 200 events for one hour; signing out clears them. Exports contain normalized diagnostics without account contents.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '16px 0' }}>
        <button className="btn btn-secondary" onClick={exportDiagnostics}>Export diagnostics</button>
        <span role="status">{exported ? 'Diagnostics exported.' : `Collection: ${snapshot.sink.replaceAll('_', ' ')}`}</span>
      </div>
      {snapshot.sink === 'unavailable' && <p role="status">Diagnostic collection is unavailable ({snapshot.sinkReason}). App operations remain independent. Transient failures receive bounded retries.</p>}
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {[
          ['Disconnects', snapshot.counters.disconnects], ['Failed reads', snapshot.counters.failedReads],
          ['Failed writes', snapshot.counters.failedWrites], ['Recoveries', snapshot.counters.recoveries],
          ['Last recovery', snapshot.counters.lastRecoveryMs === null ? 'None' : `${snapshot.counters.lastRecoveryMs} ms`],
          ['Pending collection', snapshot.pending], ['Dropped events', snapshot.dropped],
        ].map(([label, value]) => <div key={label}><dt style={{ color: 'var(--text-secondary, #a1a6bd)', fontSize: 12 }}>{label}</dt><dd style={{ margin: '4px 0', fontWeight: 600 }}>{value}</dd></div>)}
      </dl>
      <p style={{ color: 'var(--text-secondary, #a1a6bd)', fontSize: 12 }}>Counters cover retained session observations and may undercount when events are dropped. Hosted history is available to the site operator in Supabase Logs.</p>
      {snapshot.events.length === 0 ? <p>No events in this session yet.</p> : (
        <ol aria-label="Operational event timeline" style={{ listStyle: 'none', padding: 0 }}>
          {snapshot.events.slice().reverse().map(event => (
            <li key={event.id} style={{ borderTop: '1px solid var(--border, #30364d)', padding: '12px 0', overflowWrap: 'anywhere' }}>
              <strong>{event.domain} · {event.operation} · {event.outcome}</strong>
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>{event.reason} · {event.durationMs} ms · attempt {event.attempt} · {event.freshness}
                {event.recoveryMs !== null && ` · recovered in ${event.recoveryMs} ms`}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary, #a1a6bd)' }}>{event.occurredAt} · v{event.release}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary, #a1a6bd)' }}>Correlation {event.correlationId}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
