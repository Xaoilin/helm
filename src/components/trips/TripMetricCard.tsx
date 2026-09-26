export default function TripMetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f5f7ff' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{note}</div>}
    </div>
  );
}
