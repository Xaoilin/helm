import type {
  DailyActivityLevelTarget,
  DailyActivityLevelTargets,
  DailyActivityTargetStep,
  DailyActivityTemplate,
  DailyCircuitConfiguration,
  DailyMomentumProgressLog,
  DailyMomentumReminderPreference,
  DailyMomentumState,
  DailyPillar,
  PrayerName,
  ProgressMetric,
} from '../types/domain';
import { toLocalDateStr } from './financeHelpers';

export const DAILY_MOMENTUM_SCHEMA_VERSION = 1;

const PILLARS = new Set<DailyPillar>(['learn', 'move']);
const METRICS = new Set<ProgressMetric>(['pages', 'minutes', 'rounds']);
const PRAYER_NAMES = new Set(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
export const DAILY_MOMENTUM_REMINDER_ANCHORS: Record<DailyPillar, readonly PrayerName[]> = {
  learn: ['Dhuhr', 'Maghrib', 'Isha'],
  move: ['Asr', 'Maghrib', 'Isha'],
};
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertLocalDate(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Daily momentum dates must use local YYYY-MM-DD values.');
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) throw new Error('Daily momentum dates must use local YYYY-MM-DD values.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setHours(12, 0, 0, 0);
  candidate.setFullYear(year, month - 1, day);
  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) {
    throw new Error('Daily momentum dates must use valid local calendar dates.');
  }
}

function assertTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Daily momentum timestamps must be valid ISO date-time strings.');
  }
}

function normalizeStep(value: unknown, context: string): DailyActivityTargetStep {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  assertNonEmptyString(value.id, `${context} id`);
  assertNonEmptyString(value.label, `${context} label`);
  if (typeof value.metric !== 'string' || !METRICS.has(value.metric as ProgressMetric)) {
    throw new Error(`${context} has an unsupported progress metric.`);
  }
  if (!Number.isInteger(value.amount) || (value.amount as number) <= 0) {
    throw new Error(`${context} amount must be a positive integer.`);
  }
  return {
    ...value,
    id: value.id,
    label: value.label,
    metric: value.metric as ProgressMetric,
    amount: value.amount as number,
  };
}

function normalizeLevel(value: unknown, index: number, templateLabel: string): DailyActivityLevelTarget {
  const context = `${templateLabel} Level ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  if (value.level !== index + 1) throw new Error(`${context} has an invalid level number.`);
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw new Error(`${context} must contain at least one target step.`);
  }
  const steps = value.steps.map((step, stepIndex) => normalizeStep(step, `${context} step ${stepIndex + 1}`));
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`${context} repeats target step ${step.id}.`);
    ids.add(step.id);
  }
  return { ...value, level: (index + 1) as DailyActivityLevelTarget['level'], steps };
}

export function normalizeDailyActivityTemplate(value: unknown): DailyActivityTemplate {
  if (!isRecord(value)) throw new Error('Daily activity templates must be objects.');
  assertNonEmptyString(value.id, 'Daily activity template id');
  assertNonEmptyString(value.label, 'Daily activity template label');
  const label = value.label;
  if (typeof value.pillar !== 'string' || !PILLARS.has(value.pillar as DailyPillar)) {
    throw new Error(`${value.label} has an unsupported daily pillar.`);
  }
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    throw new Error(`${value.label} must have a positive integer version.`);
  }
  if (!Array.isArray(value.levels) || value.levels.length !== 5) {
    throw new Error(`${value.label} must define exactly five cumulative levels.`);
  }
  const levels = value.levels.map((level, index) => normalizeLevel(level, index, label));
  for (let index = 1; index < levels.length; index += 1) {
    const previous = new Map(levels[index - 1].steps.map(step => [step.id, step]));
    const current = new Map(levels[index].steps.map(step => [step.id, step]));
    for (const [stepId, priorTarget] of previous) {
      const nextTarget = current.get(stepId);
      if (!nextTarget || nextTarget.metric !== priorTarget.metric || nextTarget.amount < priorTarget.amount) {
        throw new Error(`${value.label} Level ${index + 1} must retain every earlier cumulative target.`);
      }
    }
  }

  const rawCircuit = value.circuit;
  let circuit: DailyCircuitConfiguration | undefined;
  if (rawCircuit !== undefined) {
    if (!isRecord(rawCircuit) || !Array.isArray(rawCircuit.exercises) || rawCircuit.exercises.some(item => typeof item !== 'string')) {
      throw new Error(`${value.label} circuit exercises must be an editable string list.`);
    }
    circuit = { ...rawCircuit, exercises: [...rawCircuit.exercises] as string[] };
  }

  return {
    ...value,
    id: value.id,
    pillar: value.pillar as DailyPillar,
    label: value.label,
    version: value.version as number,
    levels: levels as DailyActivityLevelTargets,
    ...(circuit === undefined ? {} : { circuit }),
  };
}

function scalarLevels(
  step: Omit<DailyActivityTargetStep, 'amount'>,
  amounts: readonly [number, number, number, number, number],
): DailyActivityLevelTargets {
  return amounts.map((amount, index) => ({
    level: (index + 1) as DailyActivityLevelTarget['level'],
    steps: [{ ...step, amount }],
  })) as DailyActivityLevelTargets;
}

export function createDefaultDailyActivityTemplates(): DailyActivityTemplate[] {
  return [
    {
      id: 'learn-reading',
      pillar: 'learn',
      label: 'Reading',
      version: 1,
      levels: scalarLevels({ id: 'pages', label: 'Pages', metric: 'pages' }, [2, 5, 10, 20, 40]),
    },
    {
      id: 'learn-course',
      pillar: 'learn',
      label: 'Course',
      version: 1,
      levels: scalarLevels({ id: 'course-minutes', label: 'Course', metric: 'minutes' }, [5, 10, 20, 35, 50]),
    },
    {
      id: 'move-active-minutes',
      pillar: 'move',
      label: 'Active minutes',
      version: 1,
      levels: scalarLevels({ id: 'active-minutes', label: 'Active time', metric: 'minutes' }, [5, 10, 20, 35, 50]),
    },
    {
      id: 'move-mobility',
      pillar: 'move',
      label: 'Mobility',
      version: 1,
      levels: scalarLevels({ id: 'mobility-minutes', label: 'Mobility', metric: 'minutes' }, [5, 10, 15, 20, 30]),
    },
    {
      id: 'move-tiny-circuit',
      pillar: 'move',
      label: 'Tiny circuit',
      version: 1,
      circuit: { exercises: [] },
      levels: [
        { level: 1, steps: [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 1 }] },
        { level: 2, steps: [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 2 }] },
        { level: 3, steps: [{ id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 }] },
        {
          level: 4,
          steps: [
            { id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 },
            { id: 'walk-minutes', label: 'Walk', metric: 'minutes', amount: 10 },
          ],
        },
        {
          level: 5,
          steps: [
            { id: 'circuit-rounds', label: 'Circuit rounds', metric: 'rounds', amount: 3 },
            { id: 'walk-minutes', label: 'Walk', metric: 'minutes', amount: 20 },
          ],
        },
      ],
    },
  ];
}

export function createDefaultDailyMomentumState(): DailyMomentumState {
  return {
    schemaVersion: DAILY_MOMENTUM_SCHEMA_VERSION,
    templates: createDefaultDailyActivityTemplates(),
    logs: {},
    reminderPreferences: {
      learn: { enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'] },
      move: { enabled: true, afterPrayers: ['Asr', 'Maghrib', 'Isha'] },
    },
  };
}

function normalizeReminderPreference(
  value: unknown,
  fallback: DailyMomentumReminderPreference,
  pillar: DailyPillar,
): DailyMomentumReminderPreference {
  if (value === undefined) return { ...fallback };
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    throw new Error('Daily momentum reminder preferences must include an enabled flag.');
  }
  const rawAfterPrayers = value.afterPrayers ?? fallback.afterPrayers;
  if (
    !Array.isArray(rawAfterPrayers)
    || rawAfterPrayers.some(prayer => typeof prayer !== 'string' || !PRAYER_NAMES.has(prayer))
  ) {
    throw new Error('Daily momentum reminder anchors must use canonical prayer names.');
  }
  const allowedAnchors = new Set<PrayerName>(DAILY_MOMENTUM_REMINDER_ANCHORS[pillar]);
  const afterPrayers = [...new Set(rawAfterPrayers)]
    .filter((prayer): prayer is PrayerName => allowedAnchors.has(prayer as PrayerName));
  const localTime = value.localTime ?? fallback.localTime;
  if (localTime !== undefined && localTime !== null && (typeof localTime !== 'string' || !LOCAL_TIME_PATTERN.test(localTime))) {
    throw new Error('Daily momentum reminder times must use local HH:MM values.');
  }
  return {
    ...value,
    enabled: value.enabled,
    afterPrayers,
    ...(localTime === undefined ? {} : { localTime }),
  };
}

function normalizeProgressLog(value: unknown, key: string): DailyMomentumProgressLog {
  if (!isRecord(value)) throw new Error(`Daily momentum log ${key} must be an object.`);
  assertLocalDate(value.date);
  if (typeof value.pillar !== 'string' || !PILLARS.has(value.pillar as DailyPillar)) {
    throw new Error(`Daily momentum log ${key} has an unsupported pillar.`);
  }
  if (key !== getDailyMomentumLogKey(value.date, value.pillar as DailyPillar)) {
    throw new Error(`Daily momentum log ${key} does not match its date and pillar.`);
  }
  const template = normalizeDailyActivityTemplate(value.template);
  if (template.pillar !== value.pillar) throw new Error(`Daily momentum log ${key} has a mismatched template.`);
  if (!isRecord(value.progress)) throw new Error(`Daily momentum log ${key} must contain progress values.`);
  const progress: Record<string, number> = {};
  for (const [stepId, amount] of Object.entries(value.progress)) {
    assertNonEmptyString(stepId, `Daily momentum log ${key} progress key`);
    if (!Number.isFinite(amount) || (amount as number) < 0) {
      throw new Error(`Daily momentum log ${key} progress must be non-negative.`);
    }
    progress[stepId] = amount as number;
  }
  assertTimestamp(value.updatedAt);
  return {
    ...value,
    date: value.date,
    pillar: value.pillar as DailyPillar,
    template,
    progress,
    updatedAt: value.updatedAt,
  };
}

export function normalizeDailyMomentumState(value: unknown): DailyMomentumState {
  if (value == null) return createDefaultDailyMomentumState();
  if (!isRecord(value)) throw new Error('Daily momentum account data must be an object.');
  const schemaVersion = value.schemaVersion ?? DAILY_MOMENTUM_SCHEMA_VERSION;
  if (schemaVersion !== DAILY_MOMENTUM_SCHEMA_VERSION) {
    throw new Error(`Daily momentum schemaVersion ${String(schemaVersion)} is not supported by this client.`);
  }
  const templateValues = value.templates ?? createDefaultDailyActivityTemplates();
  if (!Array.isArray(templateValues)) throw new Error('Daily momentum templates must be an array.');
  const templates = templateValues.map(normalizeDailyActivityTemplate);
  const templateIds = new Set<string>();
  for (const template of templates) {
    if (templateIds.has(template.id)) throw new Error(`Daily momentum template id ${template.id} is duplicated.`);
    templateIds.add(template.id);
  }
  const logValues = value.logs ?? {};
  if (!isRecord(logValues)) throw new Error('Daily momentum logs must be an object.');
  const logs = Object.fromEntries(
    Object.entries(logValues).map(([key, log]) => [key, normalizeProgressLog(log, key)]),
  );
  const fallbackReminders = createDefaultDailyMomentumState().reminderPreferences;
  const reminderValues = value.reminderPreferences;
  if (reminderValues !== undefined && !isRecord(reminderValues)) {
    throw new Error('Daily momentum reminder preferences must be an object.');
  }
  return {
    ...value,
    schemaVersion: schemaVersion as number,
    templates,
    logs,
    reminderPreferences: {
      ...(reminderValues ?? {}),
      learn: normalizeReminderPreference(reminderValues?.learn, fallbackReminders.learn, 'learn'),
      move: normalizeReminderPreference(reminderValues?.move, fallbackReminders.move, 'move'),
    },
  };
}

export function getDailyMomentumPillarState(
  state: DailyMomentumState,
  pillar: DailyPillar,
): DailyMomentumState {
  const normalized = normalizeDailyMomentumState(state);
  const logs = Object.fromEntries(
    Object.entries(normalized.logs).filter(([, log]) => log.pillar === pillar),
  );
  const defaults = createDefaultDailyMomentumState().reminderPreferences;
  return {
    ...normalized,
    templates: normalized.templates.filter(template => template.pillar === pillar),
    logs,
    reminderPreferences: {
      learn: pillar === 'learn' ? normalized.reminderPreferences.learn : defaults.learn,
      move: pillar === 'move' ? normalized.reminderPreferences.move : defaults.move,
    },
  };
}

export function combineDailyMomentumPillarStates(
  learnValue: unknown,
  moveValue: unknown,
): DailyMomentumState {
  const learn = getDailyMomentumPillarState(normalizeDailyMomentumState(learnValue), 'learn');
  const move = getDailyMomentumPillarState(normalizeDailyMomentumState(moveValue), 'move');
  return {
    ...learn,
    ...move,
    schemaVersion: DAILY_MOMENTUM_SCHEMA_VERSION,
    templates: [...learn.templates, ...move.templates],
    logs: { ...learn.logs, ...move.logs },
    reminderPreferences: {
      learn: learn.reminderPreferences.learn,
      move: move.reminderPreferences.move,
    },
  };
}

export function getDailyMomentumLogKey(date: string, pillar: DailyPillar): string {
  assertLocalDate(date);
  return `${date}:${pillar}`;
}

export function getDailyMomentumLocalDate(referenceDate = new Date()): string {
  return toLocalDateStr(referenceDate);
}

export function getAchievedDailyMomentumLevel(
  template: DailyActivityTemplate,
  progress: Record<string, number>,
): 0 | 1 | 2 | 3 | 4 | 5 {
  const normalized = normalizeDailyActivityTemplate(template);
  let achieved: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  for (const target of normalized.levels) {
    if (target.steps.every(step => (progress[step.id] ?? 0) >= step.amount)) {
      achieved = target.level;
    } else {
      break;
    }
  }
  return achieved;
}

export interface DailyMomentumPillarDay {
  pillar: DailyPillar;
  date: string;
  log: DailyMomentumProgressLog | null;
  selectedTemplate: DailyActivityTemplate | null;
  achievedLevel: 0 | 1 | 2 | 3 | 4 | 5;
  complete: boolean;
  pathLocked: boolean;
}

export function getDailyMomentumPillarDay(
  state: DailyMomentumState,
  date: string,
  pillar: DailyPillar,
): DailyMomentumPillarDay {
  const normalized = normalizeDailyMomentumState(state);
  const log = normalized.logs[getDailyMomentumLogKey(date, pillar)] ?? null;
  const achievedLevel = log ? getAchievedDailyMomentumLevel(log.template, log.progress) : 0;
  return {
    pillar,
    date,
    log,
    selectedTemplate: log?.template ?? null,
    achievedLevel,
    complete: achievedLevel >= 1,
    pathLocked: Boolean(log && Object.values(log.progress).some(amount => amount > 0)),
  };
}

export function getDailyMomentumDay(state: DailyMomentumState, date: string) {
  return {
    date,
    learn: getDailyMomentumPillarDay(state, date, 'learn'),
    move: getDailyMomentumPillarDay(state, date, 'move'),
  };
}

function findTemplate(state: DailyMomentumState, pillar: DailyPillar, templateId: string): DailyActivityTemplate {
  const template = state.templates.find(candidate => candidate.id === templateId && candidate.pillar === pillar);
  if (!template) throw new Error(`Daily ${pillar} template ${templateId} was not found.`);
  return template;
}

function hasPositiveProgress(log: DailyMomentumProgressLog): boolean {
  return Object.values(log.progress).some(amount => amount > 0);
}

export function selectDailyMomentumPath(
  state: DailyMomentumState,
  input: { date: string; pillar: DailyPillar; templateId: string; updatedAt?: string },
): DailyMomentumState {
  const normalized = normalizeDailyMomentumState(state);
  const key = getDailyMomentumLogKey(input.date, input.pillar);
  const existing = normalized.logs[key];
  if (existing && existing.template.id !== input.templateId && hasPositiveProgress(existing)) {
    throw new Error(`Today's ${input.pillar} path is locked after positive progress.`);
  }
  const template = normalizeDailyActivityTemplate(findTemplate(normalized, input.pillar, input.templateId));
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  assertTimestamp(updatedAt);
  return {
    ...normalized,
    logs: {
      ...normalized.logs,
      [key]: {
        ...(existing ?? {}),
        date: input.date,
        pillar: input.pillar,
        template,
        progress: existing?.template.id === template.id ? { ...existing.progress } : {},
        updatedAt,
      },
    },
  };
}

export function recordDailyMomentumProgress(
  state: DailyMomentumState,
  input: {
    date: string;
    pillar: DailyPillar;
    templateId: string;
    stepId: string;
    amount: number;
    updatedAt?: string;
  },
): DailyMomentumState {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Daily momentum progress increments must be positive.');
  }
  let next = selectDailyMomentumPath(state, input);
  const key = getDailyMomentumLogKey(input.date, input.pillar);
  const log = next.logs[key];
  const stepTargets = log.template.levels.flatMap(level => level.steps).filter(step => step.id === input.stepId);
  if (stepTargets.length === 0) throw new Error(`${log.template.label} does not use progress step ${input.stepId}.`);
  const cap = Math.max(...stepTargets.map(step => step.amount));
  next = {
    ...next,
    logs: {
      ...next.logs,
      [key]: {
        ...log,
        progress: {
          ...log.progress,
          [input.stepId]: Math.min(cap, (log.progress[input.stepId] ?? 0) + input.amount),
        },
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      },
    },
  };
  return next;
}

export function resetDailyMomentumPillar(
  state: DailyMomentumState,
  input: { date: string; pillar: DailyPillar; confirmed: boolean },
): DailyMomentumState {
  if (input.confirmed !== true) throw new Error('Daily momentum reset requires confirmation.');
  const normalized = normalizeDailyMomentumState(state);
  const logs = { ...normalized.logs };
  delete logs[getDailyMomentumLogKey(input.date, input.pillar)];
  return { ...normalized, logs };
}

export function upsertDailyActivityTemplate(
  state: DailyMomentumState,
  value: DailyActivityTemplate,
): DailyMomentumState {
  const normalized = normalizeDailyMomentumState(state);
  const template = normalizeDailyActivityTemplate(value);
  const existing = normalized.templates.find(candidate => candidate.id === template.id);
  if (existing && existing.pillar !== template.pillar) {
    throw new Error('A daily activity template cannot move between pillars.');
  }
  if (existing && template.version <= existing.version) {
    throw new Error('An edited daily activity template must increase its version.');
  }
  return {
    ...normalized,
    templates: existing
      ? normalized.templates.map(candidate => candidate.id === template.id ? template : candidate)
      : [...normalized.templates, template],
  };
}

export function setDailyMomentumReminderPreference(
  state: DailyMomentumState,
  pillar: DailyPillar,
  value: DailyMomentumReminderPreference,
): DailyMomentumState {
  const normalized = normalizeDailyMomentumState(state);
  return {
    ...normalized,
    reminderPreferences: {
      ...normalized.reminderPreferences,
      [pillar]: normalizeReminderPreference(value, normalized.reminderPreferences[pillar], pillar),
    },
  };
}
