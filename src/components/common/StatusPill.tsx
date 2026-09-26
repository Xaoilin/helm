/** Colours for one status; each domain maps its own statuses to a tone. */
export interface StatusTone {
  background: string;
  color: string;
  border: string;
}

/** A rounded, colour-coded status label. */
export function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
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
      {label}
    </span>
  );
}
