import { getTripStatusLabel } from '../../services/tripDisplay';
import type { TripStatus } from '../../types/domain';

const STATUS_TONES: Record<TripStatus, { background: string; border: string; color: string }> = {
  planning: { background: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' },
  booked: { background: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.35)', color: '#86efac' },
  in_trip: { background: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)', color: '#fcd34d' },
  completed: { background: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.35)', color: '#d8b4fe' },
  archived: { background: 'rgba(107, 114, 128, 0.12)', border: 'rgba(107, 114, 128, 0.35)', color: '#d1d5db' },
};

export default function TripStatusPill({ status }: { status: TripStatus }) {
  const tone = STATUS_TONES[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {getTripStatusLabel(status)}
    </span>
  );
}
