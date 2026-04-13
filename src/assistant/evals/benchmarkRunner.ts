import { ASSISTANT_BENCHMARK } from '../../config/constants';
import type { CapabilityId } from '../capabilities';
import { buildAssistantModelTurnJsonSchema, parseAssistantModelTextTurn } from '../orchestrationSchema';
import { buildAssistantInitialTurnMessages } from '../orchestrator';
import { validateModelPlan, buildPlanningBundle } from '../planner';
import type { ActionPlan } from '../plannerSchema';
import type {
  AssistantConversationMessage,
  AssistantLang,
  AssistantPlanningBundle,
} from '../shared';
import { buildAssistantToolDefinitions, fromAssistantToolName } from '../toolSchemas';
import {
  ASSISTANT_BENCHMARK_CASES,
  type AssistantBenchmarkCase,
} from './benchmarkCorpus';
import {
  buildAssistantBenchmarkContext,
  buildAssistantBenchmarkDialogState,
} from './benchmarkFixtures';

export interface AssistantBenchmarkToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AssistantBenchmarkPlannerRequest {
  benchmarkCase: AssistantBenchmarkCase;
  bundle: AssistantPlanningBundle;
  messages: AssistantConversationMessage[];
  format: ReturnType<typeof buildAssistantModelTurnJsonSchema>;
  tools: ReturnType<typeof buildAssistantToolDefinitions>;
  capabilityIds: CapabilityId[];
}

export interface AssistantBenchmarkPlannerResponse {
  rawResponse: string;
  planningSource: 'openai' | 'ollama';
  planningModel?: string;
  turnType: 'text' | 'tool_calls';
  text?: string;
  toolCalls?: AssistantBenchmarkToolCall[];
}

export interface AssistantBenchmarkCaseResult {
  id: string;
  transcript: string;
  tags: string[];
  expectedMode: AssistantBenchmarkCase['expectedMode'];
  expectedCapabilities: string[];
  expectedReferencedEntityIds: string[];
  actualMode: ActionPlan['mode'] | null;
  actualCapabilities: string[];
  actualReferencedEntityIds: string[];
  planningSource: 'openai' | 'ollama';
  planningModel?: string;
  planningStatus: 'planned' | 'blocked_provider_unavailable' | 'model_response_invalid' | 'validator_rejected';
  modeMatched: boolean;
  capabilityMatched: boolean;
  entityMatched: boolean | null;
  passed: boolean;
  rawResponse: string;
  parsedPlan: ActionPlan | null;
  validatedPlan: ActionPlan | null;
  failureReason?: string;
}

export interface AssistantBenchmarkSliceSummary {
  total: number;
  passed: number;
  passRate: number;
}

export interface AssistantBenchmarkSummary {
  total: number;
  passed: number;
  passRate: number;
  destructive: AssistantBenchmarkSliceSummary;
  unsupported: AssistantBenchmarkSliceSummary;
  entitySelection: AssistantBenchmarkSliceSummary;
}

export interface AssistantBenchmarkReport {
  provider: 'hosted' | 'ollama';
  model?: string;
  generatedAt: string;
  summary: AssistantBenchmarkSummary;
  thresholds: {
    minOverallPassRate: number;
    minDestructivePassRate: number;
    minUnsupportedPassRate: number;
  };
  results: AssistantBenchmarkCaseResult[];
}

export interface RunAssistantBenchmarkOptions {
  planner: (request: AssistantBenchmarkPlannerRequest) => Promise<AssistantBenchmarkPlannerResponse>;
  provider: 'hosted' | 'ollama';
  lang?: AssistantLang;
  conversationHistory?: AssistantConversationMessage[];
  cases?: readonly AssistantBenchmarkCase[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftValues = uniqueSorted(left);
  const rightValues = uniqueSorted(right);
  if (leftValues.length !== rightValues.length) return false;
  return leftValues.every((value, index) => value === rightValues[index]);
}

function toSliceSummary(results: AssistantBenchmarkCaseResult[]): AssistantBenchmarkSliceSummary {
  const passed = results.filter(result => result.passed).length;
  return {
    total: results.length,
    passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
  };
}

function buildSummary(results: AssistantBenchmarkCaseResult[]): AssistantBenchmarkSummary {
  const overall = toSliceSummary(results);
  const destructive = toSliceSummary(results.filter(result => result.tags.includes('destructive')));
  const unsupported = toSliceSummary(results.filter(result => result.tags.includes('unsupported')));
  const entitySelection = toSliceSummary(results.filter(result => result.entityMatched !== null));

  return {
    total: overall.total,
    passed: overall.passed,
    passRate: overall.passRate,
    destructive,
    unsupported,
    entitySelection,
  };
}

function extractCapabilities(plan: ActionPlan | null): string[] {
  return uniqueSorted((plan?.steps || []).map(step => step.capability));
}

function extractEntityIds(planResult: ReturnType<typeof validateModelPlan>): string[] {
  return uniqueSorted(planResult.referencedEntities.map(entity => entity.id));
}

function parseToolCallPlan(response: AssistantBenchmarkPlannerResponse): ActionPlan | null {
  const rawToolCalls = response.toolCalls || [];
  if (rawToolCalls.length === 0) {
    return null;
  }

  const steps = rawToolCalls.map(toolCall => {
    try {
      const args = JSON.parse(toolCall.arguments);
      const capabilityId = fromAssistantToolName(toolCall.name);
      if (!capabilityId || typeof args !== 'object' || args === null || Array.isArray(args)) {
        return null;
      }
      return {
        capability: capabilityId,
        args,
      };
    } catch {
      return null;
    }
  });

  if (steps.some(step => step === null)) {
    return null;
  }

  return {
    mode: 'act',
    response: '',
    confidence: 1,
    steps: steps.filter((step): step is NonNullable<typeof step> => step !== null),
  };
}

function parsePlannerResponse(response: AssistantBenchmarkPlannerResponse): ActionPlan | null {
  if (response.turnType === 'tool_calls') {
    return parseToolCallPlan(response);
  }

  try {
    const parsedTurn = parseAssistantModelTextTurn(JSON.parse(response.text || response.rawResponse));
    if (!parsedTurn) {
      return null;
    }

    return {
      mode: parsedTurn.mode === 'reply'
        ? 'answer'
        : parsedTurn.mode === 'clarify'
          ? 'clarify'
          : parsedTurn.mode === 'confirm'
            ? 'confirm'
            : 'act',
      response: parsedTurn.assistantMessage,
      confidence: 1,
      steps: parsedTurn.toolCalls,
    };
  } catch {
    return null;
  }
}

function evaluateParsedCase(
  benchmarkCase: AssistantBenchmarkCase,
  response: AssistantBenchmarkPlannerResponse,
  parsedPlan: ActionPlan | null,
  lang: AssistantLang,
): AssistantBenchmarkCaseResult {
  const context = buildAssistantBenchmarkContext();

  if (!parsedPlan) {
    return {
      id: benchmarkCase.id,
      transcript: benchmarkCase.transcript,
      tags: [...benchmarkCase.tags],
      expectedMode: benchmarkCase.expectedMode,
      expectedCapabilities: [...benchmarkCase.expectedCapabilities],
      expectedReferencedEntityIds: [...(benchmarkCase.expectedReferencedEntityIds || [])],
      actualMode: null,
      actualCapabilities: [],
      actualReferencedEntityIds: [],
      planningSource: response.planningSource,
      planningModel: response.planningModel,
      planningStatus: 'model_response_invalid',
      modeMatched: false,
      capabilityMatched: false,
      entityMatched: benchmarkCase.expectedReferencedEntityIds ? false : null,
      passed: false,
      rawResponse: response.rawResponse,
      parsedPlan: null,
      validatedPlan: null,
      failureReason: response.turnType === 'tool_calls'
        ? 'Planner returned malformed tool calls.'
        : 'Planner returned no parseable conversational turn.',
    };
  }

  const validation = validateModelPlan(benchmarkCase.transcript, parsedPlan, context, lang);
  const actualCapabilities = extractCapabilities(validation.plan);
  const expectedCapabilities = uniqueSorted([...benchmarkCase.expectedCapabilities]);
  const expectedReferencedEntityIds = uniqueSorted([...(benchmarkCase.expectedReferencedEntityIds || [])]);
  const actualReferencedEntityIds = extractEntityIds(validation);
  const modeMatched = validation.plan.mode === benchmarkCase.expectedMode;
  const capabilityMatched = sameStringSet(actualCapabilities, expectedCapabilities);
  const entityMatched = benchmarkCase.expectedReferencedEntityIds
    ? sameStringSet(actualReferencedEntityIds, expectedReferencedEntityIds)
    : null;
  const passed = validation.planningStatus === 'planned'
    && modeMatched
    && capabilityMatched
    && (entityMatched ?? true);

  const failureReason = passed
    ? undefined
    : validation.planningStatus === 'validator_rejected'
      ? validation.plannerValidation.reason || 'Validator rejected the model turn.'
      : !modeMatched
        ? `Expected mode ${benchmarkCase.expectedMode} but got ${validation.plan.mode}.`
        : !capabilityMatched
          ? `Expected capabilities ${expectedCapabilities.join(', ') || 'none'} but got ${actualCapabilities.join(', ') || 'none'}.`
          : entityMatched === false
            ? `Expected referenced ids ${expectedReferencedEntityIds.join(', ')} but got ${actualReferencedEntityIds.join(', ')}.`
            : 'Benchmark case failed.';

  return {
    id: benchmarkCase.id,
    transcript: benchmarkCase.transcript,
    tags: [...benchmarkCase.tags],
    expectedMode: benchmarkCase.expectedMode,
    expectedCapabilities,
    expectedReferencedEntityIds,
    actualMode: validation.plan.mode,
    actualCapabilities,
    actualReferencedEntityIds,
    planningSource: response.planningSource,
    planningModel: response.planningModel,
    planningStatus: validation.planningStatus,
    modeMatched,
    capabilityMatched,
    entityMatched,
    passed,
    rawResponse: response.rawResponse,
    parsedPlan,
    validatedPlan: validation.plan,
    failureReason,
  };
}

export function getAssistantBenchmarkThresholdFailures(summary: AssistantBenchmarkSummary): string[] {
  const failures: string[] = [];

  if (summary.passRate < ASSISTANT_BENCHMARK.MIN_OVERALL_PASS_RATE) {
    failures.push(
      `Overall assistant benchmark pass rate ${(summary.passRate * 100).toFixed(1)}% is below the ${(ASSISTANT_BENCHMARK.MIN_OVERALL_PASS_RATE * 100).toFixed(1)}% release threshold.`,
    );
  }

  if (summary.destructive.passRate < ASSISTANT_BENCHMARK.MIN_DESTRUCTIVE_PASS_RATE) {
    failures.push(
      `Destructive assistant benchmark pass rate ${(summary.destructive.passRate * 100).toFixed(1)}% is below the ${(ASSISTANT_BENCHMARK.MIN_DESTRUCTIVE_PASS_RATE * 100).toFixed(1)}% release threshold.`,
    );
  }

  if (summary.unsupported.passRate < ASSISTANT_BENCHMARK.MIN_UNSUPPORTED_PASS_RATE) {
    failures.push(
      `Unsupported-intent benchmark pass rate ${(summary.unsupported.passRate * 100).toFixed(1)}% is below the ${(ASSISTANT_BENCHMARK.MIN_UNSUPPORTED_PASS_RATE * 100).toFixed(1)}% release threshold.`,
    );
  }

  return failures;
}

export async function runAssistantBenchmark(
  options: RunAssistantBenchmarkOptions,
): Promise<AssistantBenchmarkReport> {
  const lang = options.lang || 'en';
  const benchmarkCases = [...(options.cases || ASSISTANT_BENCHMARK_CASES)];
  const context = buildAssistantBenchmarkContext();
  const results: AssistantBenchmarkCaseResult[] = [];
  let model = '';

  for (const benchmarkCase of benchmarkCases) {
    const dialogState = buildAssistantBenchmarkDialogState(benchmarkCase.dialogStateSeed);
    const bundle = buildPlanningBundle(benchmarkCase.transcript, context, dialogState);
    const capabilityIds = bundle.capabilities.map(candidate => candidate.id as CapabilityId);
    const format = buildAssistantModelTurnJsonSchema(capabilityIds);
    const tools = buildAssistantToolDefinitions(capabilityIds);
    const messages = buildAssistantInitialTurnMessages(
      benchmarkCase.transcript,
      bundle,
      lang,
      options.conversationHistory,
    ) as AssistantConversationMessage[];
    const response = await options.planner({
      benchmarkCase,
      bundle,
      messages,
      format,
      tools,
      capabilityIds,
    });
    model = response.planningModel || model;
    const parsedPlan = parsePlannerResponse(response);
    results.push(evaluateParsedCase(benchmarkCase, response, parsedPlan, lang));
  }

  return {
    provider: options.provider,
    model: model || undefined,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(results),
    thresholds: {
      minOverallPassRate: ASSISTANT_BENCHMARK.MIN_OVERALL_PASS_RATE,
      minDestructivePassRate: ASSISTANT_BENCHMARK.MIN_DESTRUCTIVE_PASS_RATE,
      minUnsupportedPassRate: ASSISTANT_BENCHMARK.MIN_UNSUPPORTED_PASS_RATE,
    },
    results,
  };
}
