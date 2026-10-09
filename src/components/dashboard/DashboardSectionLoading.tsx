interface DashboardSectionLoadingProps {
  label: string;
  error?: string | null;
}

/** Reserve card space while its own service responds; never show default account values as data. */
export default function DashboardSectionLoading({ label, error }: DashboardSectionLoadingProps) {
  return (
    <div className="nc-section-loading" role={error ? 'alert' : 'status'} aria-label={`Loading ${label}`}>
      <p>{error ? `${error} Refresh this page to try again.` : `Loading ${label}…`}</p>
      {!error && <div className="nc-loading-lines" aria-hidden="true"><span /><span /><span /></div>}
    </div>
  );
}
