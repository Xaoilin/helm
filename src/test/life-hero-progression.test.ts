import { describe, expect, it } from 'vitest';
import type { LifeHeroAward, LifeHeroEvidenceInput } from '../types/domain';
import {
  deriveLifeHeroConditions,
  isLifeHeroEvidenceKind,
  LIFE_HERO_EVIDENCE_RULES,
  LIFE_HERO_STATS,
  lifeHeroLevelFromXp,
  lifeHeroMomentumMultiplier,
  recomputeLifeHeroProgression,
  validateLifeHeroEvidenceInput,
} from '../services/lifeHeroProgression';

const awards = [
  { stat: 'faith', awardedXp: 20 },
  { stat: 'knowledge', awardedXp: 30 },
  { stat: 'faith', awardedXp: 15 },
] as const satisfies readonly Pick<LifeHeroAward, 'stat' | 'awardedXp'>[];

describe('Life Hero progression', () => {
  it('defines exactly seven versioned real-life stats and no usage award', () => {
    expect(LIFE_HERO_STATS).toEqual([
      'faith',
      'vitality',
      'knowledge',
      'discipline',
      'finances',
      'craft',
      'community',
    ]);
    expect(Object.keys(LIFE_HERO_EVIDENCE_RULES)).toHaveLength(7);
    expect(isLifeHeroEvidenceKind('app_usage')).toBe(false);
    expect(isLifeHeroEvidenceKind('faith_practice')).toBe(true);
  });

  it('uses a monotonic level curve', () => {
    expect(lifeHeroLevelFromXp(0)).toBe(1);
    expect(lifeHeroLevelFromXp(99)).toBe(1);
    expect(lifeHeroLevelFromXp(100)).toBe(2);
    expect(lifeHeroLevelFromXp(400)).toBe(3);
    expect(lifeHeroLevelFromXp(10_000)).toBeGreaterThan(lifeHeroLevelFromXp(1_000));
  });

  it('applies bounded momentum only to future awards', () => {
    expect([1, 2, 3, 7, 14].map(lifeHeroMomentumMultiplier)).toEqual([1, 1, 1.1, 1.25, 1.5]);
  });

  it('recomputes permanent progress deterministically from immutable awards', () => {
    const first = recomputeLifeHeroProgression(awards);
    const reordered = recomputeLifeHeroProgression([...awards].reverse());
    const withAnotherAward = recomputeLifeHeroProgression([
      ...awards,
      { stat: 'community', awardedXp: 25 },
    ]);

    expect(first).toEqual(reordered);
    expect(first.totalXp).toBe(65);
    expect(first.stats.faith.totalXp).toBe(35);
    expect(first.stats.vitality.totalXp).toBe(0);
    expect(withAnotherAward.totalXp).toBeGreaterThan(first.totalXp);
    expect(withAnotherAward.overallLevel).toBeGreaterThanOrEqual(first.overallLevel);
  });

  it('computes temporary conditions without changing XP or levels', () => {
    const before = recomputeLifeHeroProgression(awards);
    const conditions = deriveLifeHeroConditions({
      faith: '2026-08-28',
      vitality: '2026-08-29',
    }, '2026-08-30');
    const after = recomputeLifeHeroProgression(awards);

    expect(conditions.find(condition => condition.stat === 'faith')?.state).toBe('renewal_due');
    expect(conditions.find(condition => condition.stat === 'vitality')?.state).toBe('steady');
    expect(conditions.find(condition => condition.stat === 'community')?.state).toBe('awaiting_first_step');
    expect(after).toEqual(before);
  });

  it('accepts only bounded scalar provenance and never accepts caller XP', () => {
    const input: LifeHeroEvidenceInput = {
      idempotencyKey: ' prayer:fajr:2026-08-30 ',
      evidenceType: 'faith_practice',
      sourceTier: 'verified',
      sourceReference: ' prayer:fajr:2026-08-30 ',
      occurredAt: '2026-08-30T04:30:00.000Z',
      localDate: '2026-08-30',
      metadata: { prayer: 'Fajr', onTime: true },
    };

    expect(validateLifeHeroEvidenceInput(input)).toMatchObject({
      idempotencyKey: 'prayer:fajr:2026-08-30',
      sourceReference: 'prayer:fajr:2026-08-30',
    });
    expect(() => validateLifeHeroEvidenceInput({
      ...input,
      evidenceType: 'app_usage',
    } as unknown as LifeHeroEvidenceInput)).toThrow('cannot award');
    expect(() => validateLifeHeroEvidenceInput({
      ...input,
      metadata: { accessToken: 'not-allowed' },
    })).toThrow('sensitive field');
    expect(() => validateLifeHeroEvidenceInput({
      ...input,
      metadata: { nested: { raw: true } },
    } as unknown as LifeHeroEvidenceInput)).toThrow('scalar values');
  });
});
