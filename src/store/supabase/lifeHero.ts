/** Life Hero snapshot, evidence and recompute RPCs with strict response mapping. */
import { logError } from '../../services/logger';
import {
  isLifeHeroEvidenceKind,
  LIFE_HERO_RULESET_VERSION,
  LIFE_HERO_STATS,
  validateLifeHeroEvidenceInput,
} from '../../services/lifeHeroProgression';
import type {
  LifeHeroActivityEntry,
  LifeHeroAward,
  LifeHeroConditionState,
  LifeHeroEvidence,
  LifeHeroEvidenceInput,
  LifeHeroEvidenceReceipt,
  LifeHeroEvidenceSyncReceipt,
  LifeHeroEvidenceSourceTier,
  LifeHeroSnapshot,
  LifeHeroStat,
  LifeHeroStatProgress,
} from '../../types/domain';
import { requireClient } from './client';
import { asRecord } from './json';

const LIFE_HERO_SOURCE_TIERS = new Set<LifeHeroEvidenceSourceTier>([
  'verified',
  'trusted_integration',
  'self_reported',
]);
const LIFE_HERO_CONDITIONS = new Set<LifeHeroConditionState>([
  'awaiting_first_step',
  'steady',
  'renewal_due',
]);

function lifeHeroStat(value: unknown): LifeHeroStat {
  if (typeof value !== 'string' || !LIFE_HERO_STATS.includes(value as LifeHeroStat)) {
    throw new Error('The Sabah One Life Hero response contained an invalid stat.');
  }
  return value as LifeHeroStat;
}

function mapLifeHeroEvidence(value: unknown): LifeHeroEvidence {
  const row = asRecord(value);
  if (
    typeof row.id !== 'string'
    || typeof row.rulesetVersion !== 'string'
    || !isLifeHeroEvidenceKind(row.evidenceType)
    || typeof row.sourceTier !== 'string'
    || !LIFE_HERO_SOURCE_TIERS.has(row.sourceTier as LifeHeroEvidenceSourceTier)
    || typeof row.sourceReference !== 'string'
    || typeof row.idempotencyKey !== 'string'
    || typeof row.occurredAt !== 'string'
    || typeof row.localDate !== 'string'
    || typeof row.createdAt !== 'string'
  ) {
    throw new Error('The Sabah One Life Hero response contained invalid evidence.');
  }
  return {
    id: row.id,
    rulesetVersion: row.rulesetVersion,
    stat: lifeHeroStat(row.stat),
    evidenceType: row.evidenceType,
    sourceTier: row.sourceTier as LifeHeroEvidenceSourceTier,
    sourceReference: row.sourceReference,
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    localDate: row.localDate,
    metadata: asRecord(row.metadata) as LifeHeroEvidence['metadata'],
    createdAt: row.createdAt,
  };
}

function mapLifeHeroAward(value: unknown): LifeHeroAward {
  const row = asRecord(value);
  if (
    typeof row.id !== 'string'
    || typeof row.evidenceId !== 'string'
    || typeof row.rulesetVersion !== 'string'
    || typeof row.awardedAt !== 'string'
  ) {
    throw new Error('The Sabah One Life Hero response contained an invalid award.');
  }
  const award = {
    id: row.id,
    evidenceId: row.evidenceId,
    rulesetVersion: row.rulesetVersion,
    stat: lifeHeroStat(row.stat),
    baseXp: Number(row.baseXp),
    sourceMultiplier: Number(row.sourceMultiplier),
    momentumDays: Number(row.momentumDays),
    momentumMultiplier: Number(row.momentumMultiplier),
    awardedXp: Number(row.awardedXp),
    awardedAt: row.awardedAt,
  } satisfies LifeHeroAward;
  if (
    !Number.isInteger(award.baseXp)
    || award.baseXp < 0
    || !Number.isFinite(award.sourceMultiplier)
    || award.sourceMultiplier <= 0
    || !Number.isInteger(award.momentumDays)
    || award.momentumDays < 1
    || !Number.isFinite(award.momentumMultiplier)
    || award.momentumMultiplier < 1
    || !Number.isInteger(award.awardedXp)
    || award.awardedXp < 0
  ) {
    throw new Error('The Sabah One Life Hero response contained invalid award values.');
  }
  return award;
}

function mapLifeHeroStatProgress(value: unknown): LifeHeroStatProgress {
  const row = asRecord(value);
  if (typeof row.condition !== 'string' || !LIFE_HERO_CONDITIONS.has(row.condition as LifeHeroConditionState)) {
    throw new Error('The Sabah One Life Hero response contained an invalid condition.');
  }
  const progress = {
    stat: lifeHeroStat(row.stat),
    totalXp: Number(row.totalXp),
    level: Number(row.level),
    lastEvidenceLocalDate: typeof row.lastEvidenceLocalDate === 'string' ? row.lastEvidenceLocalDate : null,
    condition: row.condition as LifeHeroConditionState,
    attentionAfterDays: Number(row.attentionAfterDays),
  } satisfies LifeHeroStatProgress;
  if (
    !Number.isInteger(progress.totalXp)
    || progress.totalXp < 0
    || !Number.isInteger(progress.level)
    || progress.level < 1
    || !Number.isInteger(progress.attentionAfterDays)
    || progress.attentionAfterDays < 1
  ) {
    throw new Error('The Sabah One Life Hero snapshot contained invalid stat progress.');
  }
  return progress;
}

function mapLifeHeroActivity(value: unknown): LifeHeroActivityEntry {
  const row = asRecord(value);
  return {
    evidence: mapLifeHeroEvidence(row.evidence),
    award: mapLifeHeroAward(row.award),
  };
}

function mapLifeHeroSnapshot(value: unknown): LifeHeroSnapshot {
  const row = asRecord(value);
  if (
    typeof row.rulesetVersion !== 'string'
    || row.rulesetVersion !== LIFE_HERO_RULESET_VERSION
    || typeof row.updatedAt !== 'string'
    || typeof row.recomputedAt !== 'string'
    || !Array.isArray(row.stats)
    || !Array.isArray(row.recentActivity)
  ) {
    throw new Error('The Sabah One Life Hero snapshot response was invalid.');
  }
  const snapshot = {
    rulesetVersion: row.rulesetVersion,
    totalXp: Number(row.totalXp),
    overallLevel: Number(row.overallLevel),
    updatedAt: row.updatedAt,
    recomputedAt: row.recomputedAt,
    stats: row.stats.map(mapLifeHeroStatProgress),
    recentActivity: row.recentActivity.map(mapLifeHeroActivity),
  } satisfies LifeHeroSnapshot;
  if (
    !Number.isInteger(snapshot.totalXp)
    || snapshot.totalXp < 0
    || !Number.isInteger(snapshot.overallLevel)
    || snapshot.overallLevel < 1
    || snapshot.stats.length !== LIFE_HERO_STATS.length
    || snapshot.stats.some((stat, index) => stat.stat !== LIFE_HERO_STATS[index])
    || new Set(snapshot.stats.map(stat => stat.stat)).size !== LIFE_HERO_STATS.length
  ) {
    throw new Error('The Sabah One Life Hero snapshot response was incomplete.');
  }
  return snapshot;
}

export async function fetchLifeHeroSnapshot(asOfLocalDate: string): Promise<LifeHeroSnapshot> {
  const database = requireClient();
  const { data, error } = await database.rpc('get_life_hero_snapshot', {
    p_as_of_local_date: asOfLocalDate,
  });
  if (error) throw error;
  return mapLifeHeroSnapshot(data);
}

export async function syncLifeHeroEvidence(
  asOfLocalDate: string,
): Promise<LifeHeroEvidenceSyncReceipt> {
  const database = requireClient();
  const { data, error } = await database.rpc('sync_life_hero_evidence', {
    p_as_of_local_date: asOfLocalDate,
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  const result = asRecord(data);
  const scanned = Number(result.scanned);
  const accepted = Number(result.accepted);
  const duplicates = Number(result.duplicates);
  if (
    !Number.isInteger(scanned) || scanned < 0
    || !Number.isInteger(accepted) || accepted < 0
    || !Number.isInteger(duplicates) || duplicates < 0
    || accepted + duplicates !== scanned
  ) {
    throw new Error('The Sabah One Life Hero evidence sync response was invalid.');
  }
  return {
    scanned,
    accepted,
    duplicates,
    snapshot: mapLifeHeroSnapshot(result.snapshot),
  };
}

export async function acceptLifeHeroEvidence(
  input: LifeHeroEvidenceInput,
): Promise<LifeHeroEvidenceReceipt> {
  const normalized = validateLifeHeroEvidenceInput(input);
  const database = requireClient();
  const { data, error } = await database.rpc('accept_life_hero_evidence', {
    p_idempotency_key: normalized.idempotencyKey,
    p_evidence_type: normalized.evidenceType,
    p_source_tier: normalized.sourceTier,
    p_source_reference: normalized.sourceReference,
    p_occurred_at: normalized.occurredAt,
    p_local_date: normalized.localDate,
    p_metadata: normalized.metadata ?? {},
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  const result = asRecord(data);
  return {
    duplicate: result.duplicate === true,
    evidence: mapLifeHeroEvidence(result.evidence),
    award: mapLifeHeroAward(result.award),
    snapshot: mapLifeHeroSnapshot(result.snapshot),
  };
}

export async function recomputeLifeHeroProfile(asOfLocalDate: string): Promise<LifeHeroSnapshot> {
  const database = requireClient();
  const { data, error } = await database.rpc('recompute_life_hero_profile', {
    p_as_of_local_date: asOfLocalDate,
  });
  if (error) throw error;
  return mapLifeHeroSnapshot(data);
}
