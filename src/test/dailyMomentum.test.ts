import { describe, expect, it } from 'vitest';
import type { DailyActivityTemplate } from '../types/domain';
import {
  createDefaultDailyMomentumState,
  combineDailyMomentumPillarStates,
  getAchievedDailyMomentumLevel,
  getDailyMomentumDay,
  getDailyMomentumLocalDate,
  getDailyMomentumPillarState,
  normalizeDailyMomentumState,
  recordDailyMomentumProgress,
  resetDailyMomentumPillar,
  selectDailyMomentumPath,
  upsertDailyActivityTemplate,
} from '../services/dailyMomentum';

describe('daily Learn and Move momentum', () => {
  it('provides the approved five-level default ladders', () => {
    const templates = createDefaultDailyMomentumState().templates;
    const targets = (id: string, stepId: string) => templates
      .find(template => template.id === id)!
      .levels.map(level => level.steps.find(step => step.id === stepId)?.amount);

    expect(targets('learn-reading', 'pages')).toEqual([2, 5, 10, 20, 40]);
    expect(targets('learn-course', 'course-minutes')).toEqual([5, 10, 20, 35, 50]);
    expect(targets('move-active-minutes', 'active-minutes')).toEqual([5, 10, 20, 35, 50]);
    expect(targets('move-mobility', 'mobility-minutes')).toEqual([5, 10, 15, 20, 30]);
  });

  it('models Tiny circuit Levels 4 and 5 as composite cumulative targets', () => {
    const template = createDefaultDailyMomentumState().templates
      .find(candidate => candidate.id === 'move-tiny-circuit')!;

    expect(template.label).toBe('Tiny circuit');
    expect(template.circuit).toEqual({ exercises: [] });
    expect(template.levels.map(level => level.steps)).toEqual([
      [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 1 }],
      [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 2 }],
      [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 }],
      [
        { id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 },
        { id: 'walk-minutes', label: 'Walk', metric: 'minutes', amount: 10 },
      ],
      [
        { id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 },
        { id: 'walk-minutes', label: 'Walk', metric: 'minutes', amount: 20 },
      ],
    ]);
  });

  it('marks Level 1 complete, keeps higher levels optional, and caps progress at Level 5', () => {
    let state = createDefaultDailyMomentumState();
    state = recordDailyMomentumProgress(state, {
      date: '2026-08-28',
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 2,
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    expect(getDailyMomentumDay(state, '2026-08-28').learn).toMatchObject({
      achievedLevel: 1,
      complete: true,
      pathLocked: true,
    });

    state = recordDailyMomentumProgress(state, {
      date: '2026-08-28',
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 100,
      updatedAt: '2026-08-28T09:00:00.000Z',
    });
    const log = getDailyMomentumDay(state, '2026-08-28').learn.log!;
    expect(log.progress.pages).toBe(40);
    expect(getAchievedDailyMomentumLevel(log.template, log.progress)).toBe(5);
  });

  it('allows a zero-progress path change and locks the path after positive progress', () => {
    let state = selectDailyMomentumPath(createDefaultDailyMomentumState(), {
      date: '2026-08-28', pillar: 'learn', templateId: 'learn-course', updatedAt: '2026-08-28T08:00:00.000Z',
    });
    state = selectDailyMomentumPath(state, {
      date: '2026-08-28', pillar: 'learn', templateId: 'learn-reading', updatedAt: '2026-08-28T08:01:00.000Z',
    });
    state = recordDailyMomentumProgress(state, {
      date: '2026-08-28', pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 1,
      updatedAt: '2026-08-28T08:02:00.000Z',
    });

    expect(() => selectDailyMomentumPath(state, {
      date: '2026-08-28', pillar: 'learn', templateId: 'learn-course', updatedAt: '2026-08-28T08:03:00.000Z',
    })).toThrow(/locked/i);
  });

  it('requires confirmation and resets only the requested pillar and local date', () => {
    let state = createDefaultDailyMomentumState();
    state = recordDailyMomentumProgress(state, {
      date: '2026-08-28', pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 2,
    });
    state = recordDailyMomentumProgress(state, {
      date: '2026-08-28', pillar: 'move', templateId: 'move-mobility', stepId: 'mobility-minutes', amount: 5,
    });
    state = recordDailyMomentumProgress(state, {
      date: '2026-08-29', pillar: 'learn', templateId: 'learn-course', stepId: 'course-minutes', amount: 5,
    });

    expect(() => resetDailyMomentumPillar(state, {
      date: '2026-08-28', pillar: 'learn', confirmed: false,
    })).toThrow(/confirmation/i);

    const reset = resetDailyMomentumPillar(state, {
      date: '2026-08-28', pillar: 'learn', confirmed: true,
    });
    expect(getDailyMomentumDay(reset, '2026-08-28').learn.log).toBeNull();
    expect(getDailyMomentumDay(reset, '2026-08-28').move.achievedLevel).toBe(1);
    expect(getDailyMomentumDay(reset, '2026-08-29').learn.achievedLevel).toBe(1);
  });

  it('uses local calendar fields for rollover instead of slicing UTC ISO text', () => {
    const localAfterMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 15,
      toISOString: () => '2026-07-14T23:30:00.000Z',
    } as unknown as Date;

    expect(getDailyMomentumLocalDate(localAfterMidnight)).toBe('2026-07-15');
  });

  it('rejects malformed templates while preserving unknown additive fields', () => {
    const base = createDefaultDailyMomentumState();
    const withUnknowns = {
      ...base,
      olderRecordMarker: { retained: true },
      templates: base.templates.map((template, index) => index === 0 ? {
        ...template,
        unknownTemplateField: 'retained',
        levels: template.levels.map((level, levelIndex) => levelIndex === 0 ? {
          ...level,
          unknownLevelField: 7,
          steps: level.steps.map(step => ({ ...step, unknownStepField: true })),
        } : level),
      } : template),
    };
    const normalized = normalizeDailyMomentumState(withUnknowns);

    expect(normalized.olderRecordMarker).toEqual({ retained: true });
    expect(normalized.templates[0].unknownTemplateField).toBe('retained');
    expect(normalized.templates[0].levels[0].unknownLevelField).toBe(7);
    expect(normalized.templates[0].levels[0].steps[0].unknownStepField).toBe(true);

    expect(() => normalizeDailyMomentumState({
      ...base,
      templates: [{ ...base.templates[0], levels: base.templates[0].levels.slice(0, 4) }],
    })).toThrow(/exactly five/i);
    expect(() => normalizeDailyMomentumState({ ...base, schemaVersion: 2 }))
      .toThrow(/not supported/i);
  });

  it('keeps Learn and Move in independent additive profile fields', () => {
    const state = createDefaultDailyMomentumState();
    const learn = getDailyMomentumPillarState(state, 'learn');
    const move = getDailyMomentumPillarState(state, 'move');

    expect(learn.templates.every(template => template.pillar === 'learn')).toBe(true);
    expect(move.templates.every(template => template.pillar === 'move')).toBe(true);
    expect(combineDailyMomentumPillarStates(learn, move)).toEqual(state);
  });

  it('snapshots a selected template version so later edits do not rewrite past progress', () => {
    let state = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date: '2026-08-28', pillar: 'move', templateId: 'move-tiny-circuit', stepId: 'circuit-rounds', amount: 1,
    });
    const edited: DailyActivityTemplate = {
      ...state.templates.find(template => template.id === 'move-tiny-circuit')!,
      version: 2,
      circuit: { exercises: ['User-defined circuit'] },
    };
    state = upsertDailyActivityTemplate(state, edited);

    expect(state.templates.find(template => template.id === edited.id)?.version).toBe(2);
    expect(getDailyMomentumDay(state, '2026-08-28').move.log?.template).toMatchObject({
      version: 1,
      circuit: { exercises: [] },
    });
  });
});
