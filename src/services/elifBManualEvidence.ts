import type { LifeHeroEvidenceInput } from '../types/domain';

export const ELIF_B_PROVIDER_LABEL = 'Elif B';
export const ELIF_B_MANUAL_PROVENANCE = 'sabah_one_manual_confirmation';
export const ELIF_B_MANUAL_STATUS = 'user_confirmed_not_provider_verified';
export const ELIF_B_MANUAL_FRESHNESS = 'confirmed_at_submission';
export const ELIF_B_QUALIFYING_REASON = 'completed_learning_session';

export interface ElifBManualEvidenceDraft {
  sessionLabel: string;
  localDate: string;
  providerConfirmed: boolean;
}

export interface ElifBManualEvidenceValidation {
  sessionLabel: string;
  localDate: string;
}

/**
 * Validates the small, user-assisted input before turning it into the generic
 * Life Hero evidence contract. The label is used only to derive an opaque
 * session identity and is never sent to persistence.
 */
export function validateElifBManualEvidenceDraft(
  draft: ElifBManualEvidenceDraft,
): ElifBManualEvidenceValidation {
  const sessionLabel = draft.sessionLabel.trim();
  if (!sessionLabel || sessionLabel.length > 120) {
    throw new Error('Add a short session label, such as “Session 1”.');
  }
  if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d ()-]{7,}\d/u.test(sessionLabel)) {
    throw new Error('Use a short session label only; do not enter links, contact details, or private content.');
  }
  if (!draft.providerConfirmed) {
    throw new Error('Confirm that this was a completed Elif B learning session.');
  }
  assertLocalDate(draft.localDate);
  return { sessionLabel, localDate: draft.localDate };
}

export function buildElifBManualEvidenceInput(
  draft: ElifBManualEvidenceDraft,
  confirmedAt = new Date(),
): LifeHeroEvidenceInput {
  const validated = validateElifBManualEvidenceDraft(draft);
  const confirmedAtIso = confirmedAt.toISOString();
  return {
    idempotencyKey: `elif-b-manual:${createSessionIdentity(validated.sessionLabel, validated.localDate)}`,
    evidenceType: 'knowledge_learning',
    sourceTier: 'self_reported',
    sourceReference: `elif-b:manual:${createSessionIdentity(validated.sessionLabel, validated.localDate)}`,
    occurredAt: `${validated.localDate}T12:00:00.000Z`,
    localDate: validated.localDate,
    metadata: {
      provider: ELIF_B_PROVIDER_LABEL,
      status: ELIF_B_MANUAL_STATUS,
      freshness: ELIF_B_MANUAL_FRESHNESS,
      provenance: ELIF_B_MANUAL_PROVENANCE,
      qualifyingReason: ELIF_B_QUALIFYING_REASON,
      confirmedAt: confirmedAtIso,
    },
  };
}

function createSessionIdentity(sessionLabel: string, localDate: string): string {
  // Stable, non-secret identity. The raw label remains in memory only long
  // enough to derive this value, so retries map to the same database identity.
  let hash = 2166136261;
  for (const character of `${ELIF_B_PROVIDER_LABEL}\u0000${sessionLabel.toLowerCase()}\u0000${localDate}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error('Choose a valid session date.');
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error('Choose a valid session date.');
  }
}
