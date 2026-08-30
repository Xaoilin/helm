import type {
  LifeHeroAward,
  LifeHeroConditionState,
  LifeHeroEvidenceInput,
  LifeHeroEvidenceKind,
  LifeHeroStat,
} from '../types/domain';

export const LIFE_HERO_RULESET_VERSION = 'life-hero-v1';
export const LIFE_HERO_LEVEL_CURVE_FACTOR = 100;

export const LIFE_HERO_STATS = [
  'faith',
  'vitality',
  'knowledge',
  'discipline',
  'finances',
  'craft',
  'community',
] as const satisfies readonly LifeHeroStat[];

export const LIFE_HERO_EVIDENCE_RULES = {
  faith_practice: { stat: 'faith', baseXp: 20 },
  vitality_activity: { stat: 'vitality', baseXp: 20 },
  knowledge_learning: { stat: 'knowledge', baseXp: 20 },
  discipline_commitment: { stat: 'discipline', baseXp: 15 },
  financial_progress: { stat: 'finances', baseXp: 25 },
  craft_practice: { stat: 'craft', baseXp: 20 },
  community_service: { stat: 'community', baseXp: 25 },
} as const satisfies Record<LifeHeroEvidenceKind, { stat: LifeHeroStat; baseXp: number }>;

export const LIFE_HERO_ATTENTION_AFTER_DAYS = {
  faith: 1,
  vitality: 2,
  knowledge: 3,
  discipline: 2,
  finances: 7,
  craft: 7,
  community: 7,
} as const satisfies Record<LifeHeroStat, number>;

const LIFE_HERO_EVIDENCE_KIND_SET = new Set<string>(Object.keys(LIFE_HERO_EVIDENCE_RULES));
const SENSITIVE_METADATA_KEY = /(authorization|cookie|credential|password|raw|secret|token)/iu;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface LifeHeroProjection {
  totalXp: number;
  overallLevel: number;
  stats: Record<LifeHeroStat, { totalXp: number; level: number }>;
}

export interface LifeHeroCondition {
  stat: LifeHeroStat;
  state: LifeHeroConditionState;
  lastEvidenceLocalDate: string | null;
  attentionAfterDays: number;
}

export function isLifeHeroEvidenceKind(value: unknown): value is LifeHeroEvidenceKind {
  return typeof value === 'string' && LIFE_HERO_EVIDENCE_KIND_SET.has(value);
}

export function lifeHeroLevelFromXp(
  totalXp: number,
  curveFactor = LIFE_HERO_LEVEL_CURVE_FACTOR,
): number {
  if (!Number.isFinite(totalXp) || totalXp < 0) throw new Error('Life Hero XP must be a non-negative number.');
  if (!Number.isFinite(curveFactor) || curveFactor <= 0) {
    throw new Error('Life Hero level curve factor must be positive.');
  }
  return Math.floor(Math.sqrt(totalXp / curveFactor)) + 1;
}

export function lifeHeroMomentumMultiplier(momentumDays: number): number {
  if (!Number.isInteger(momentumDays) || momentumDays < 1) {
    throw new Error('Life Hero momentum days must be a positive integer.');
  }
  if (momentumDays >= 14) return 1.5;
  if (momentumDays >= 7) return 1.25;
  if (momentumDays >= 3) return 1.1;
  return 1;
}

export function recomputeLifeHeroProgression(
  awards: readonly Pick<LifeHeroAward, 'stat' | 'awardedXp'>[],
): LifeHeroProjection {
  const totals = Object.fromEntries(
    LIFE_HERO_STATS.map(stat => [stat, 0]),
  ) as Record<LifeHeroStat, number>;

  for (const award of awards) {
    if (!LIFE_HERO_STATS.includes(award.stat)) throw new Error(`Unknown Life Hero stat: ${award.stat}`);
    if (!Number.isInteger(award.awardedXp) || award.awardedXp < 0) {
      throw new Error('Life Hero awards must contain non-negative integer XP.');
    }
    totals[award.stat] += award.awardedXp;
  }

  const stats = Object.fromEntries(LIFE_HERO_STATS.map(stat => [stat, {
    totalXp: totals[stat],
    level: lifeHeroLevelFromXp(totals[stat]),
  }])) as LifeHeroProjection['stats'];
  const totalXp = LIFE_HERO_STATS.reduce((sum, stat) => sum + totals[stat], 0);
  return { totalXp, overallLevel: lifeHeroLevelFromXp(totalXp), stats };
}

export function deriveLifeHeroConditions(
  lastEvidenceByStat: Partial<Record<LifeHeroStat, string | null>>,
  asOfLocalDate: string,
): LifeHeroCondition[] {
  const asOfDay = parseLocalDate(asOfLocalDate);
  return LIFE_HERO_STATS.map(stat => {
    const lastEvidenceLocalDate = lastEvidenceByStat[stat] ?? null;
    const attentionAfterDays = LIFE_HERO_ATTENTION_AFTER_DAYS[stat];
    if (!lastEvidenceLocalDate) {
      return { stat, state: 'awaiting_first_step', lastEvidenceLocalDate, attentionAfterDays };
    }
    const lastDay = parseLocalDate(lastEvidenceLocalDate);
    const elapsedDays = Math.max(0, Math.floor((asOfDay - lastDay) / 86_400_000));
    return {
      stat,
      state: elapsedDays > attentionAfterDays ? 'renewal_due' : 'steady',
      lastEvidenceLocalDate,
      attentionAfterDays,
    };
  });
}

export function validateLifeHeroEvidenceInput(input: LifeHeroEvidenceInput): LifeHeroEvidenceInput {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 256) {
    throw new Error('Life Hero evidence needs an idempotency key of at most 256 characters.');
  }
  if (!isLifeHeroEvidenceKind(input.evidenceType)) {
    throw new Error('This evidence type cannot award Life Hero XP.');
  }
  if (!input.sourceReference.trim() || input.sourceReference.length > 512) {
    throw new Error('Life Hero evidence needs a source reference of at most 512 characters.');
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error('Life Hero evidence needs a valid occurrence time.');
  }
  parseLocalDate(input.localDate);

  const metadata = input.metadata ?? {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEY.test(key)) {
      throw new Error(`Life Hero evidence metadata cannot contain sensitive field ${key}.`);
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error('Life Hero evidence metadata must contain only scalar values.');
    }
  }
  if (JSON.stringify(metadata).length > 8_192) {
    throw new Error('Life Hero evidence metadata must remain under 8 KiB.');
  }

  return {
    ...input,
    idempotencyKey: input.idempotencyKey.trim(),
    sourceReference: input.sourceReference.trim(),
    metadata: { ...metadata },
  };
}

function parseLocalDate(value: string): number {
  if (!LOCAL_DATE_PATTERN.test(value)) throw new Error('Life Hero local dates must use YYYY-MM-DD.');
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error('Life Hero local date is invalid.');
  }
  return parsed;
}
