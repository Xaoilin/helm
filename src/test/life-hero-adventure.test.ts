import { describe, expect, it } from 'vitest';
import type { LifeHeroSnapshot, LifeHeroStat } from '../types/domain';
import {
  createLifeHeroAdventure,
  deriveLifeHeroAdventureProfile,
  parseLifeHeroAdventureState,
  startLifeHeroAdventure,
  takeLifeHeroAdventureTurn,
} from '../services/lifeHeroAdventure';

const STATS: LifeHeroStat[] = [
  'faith', 'vitality', 'knowledge', 'discipline', 'finances', 'craft', 'community',
];

function snapshot(overrides: Partial<LifeHeroSnapshot> = {}): LifeHeroSnapshot {
  return {
    rulesetVersion: 'life-hero-v1',
    totalXp: 900,
    overallLevel: 4,
    updatedAt: '2026-08-30T07:00:00.000Z',
    recomputedAt: '2026-08-30T07:00:00.000Z',
    stats: STATS.map(stat => ({
      stat,
      totalXp: 100,
      level: 2,
      lastEvidenceLocalDate: '2026-08-30',
      condition: 'steady',
      attentionAfterDays: 2,
    })),
    recentActivity: [],
    ...overrides,
  };
}

describe('Life Hero daily adventure', () => {
  it('derives deterministic capability from permanent stats and momentum only', () => {
    const first = deriveLifeHeroAdventureProfile(snapshot(), '2026-08-30');
    const second = deriveLifeHeroAdventureProfile(snapshot(), '2026-08-30');

    expect(first).toEqual(second);
    expect(first.heroPower).toBeGreaterThan(0);
    expect(first.momentumDays).toBe(0);
    expect(first.abilities.map(ability => ability.action)).toEqual(['strike', 'guard', 'focus']);
  });

  it('resolves the same encounter deterministically and completes without progression reward', () => {
    const hero = snapshot();
    const initial = startLifeHeroAdventure(createLifeHeroAdventure(hero, '2026-08-30'));
    let state = initial;
    const messages: string[] = [];

    while (state.status === 'in_progress') {
      const result = takeLifeHeroAdventureTurn(state, hero, 'strike');
      state = result.state;
      messages.push(result.message);
    }

    expect(state.status).toBe('complete');
    expect(state.round).toBeLessThanOrEqual(4);
    expect(state.log.at(-1)).toContain('permanent stats are unchanged');
    expect(messages.at(-1)).toBe('Daily adventure complete.');
    expect(hero.totalXp).toBe(900);
    expect(hero.overallLevel).toBe(4);
  });

  it('supports safe recovery after defeat without changing the permanent read model', () => {
    const hero = snapshot({ overallLevel: 1, totalXp: 0 });
    const ready = createLifeHeroAdventure(hero, '2026-08-30');
    let state = {
      ...startLifeHeroAdventure(ready),
      heroHp: 1,
      foeHp: 6,
    };
    state = takeLifeHeroAdventureTurn(state, hero, 'focus').state;

    expect(state.status).toBe('defeated');
    expect(state.log.at(-1)).toContain('No progress is lost');
    expect(hero.totalXp).toBe(0);
    expect(hero.overallLevel).toBe(1);
  });

  it('accepts a same-day checkpoint and rejects malformed or stale checkpoints', () => {
    const state = startLifeHeroAdventure(createLifeHeroAdventure(snapshot(), '2026-08-30'));

    expect(parseLifeHeroAdventureState(state, '2026-08-30')).toEqual(state);
    expect(parseLifeHeroAdventureState(state, '2026-08-31')).toBeNull();
    expect(parseLifeHeroAdventureState({ ...state, round: -1 }, '2026-08-30')).toBeNull();
    expect(parseLifeHeroAdventureState({ ...state, log: ['safe', 3] }, '2026-08-30')).toBeNull();
  });
});
