import { useState, type ChangeEvent } from 'react';
import { acceptLifeHeroEvidence } from '../store/supabase';
import {
  APPLE_HEALTH_MAX_EXPORT_BYTES,
  parseAppleHealthMovementExport,
  submitAppleHealthMovementEvidence,
  type AppleHealthMovementImportReceipt,
} from '../services/appleHealthMovement';

interface AppleHealthMovementImportProps {
  timeZone: string;
  now?: Date;
}

type ImportState =
  | { status: 'idle'; receipt: null; message: null }
  | { status: 'working'; receipt: null; message: string }
  | { status: 'success'; receipt: AppleHealthMovementImportReceipt; message: string }
  | { status: 'error'; receipt: null; message: string };

const INITIAL_STATE: ImportState = { status: 'idle', receipt: null, message: null };

function formatFreshness(receipt: AppleHealthMovementImportReceipt): string {
  const ageLabel = receipt.freshness.ageDays === 0
    ? 'exported today'
    : `exported ${receipt.freshness.ageDays} day${receipt.freshness.ageDays === 1 ? '' : 's'} ago`;
  return `${ageLabel} · ${receipt.freshness.exportedAt.slice(0, 10)}`;
}

export default function AppleHealthMovementImport({ timeZone, now }: AppleHealthMovementImportProps) {
  const [state, setState] = useState<ImportState>(INITIAL_STATE);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setState({ status: 'working', receipt: null, message: 'Reading the selected export locally…' });
    try {
      if (file.size > APPLE_HEALTH_MAX_EXPORT_BYTES) {
        throw new Error('This Apple Health export is too large to import safely.');
      }
      const xml = await file.text();
      const parsed = parseAppleHealthMovementExport(xml, { timeZone, now });
      const receipt = await submitAppleHealthMovementEvidence(parsed, acceptLifeHeroEvidence);
      setState({
        status: 'success',
        receipt,
        message: `Imported ${receipt.importedDays} movement day${receipt.importedDays === 1 ? '' : 's'} safely.`,
      });
    } catch (error) {
      setState({
        status: 'error',
        receipt: null,
        message: error instanceof Error ? error.message : 'Apple Health import failed safely.',
      });
    }
  }

  const receipt = state.receipt;
  return (
    <section className="health-panel apple-health-import" aria-labelledby="apple-health-import-title">
      <div className="health-panel-header">
        <div>
          <div className="health-panel-eyebrow">Movement evidence</div>
          <h3 id="apple-health-import-title">Import from iPhone Health</h3>
        </div>
        <span className="apple-health-import-badge">Export bridge</span>
      </div>
      <p className="apple-health-import-copy">
        Automatic HealthKit sync is unavailable in the hosted web app. Export your data from the iPhone Health app,
        then select the XML here. No watch, native app, credentials, routes, or location data are needed.
      </p>
      <label className="apple-health-import-picker">
        <span>Select Apple Health XML</span>
        <input type="file" accept=".xml,text/xml,application/xml" onChange={handleFileChange} disabled={state.status === 'working'} />
      </label>
      <p className="apple-health-import-hint">
        The file is read locally and discarded after this import session. Only positive iPhone steps or walking/running
        distance are reduced to one movement-present day.
      </p>
      {state.message && (
        <div className={`apple-health-import-status is-${state.status}`} role="status" aria-live="polite">
          {state.message}
        </div>
      )}
      {receipt && (
        <dl className="apple-health-import-receipt">
          <div><dt>Source</dt><dd>{receipt.sourceLabel}</dd></div>
          <div><dt>Date range</dt><dd>{receipt.dateRange.start} to {receipt.dateRange.end}</dd></div>
          <div><dt>Freshness</dt><dd>{formatFreshness(receipt)}</dd></div>
          <div><dt>Duplicate-safe</dt><dd>{receipt.accepted} new · {receipt.duplicates} already recorded</dd></div>
        </dl>
      )}
    </section>
  );
}
