export interface MetricCardProps {
  label: string;
  value: string;
  note?: string;
  /**
   * `card` is the standalone surface card used by Projects and Trips.
   * `stat` is the compact tile styled by `.activity-stat` inside a stats row.
   */
  variant?: 'card' | 'stat';
}

/** One labelled number with an optional explanatory note. */
export function MetricCard({ label, value, note, variant = 'card' }: MetricCardProps) {
  if (variant === 'stat') {
    return (
      <div className="activity-stat">
        <span>{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f5f7ff' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{note}</div>}
    </div>
  );
}
