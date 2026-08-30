import { describe, expect, it } from 'vitest';
import {
  deriveLifeHeroDashboardView,
  LIFE_HERO_AVATAR_CONTRACT,
  lifeHeroLevelBounds,
  selectLifeHeroMotivation,
  selectLifeHeroAsset,
} from '../services/lifeHeroPresentation';
import type { LifeHeroSnapshot, LifeHeroStat, LifeHeroStatProgress } from '../types/domain';

const STAT_ORDER: LifeHeroStat[] = [
  'faith',
  'vitality',
  'knowledge',
  'discipline',
  'finances',
  'craft',
  'community',
];

function stat(
  name: LifeHeroStat,
  condition: LifeHeroStatProgress['condition'] = 'steady',
): LifeHeroStatProgress {
  return {
    stat: name,
    totalXp: 100,
    level: 2,
    lastEvidenceLocalDate: condition === 'awaiting_first_step' ? null : '2026-08-29',
    condition,
    attentionAfterDays: 2,
  };
}

function snapshot(overrides: Partial<LifeHeroSnapshot> = {}): LifeHeroSnapshot {
  return {
    rulesetVersion: 'life-hero-v1',
    totalXp: 700,
    overallLevel: 3,
    updatedAt: '2026-08-30T07:00:00.000Z',
    recomputedAt: '2026-08-30T07:00:00.000Z',
    stats: STAT_ORDER.map(name => stat(name)),
    recentActivity: [{
      evidence: {
        id: 'evidence-1',
        rulesetVersion: 'life-hero-v1',
        stat: 'knowledge',
        evidenceType: 'knowledge_learning',
        sourceTier: 'verified',
        sourceReference: 'course-1',
        idempotencyKey: 'course-1:lesson-1',
        occurredAt: '2026-08-30T07:00:00.000Z',
        localDate: '2026-08-30',
        metadata: {},
        createdAt: '2026-08-30T07:00:00.000Z',
      },
      award: {
        id: 'award-1',
        evidenceId: 'evidence-1',
        rulesetVersion: 'life-hero-v1',
        stat: 'knowledge',
        baseXp: 20,
        sourceMultiplier: 1,
        momentumDays: 7,
        momentumMultiplier: 1.25,
        awardedXp: 25,
        awardedAt: '2026-08-30T07:00:00.000Z',
      },
    }],
    ...overrides,
  };
}

describe('Life Hero dashboard presentation', () => {
  it('keeps the canonical seven-stat order and derives current momentum from steady paths', () => {
    const view = deriveLifeHeroDashboardView(snapshot());
    expect(view.stats.map(item => item.stat)).toEqual(STAT_ORDER);
    expect(view.momentumDays).toBe(7);
    expect(view.momentumMultiplier).toBe(1.25);
    expect(view.renewalDueCount).toBe(0);
  });

  it('uses motivational renewal conditions without reducing earned XP or levels', () => {
    const before = snapshot({
      stats: STAT_ORDER.map(name => stat(name, name === 'faith' ? 'renewal_due' : 'steady')),
    });
    const view = deriveLifeHeroDashboardView(before);
    expect(view.snapshot.totalXp).toBe(700);
    expect(view.snapshot.overallLevel).toBe(3);
    expect(view.renewalDueCount).toBe(1);
    expect(view.encouragement).toContain('progress is safe');
  });

  it('presents a complete first-step state for an empty permanent profile', () => {
    const view = deriveLifeHeroDashboardView(snapshot({
      totalXp: 0,
      overallLevel: 1,
      stats: STAT_ORDER.map(name => ({ ...stat(name, 'awaiting_first_step'), totalXp: 0, level: 1 })),
      recentActivity: [],
    }));
    expect(view.empty).toBe(true);
    expect(view.awaitingFirstStepCount).toBe(7);
    expect(view.momentumDays).toBe(0);
    expect(view.levelProgress).toBe(0);
  });

  it('uses deterministic quadratic level bounds and capability-based LOD', () => {
    expect(lifeHeroLevelBounds(1)).toEqual({ current: 0, next: 100 });
    expect(lifeHeroLevelBounds(4)).toEqual({ current: 900, next: 1600 });
    expect(selectLifeHeroAsset({ deviceMemory: 4, hardwareConcurrency: 8 })).toBe('fallback');
    expect(selectLifeHeroAsset({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe('primary');
  });

  it('pins semantic animation and modular clothing names instead of array positions', () => {
    expect(LIFE_HERO_AVATAR_CONTRACT.nodes).toEqual({
      body: 'LifeHero_BaseBody',
      trainingJacket: 'LifeHero_Jacket',
    });
    expect(LIFE_HERO_AVATAR_CONTRACT.clips).toMatchObject({
      idle: 'Idle_02',
      celebrate: 'Motivational_Cheer',
      focus: 'Walking',
      train: 'Running',
    });
    expect(LIFE_HERO_AVATAR_CONTRACT.slots).toContain('torso');
  });

  it('selects supportive context-aware lines for first-step, renewal, momentum, and steady states', () => {
    const firstStep = selectLifeHeroMotivation(deriveLifeHeroDashboardView(snapshot({
      totalXp: 0,
      overallLevel: 1,
      stats: STAT_ORDER.map(name => ({ ...stat(name, 'awaiting_first_step'), totalXp: 0, level: 1 })),
      recentActivity: [],
    })));
    const renewal = selectLifeHeroMotivation(deriveLifeHeroDashboardView(snapshot({
      stats: STAT_ORDER.map(name => stat(name, name === 'faith' ? 'renewal_due' : 'steady')),
      recentActivity: [],
    })));
    const momentum = selectLifeHeroMotivation(deriveLifeHeroDashboardView(snapshot()));
    const steady = selectLifeHeroMotivation(deriveLifeHeroDashboardView(snapshot({ recentActivity: [] })));

    expect(firstStep.category).toBe('first_step');
    expect(renewal.category).toBe('renewal');
    expect(momentum.category).toBe('momentum');
    expect(steady.category).toBe('steady');
    for (const motivation of [firstStep, renewal, momentum, steady]) {
      expect(motivation.text).not.toMatch(/lazy|failure|disappoint|should have|weak|scold/iu);
    }
  });
});
