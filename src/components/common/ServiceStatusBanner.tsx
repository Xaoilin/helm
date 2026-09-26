/** Why a service-backed page may be out of date, with a retry. Renders nothing while it is current. */
export function ServiceStatusBanner({ label, error, onRetry }: {
  label: string;
  error: string | null;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div className="info-box warning" role="alert" style={{ marginBottom: 8 }}>
      {label}: {error}{' '}
      <button className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button>
    </div>
  );
}
