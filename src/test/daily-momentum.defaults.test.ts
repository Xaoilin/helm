import { describe, expect, it } from 'vitest';
import {
  createDefaultDailyActivityTemplates,
  normalizeDailyMomentumState,
} from '../services/dailyMomentum';
import type {
  DailyActivityLevelTargets,
  DailyActivityTemplate,
  ProgressMetric,
} from '../types/domain';

const SNAPSHOT_TIME = '2026-08-29T12:00:00.000Z';

function scalarTemplate(
  id: string,
  label: string,
  stepId: string,
  stepLabel: string,
  metric: ProgressMetric,
  amounts: readonly [number, number, number, number, number],
): DailyActivityTemplate {
  return {
    id,
    pillar: id.startsWith('learn-') ? 'learn' : 'move',
    label,
    version: 1,
    levels: amounts.map((amount, index) => ({
      level: (index + 1) as 1 | 2 | 3 | 4 | 5,
      steps: [{ id: stepId, label: stepLabel, metric, amount }],
    })) as DailyActivityLevelTargets,
  };
}

const legacyMoveTemplates: DailyActivityTemplate[] = [
  scalarTemplate('move-active-minutes', 'Active minutes', 'active-minutes', 'Active time', 'minutes', [5, 10, 20, 35, 50]),
  scalarTemplate('move-mobility', 'Mobility', 'mobility-minutes', 'Mobility', 'minutes', [5, 10, 15, 20, 30]),
  {
    id: 'move-tiny-circuit',
    pillar: 'move',
    label: 'Tiny circuit',
    version: 1,
    circuit: { exercises: [] },
    levels: [1, 2, 3, 4, 5].map((level) => ({
      level: level as 1 | 2 | 3 | 4 | 5,
      steps: [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds' as const, amount: level }],
    })) as DailyActivityLevelTargets,
  },
];

describe('daily momentum defaults and schema compatibility', () => {
  it('defines Learn unchanged and exactly the three minute-based Move defaults', () => {
    const templates = createDefaultDailyActivityTemplates();
    const learn = templates.filter(template => template.pillar === 'learn');
    const move = templates.filter(template => template.pillar === 'move');

    expect(learn.map(template => template.id)).toEqual(['learn-reading', 'learn-course']);
    expect(move.map(template => template.id)).toEqual([
      'move-walk',
      'move-workout',
      'move-stretching',
    ]);
    expect(move.map(template => template.label)).toEqual(['Walk', 'Workout', 'Stretching']);
    expect(move.map(template => template.levels.map(level => level.steps[0]?.amount))).toEqual([
      [5, 10, 20, 35, 50],
      [5, 10, 20, 35, 50],
      [5, 10, 15, 20, 30],
    ]);
    expect(move.flatMap(template => template.levels.flatMap(level => level.steps.map(step => step.metric))))
      .toEqual(Array(15).fill('minutes'));
    expect(templates.map(template => template.id)).not.toEqual(expect.arrayContaining([
      'move-active-minutes',
      'move-mobility',
      'move-tiny-circuit',
    ]));
  });

  it('migrates schema 1 built-in Move templates while preserving user data and history', () => {
    const learn = scalarTemplate('learn-reading', 'Reading', 'pages', 'Pages', 'pages', [2, 5, 10, 20, 40]);
    const custom = {
      ...scalarTemplate('move-cycling', 'Cycling', 'cycling-minutes', 'Cycling', 'minutes', [5, 10, 20, 30, 45]),
      customGuidance: 'Keep this custom activity',
    };
    const legacyState = {
      schemaVersion: 1,
      templates: [learn, ...legacyMoveTemplates, custom],
      logs: {
        '2026-08-29:learn': {
          date: '2026-08-29',
          pillar: 'learn',
          template: learn,
          progress: { pages: 5 },
          updatedAt: SNAPSHOT_TIME,
        },
        '2026-08-29:move:move-tiny-circuit': {
          date: '2026-08-29',
          pillar: 'move',
          template: legacyMoveTemplates[2],
          progress: { 'circuit-rounds': 1 },
          updatedAt: SNAPSHOT_TIME,
          historicalNote: 'Retain this log',
        },
      },
      reminderPreferences: {
        learn: { enabled: false, afterPrayers: ['Maghrib'] },
        move: { enabled: true, afterPrayers: ['Asr'], localTime: '18:30' },
      },
      futureField: { preserve: true },
    };

    const migrated = normalizeDailyMomentumState(legacyState);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.templates.map(template => template.id)).toEqual([
      'learn-reading',
      'move-walk',
      'move-workout',
      'move-stretching',
      'move-cycling',
    ]);
    expect(migrated.templates.find(template => template.id === 'learn-reading')).toEqual(learn);
    expect(migrated.templates.find(template => template.id === 'move-cycling')).toEqual(custom);
    expect(migrated.reminderPreferences).toEqual(legacyState.reminderPreferences);
    expect(migrated.logs).toEqual(legacyState.logs);
    expect(migrated).toHaveProperty('futureField', { preserve: true });
    expect(migrated.templates.map(template => template.id)).not.toEqual(expect.arrayContaining([
      'move-active-minutes',
      'move-mobility',
      'move-tiny-circuit',
    ]));
  });

  it('leaves schema 2 templates authoritative without applying the legacy migration', () => {
    const state = normalizeDailyMomentumState({
      schemaVersion: 2,
      templates: legacyMoveTemplates,
      logs: {},
    });

    expect(state.schemaVersion).toBe(2);
    expect(state.templates.map(template => template.id)).toEqual([
      'move-active-minutes',
      'move-mobility',
      'move-tiny-circuit',
    ]);
  });

  it('rejects schema versions outside the supported overlap', () => {
    for (const schemaVersion of [0, 3, 99, '1']) {
      expect(() => normalizeDailyMomentumState({ schemaVersion })).toThrow(
        `Daily momentum schemaVersion ${String(schemaVersion)} is not supported by this client.`,
      );
    }
  });
});
