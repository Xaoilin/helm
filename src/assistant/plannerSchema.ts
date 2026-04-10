export const CAPABILITY_IDS = [
  'navigation.go_to_surface',
  'tasks.create_task',
  'tasks.reveal_task',
  'tasks.complete_matching',
  'calendar.create_event',
  'calendar.reschedule_event',
  'finance.record_transaction',
  'knowledge.create_entry',
] as const;

export type CapabilityId = typeof CAPABILITY_IDS[number];

export type ActionPlanMode = 'answer' | 'clarify' | 'confirm' | 'act';

export const ACTION_PLAN_ARG_KEYS = [
  'surface',
  'title',
  'priority',
  'category',
  'dueDate',
  'duePhrase',
  'taskQuery',
  'timePhrase',
  'start',
  'end',
  'calendarQuery',
  'eventQuery',
  'type',
  'amount',
  'description',
  'accountQuery',
  'topicQuery',
  'content',
  'date',
  'location',
] as const;

export type ActionPlanArgKey = typeof ACTION_PLAN_ARG_KEYS[number];

export type ActionPlanArgs = {
  [K in ActionPlanArgKey]: string | null;
};

export type ActionPlanStepArgs = Partial<Record<ActionPlanArgKey, string>>;

export interface ActionPlanStep {
  capability: CapabilityId;
  args: ActionPlanStepArgs;
  unresolved?: string[];
  requiresConfirmation?: boolean;
}

export interface ActionPlan {
  mode: ActionPlanMode;
  response: string;
  confidence: number;
  steps: ActionPlanStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActionPlanMode(value: unknown): value is ActionPlanMode {
  return value === 'answer' || value === 'clarify' || value === 'confirm' || value === 'act';
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && CAPABILITY_IDS.includes(value as CapabilityId);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeActionPlanArgs(value: unknown): ActionPlanStepArgs | null {
  if (!isPlainObject(value)) return null;

  const args: ActionPlanStepArgs = {};
  for (const key of ACTION_PLAN_ARG_KEYS) {
    const nextValue = value[key];
    if (nextValue === undefined || nextValue === null) continue;
    if (typeof nextValue !== 'string') return null;
    args[key] = nextValue;
  }

  return args;
}

export function parseActionPlan(value: unknown): ActionPlan | null {
  if (!isPlainObject(value)) return null;
  if (!isActionPlanMode(value.mode) || typeof value.response !== 'string') return null;

  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const steps = rawSteps
    .filter(isPlainObject)
    .map<ActionPlanStep | null>(step => {
      const args = normalizeActionPlanArgs(step.args);
      if (!isCapabilityId(step.capability) || !args) return null;
      return {
        capability: step.capability,
        args,
        unresolved: Array.isArray(step.unresolved)
          ? step.unresolved.filter((item): item is string => typeof item === 'string')
          : undefined,
        requiresConfirmation: typeof step.requiresConfirmation === 'boolean' ? step.requiresConfirmation : undefined,
      };
    })
    .filter((step): step is ActionPlanStep => step !== null);

  if (value.mode === 'act' && steps.length === 0) {
    return null;
  }

  return {
    mode: value.mode,
    response: value.response.trim(),
    confidence: clampConfidence(value.confidence),
    steps,
  };
}

function getRequiredKeys<T extends Record<string, unknown>>(properties: T): Array<Extract<keyof T, string>> {
  return Object.keys(properties) as Array<Extract<keyof T, string>>;
}

function buildStrictObjectSchema<T extends Record<string, unknown>>(properties: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: getRequiredKeys(properties),
    properties,
  } as const;
}

const nullableStringSchema = {
  type: ['string', 'null'],
} as const;

const nullableBooleanSchema = {
  type: ['boolean', 'null'],
} as const;

const nullableStringArraySchema = {
  type: ['array', 'null'],
  items: { type: 'string' },
} as const;

const actionPlanArgsProperties = ACTION_PLAN_ARG_KEYS.reduce<Record<ActionPlanArgKey, typeof nullableStringSchema>>(
  (properties, key) => {
    properties[key] = nullableStringSchema;
    return properties;
  },
  {} as Record<ActionPlanArgKey, typeof nullableStringSchema>,
);

export const actionPlanArgsJsonSchema = buildStrictObjectSchema(actionPlanArgsProperties);

export const actionPlanStepJsonSchema = buildStrictObjectSchema({
  capability: {
    type: 'string',
    enum: [...CAPABILITY_IDS],
  },
  args: actionPlanArgsJsonSchema,
  unresolved: nullableStringArraySchema,
  requiresConfirmation: nullableBooleanSchema,
});

export const actionPlanJsonSchema = buildStrictObjectSchema({
  mode: {
    type: 'string',
    enum: ['answer', 'clarify', 'confirm', 'act'],
  },
  response: {
    type: 'string',
  },
  confidence: {
    type: 'number',
    minimum: 0,
    maximum: 1,
  },
  steps: {
    type: 'array',
    items: actionPlanStepJsonSchema,
  },
});
