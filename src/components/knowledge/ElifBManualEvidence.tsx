import { useState } from 'react';
import { acceptLifeHeroEvidence } from '../../store/supabase';
import {
  buildElifBManualEvidenceInput,
  ELIF_B_MANUAL_FRESHNESS,
  ELIF_B_MANUAL_PROVENANCE,
  ELIF_B_MANUAL_STATUS,
  ELIF_B_PROVIDER_LABEL,
} from '../../services/elifBManualEvidence';
import type { LifeHeroEvidenceReceipt } from '../../types/domain';

function todayLocalDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export default function ElifBManualEvidence() {
  const [sessionLabel, setSessionLabel] = useState('');
  const [localDate, setLocalDate] = useState(todayLocalDate);
  const [providerConfirmed, setProviderConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<LifeHeroEvidenceReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setReceipt(null);
    try {
      const input = buildElifBManualEvidenceInput({ sessionLabel, localDate, providerConfirmed });
      setSaving(true);
      const nextReceipt = await acceptLifeHeroEvidence(input);
      setReceipt(nextReceipt);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'The learning evidence could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="elif-b-evidence-title"
      style={{ marginBottom: 24, padding: 18, border: '1px solid #2c3150', borderRadius: 12, background: '#171a2b' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 id="elif-b-evidence-title" style={{ margin: 0, fontSize: 18 }}>Elif B learning evidence</h2>
          <p style={{ margin: '6px 0 0', color: '#a7acc4', fontSize: 13, lineHeight: 1.5 }}>
            Record one completed session manually. This is user-confirmed and never provider-verified.
          </p>
        </div>
        <span style={{ color: '#f2c14e', fontSize: 12, whiteSpace: 'nowrap' }}>Self-reported · Knowledge</span>
      </div>

      <div style={{ display: 'grid', gap: 12, maxWidth: 560, marginTop: 16 }}>
        <label className="form-group" style={{ margin: 0 }}>
          <span>Short session label</span>
          <input
            className="form-input"
            value={sessionLabel}
            onChange={event => setSessionLabel(event.target.value)}
            placeholder="e.g. Session 1"
            maxLength={120}
            aria-describedby="elif-b-evidence-help"
          />
        </label>
        <p id="elif-b-evidence-help" style={{ margin: '-4px 0 0', color: '#777d98', fontSize: 12 }}>
          Use a short label only. Do not paste lesson content, messages, links, contact details, credentials, or screenshots.
        </p>
        <label className="form-group" style={{ margin: 0 }}>
          <span>Completed session date</span>
          <input className="form-input" type="date" value={localDate} onChange={event => setLocalDate(event.target.value)} />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#d8dbee', fontSize: 13, lineHeight: 1.45 }}>
          <input
            type="checkbox"
            checked={providerConfirmed}
            onChange={event => setProviderConfirmed(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>I confirm that <strong>{ELIF_B_PROVIDER_LABEL}</strong> is the provider and that I completed this session.</span>
        </label>
        <button className="btn btn-primary" type="button" onClick={() => void submit()} disabled={saving || !sessionLabel.trim() || !providerConfirmed}>
          {saving ? 'Saving confirmation…' : 'Record completed session'}
        </button>
      </div>

      {error && <p role="alert" style={{ margin: '14px 0 0', color: '#ff8989', fontSize: 13 }}>{error}</p>}
      {receipt && (
        <div role="status" style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#202640', color: '#d8dbee', fontSize: 13, lineHeight: 1.55 }}>
          <strong>{receipt.duplicate ? 'This session was already recorded.' : 'Session recorded.'}</strong>
          <div>Status: {ELIF_B_MANUAL_STATUS.replaceAll('_', ' ')}</div>
          <div>Provenance: {ELIF_B_MANUAL_PROVENANCE.replaceAll('_', ' ')}</div>
          <div>Freshness: {ELIF_B_MANUAL_FRESHNESS.replaceAll('_', ' ')}</div>
          <div>Session identity: <code>{receipt.evidence.sourceReference}</code></div>
        </div>
      )}
    </section>
  );
}
