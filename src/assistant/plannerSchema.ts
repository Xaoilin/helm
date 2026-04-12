import {
  getCapabilityDefinition,
  getLiveCapabilityDefinitions,
  isKnownCapabilityId,
  type AssistantActionArgDefinition,
  type CapabilityId,
} from './capabilities';

export type ActionPlanMode = 'answer' | 'clarify' | 'confirm' | 'act';
export type ActionPlanArgValue = string | string[] | boolean;
export type ActionPlanStepArgs = Record<string, ActionPlanArgValue>;

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

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isValidArgValue(
  definition: AssistantActionArgDefinition,
  value: unknown,
): value is ActionPlanArgValue {
  if (definition.type === 'boolean') {
    return typeof value === 'boolean';
  }

  if (definition.type === 'string_array') {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
  }

  if (typeof value !== 'string') {
    return false;
  }

  if (definition.type === 'enum' && definition.values) {
    return definition.values.includes(value);
  }

  return true;
}

function normalizeActionPlanArgs(
  value: unknown,
  capabilityId: CapabilityId,
): ActionPlanStepArgs | null {
  if (!isPlainObject(value)) return null;

  const capability = getCapabilityDefinition(capabilityId);
  const argDefinitions = new Map(capability.args.map(arg => [arg.key, arg]));
  const args: ActionPlanStepArgs = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const definition = argDefinitions.get(key);
    if (!definition) return null;
    if (rawValue === null || rawValue === undefined) continue;
    if (!isValidArgValue(definition, rawValue)) return null;
    args[key] = rawValue;
  }

  for (const definition of capability.args) {
    if (definition.required && !(definition.key in args)) {
      return null;
    }
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
      if (typeof step.capability !== 'string' || !isKnownCapabilityId(step.capability)) return null;
      const args = normalizeActionPlanArgs(step.args, step.capability);
      if (!args) return null;
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

function buildStrictObjectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  } as const;
}

const nullableBooleanSchema = {
  type: ['boolean', 'null'],
} as const;

const nullableStringArraySchema = {
  type: ['array', 'null'],
  items: { type: 'string' },
} as const;

function buildSemanticArgSchema(definition: AssistantActionArgDefinition) {
  if (definition.type === 'boolean') {
    return {
      type: 'boolean',
    } as const;
  }

  if (definition.type === 'string_array') {
    return {
      type: 'array',
      items: {
        type: 'string',
      },
    } as const;
  }

  if (definition.type === 'enum' && definition.values) {
    return {
      type: 'string',
      enum: [...definition.values],
    } as const;
  }

  return {
    type: 'string',
  } as const;
}

function buildHostedArgSchema(definition: AssistantActionArgDefinition) {
  const schema = buildSemanticArgSchema(definition);
  if (definition.required) {
    return schema;
  }

  if (definition.type === 'boolean') {
    return nullableBooleanSchema;
  }

  if (definition.type === 'string_array') {
    return {
      type: ['array', 'null'],
      items: {
        type: 'string',
      },
    } as const;
  }

  if (definition.type === 'enum' && definition.values) {
    return {
      type: ['string', 'null'],
      enum: [...definition.values],
    } as const;
  }

  return {
    type: ['string', 'null'],
  } as const;
}

function buildActionArgsJsonSchema(capabilityId: CapabilityId) {
  const capability = getCapabilityDefinition(capabilityId);
  const properties = Object.fromEntries(
    capability.args.map(arg => [arg.key, buildHostedArgSchema(arg)]),
  );
  const required = capability.args.map(arg => arg.key);
  return buildStrictObjectSchema(properties, required);
}

function buildActionStepJsonSchema(capabilityId: CapabilityId) {
  return buildStrictObjectSchema({
    capability: {
      type: 'string',
      const: capabilityId,
    },
    args: buildActionArgsJsonSchema(capabilityId),
    unresolved: nullableStringArraySchema,
    requiresConfirmation: nullableBooleanSchema,
  });
}

function buildActionPlanStepSchema(capabilityIds: CapabilityId[]) {
  return {
    anyOf: capabilityIds.map(capabilityId => buildActionStepJsonSchema(capabilityId)),
  } as const;
}

export function buildActionPlanJsonSchema(capabilityIds?: CapabilityId[]) {
  const resolvedCapabilityIds = capabilityIds && capabilityIds.length > 0
    ? capabilityIds
    : getLiveCapabilityDefinitions().map(capability => capability.id as CapabilityId);
  const stepSchema = buildActionPlanStepSchema(resolvedCapabilityIds);

  return buildStrictObjectSchema({
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
      items: stepSchema,
    },
  });
}

export const actionPlanStepJsonSchema = buildActionPlanStepSchema(
  getLiveCapabilityDefinitions().map(capability => capability.id as CapabilityId),
);

export const actionPlanJsonSchema = buildActionPlanJsonSchema();
