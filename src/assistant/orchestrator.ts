import { DEFAULT_ASSISTANT_PROVIDER, OLLAMA_ENDPOINT } from '../config';
import { LIMITS } from '../config/constants';
import {
  chatWithHostedAssistantDetailed,
  runHostedAssistantTurn,
  testHostedAssistantConnection,
} from '../services/hostedAssistantApi';
import {
  buildOpenAIAssistantBilling,
  buildOpenAIRequestBilling,
} from '../services/assistantBilling';
import { normalizeHostedAssistantModel } from '../services/assistantModels';
import { chatWithOllama, type OllamaMessage } from '../services/ollamaApi';
import type { AssistantProvider } from '../types/domain';
import { getCapabilityDefinition, getLiveCapabilityDefinitions, listCapabilitiesForPrompt, type CapabilityId } from './capabilities';
import {
  buildAssistantModelTurnJsonSchema,
  buildAssistantNarrationJsonSchema,
  parseAssistantModelTextTurn,
  parseAssistantNarration,
  type AssistantModelTextTurn,
} from './orchestrationSchema';
import {
  buildPlanningBundle,
  isOllamaAvailable,
  validateModelPlan,
  type PlannerResult,
} from './planner';
import type { ActionPlan } from './plannerSchema';
import { normalizeActionPlanArgs } from './plannerSchema';
import type {
  AssistantCommandContext,
  AssistantConversationMessage,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantLang,
  AssistantModelTurn,
  AssistantPendingConfirmation,
  AssistantPlanningBundle,
  AssistantPlanningStatus,
  AssistantPlanningSource,
  AssistantPlannerValidation,
  AssistantToolCall,
  AssistantToolCallDraft,
  AssistantToolResult,
} from './shared';
import type { AssistantMessageBilling } from '../types/domain';
import { buildAssistantToolDefinitions, fromAssistantToolName } from './toolSchemas';

interface ModelTurnResult {
  assistantMessage: string;
  modelTurn?: AssistantModelTurn | null;
  toolCalls?: AssistantToolCall[];
  assistantBilling?: AssistantMessageBilling;
  referencedEntities?: AssistantEntityReference[];
  source: 'openai' | 'ollama' | 'degraded';
  degradedReason?: PlannerResult['degradedReason'];
  planningSource: AssistantPlanningSource;
  planningStatus: AssistantPlanningStatus;
  planningModel?: string;
  planningBundle?: AssistantPlanningBundle;
  rawPlannerResponse?: string;
  parsedPlan?: ActionPlan | null;
  validatedPlan?: ActionPlan | null;
  plannerValidation?: AssistantPlannerValidation;
}

interface AssistantNarrationResult {
  assistantMessage: string;
  assistantBilling?: AssistantMessageBilling;
  rawNarrationResponse?: string;
  source: 'openai' | 'ollama' | 'local' | 'degraded';
}

const DEFAULT_OLLAMA_MODEL = 'qwen3';
const RISKY_CAPABILITY_IDS = new Set(
  getLiveCapabilityDefinitions()
    .filter(capability => capability.confirmationRule === 'always')
    .map(capability => capability.id as CapabilityId),
);

const RESPONSES = {
  noLivePlanner: {
    en: 'No live AI provider is available, so Lina will not guess or run anything right now.',
    ar: 'لا يوجد مزود ذكاء اصطناعي مباشر متاح الآن، لذلك لن تخمّن لينا ولن تنفذ شيئاً حالياً.',
  },
  hostedSignInRequired: {
    en: 'Hosted AI needs sign-in before Lina can help with that safely.',
    ar: 'الذكاء الاصطناعي المستضاف يحتاج إلى تسجيل الدخول قبل أن تتمكن لينا من المساعدة بأمان.',
  },
  hostedNotConfigured: {
    en: 'Hosted AI is not configured in this build, so Lina cannot handle that safely right now.',
    ar: 'الذكاء الاصطناعي المستضاف غير مُعدّ في هذا الإصدار، لذلك لا تستطيع لينا التعامل مع ذلك بأمان الآن.',
  },
  hostedUnavailable: {
    en: (message: string) => `I couldn't reach hosted GPT right now (${message}), so I didn't guess or run anything.`,
    ar: (message: string) => `تعذر عليّ الوصول إلى GPT المستضاف الآن (${message})، لذلك لم أخمّن ولم أنفذ شيئاً.`,
  },
  ollamaUnavailable: {
    en: 'Ollama is offline, so Lina will not guess or run anything right now.',
    ar: 'Ollama غير متصل، لذلك لن تخمّن لينا ولن تنفذ شيئاً الآن.',
  },
  ollamaError: {
    en: (message: string) => `I couldn't reach Ollama right now (${message}), so I didn't guess or run anything.`,
    ar: (message: string) => `تعذر عليّ الوصول إلى Ollama الآن (${message})، لذلك لم أخمّن ولم أنفذ شيئاً.`,
  },
  invalidTurn: {
    en: 'I had trouble interpreting the model response, so I need to clarify instead of guessing.',
    ar: 'واجهت مشكلة في تفسير رد النموذج، لذلك أحتاج إلى التوضيح بدلاً من التخمين.',
  },
  cancellation: {
    en: "Okay, I won't do that.",
    ar: 'حسناً، لن أفعل ذلك.',
  },
};

function getAssistantProvider(provider?: AssistantProvider): AssistantProvider {
  return provider || DEFAULT_ASSISTANT_PROVIDER;
}

function toPlanningMode(mode: AssistantModelTextTurn['mode']): ActionPlan['mode'] {
  switch (mode) {
    case 'reply':
      return 'answer';
    case 'clarify':
      return 'clarify';
    case 'confirm':
      return 'confirm';
    case 'tool_calls':
    default:
      return 'act';
  }
}

function toCompatibilityPlan(
  mode: AssistantModelTextTurn['mode'],
  assistantMessage: string,
  toolCalls: AssistantToolCallDraft[],
): ActionPlan {
  return {
    mode: toPlanningMode(mode),
    response: assistantMessage,
    confidence: 1,
    steps: toolCalls.map(toolCall => ({
      capability: toolCall.capability,
      args: toolCall.args,
      unresolved: toolCall.unresolved,
      requiresConfirmation: toolCall.requiresConfirmation,
    })),
  };
}

function buildToolCalls(
  toolCalls: AssistantToolCallDraft[],
  existingCallIds?: string[],
): AssistantToolCall[] {
  return toolCalls.map((toolCall, index) => ({
    callId: existingCallIds?.[index] || `call_${index + 1}`,
    capability: toolCall.capability,
    args: toolCall.args,
    unresolved: toolCall.unresolved,
    requiresConfirmation: toolCall.requiresConfirmation,
  }));
}

function toConversationMode(mode: ActionPlan['mode']): AssistantModelTurn['mode'] {
  switch (mode) {
    case 'answer':
      return 'reply';
    case 'clarify':
      return 'clarify';
    case 'confirm':
      return 'confirm';
    case 'act':
    default:
      return 'tool_calls';
  }
}

function buildValidatedModelTurn(
  validatedPlan: ActionPlan | null,
  fallbackMode: AssistantModelTextTurn['mode'] | undefined,
  fallbackAssistantMessage: string,
  toolCalls: AssistantToolCall[],
): AssistantModelTurn {
  return {
    mode: validatedPlan
      ? toConversationMode(validatedPlan.mode)
      : fallbackMode || (toolCalls.length > 0 ? 'tool_calls' : 'reply'),
    assistantMessage: validatedPlan?.response || fallbackAssistantMessage,
    toolCalls,
  };
}

function buildMessageHistory(
  conversationHistory: AssistantConversationMessage[] | undefined,
): OllamaMessage[] {
  return (conversationHistory || []).slice(-LIMITS.LLM_HISTORY_MESSAGES).map(message => ({
    role: message.role,
    content: message.content,
  }));
}

export function buildAssistantInitialTurnMessages(
  transcript: string,
  bundle: AssistantPlanningBundle,
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
  pendingConfirmation?: AssistantPendingConfirmation,
): OllamaMessage[] {
  const capabilities = getLiveCapabilityDefinitions()
    .filter(capability => bundle.capabilities.some(candidate => candidate.id === capability.id));
  const languageInstruction = lang === 'ar'
    ? 'Respond using Arabic in assistantMessage.'
    : 'Respond using English in assistantMessage.';
  const pendingContext = pendingConfirmation
    ? `Pending confirmation JSON:\n${JSON.stringify({
        assistantMessage: pendingConfirmation.assistantMessage,
        toolCalls: pendingConfirmation.toolCalls,
        referencedEntities: pendingConfirmation.referencedEntities.map(entity => ({
          kind: entity.kind,
          id: entity.id,
          label: entity.label,
        })),
      }, null, 2)}`
    : 'Pending confirmation JSON:\nnull';

  const prompt = `You are Lina, the conversational assistant inside Sabah One.
${languageInstruction}
Return either function tool calls or JSON matching the provided schema.

Visible assistant replies should sound natural, warm, and concise.

Choose exactly one mode:
- reply: answer conversationally with no action
- clarify: ask for missing details or explain an unsupported request
- confirm: ask before a risky mutation and include the exact toolCalls you would run after approval
- tool_calls: request one or more tools when you can safely act now

Rules:
- Never say an action is complete unless verified execution results are later provided.
- Use only tool names and grounded ids from the planning bundle.
- Never invent ids, titles, calendars, accounts, topics, or events.
- Entity candidate detail may describe a default or umbrella target. If exactly one grounded candidate is marked default and its detail clearly covers the user's requested subtopic, use that grounded id instead of clarifying.
- For prayer completion, include prayerStatus as on_time or late only when the user explicitly says which. Otherwise omit it; never infer prayer status from the clock.
- Prefer clarify over guessing.
- If a tool requires confirmation and the user has not clearly approved it yet, return confirm instead of tool_calls.
- If the user is replying to a pending confirmation, update or reuse those toolCalls.
- If the request is unsupported, clarify truthfully and do not approximate it to another action.
- Keep assistantMessage brief and human.`;

  return [
    { role: 'system', content: prompt },
    { role: 'system', content: `Relevant capabilities:\n${listCapabilitiesForPrompt(capabilities)}` },
    { role: 'system', content: `Planning bundle JSON:\n${JSON.stringify(bundle, null, 2)}` },
    { role: 'system', content: pendingContext },
    ...buildMessageHistory(conversationHistory),
    { role: 'user', content: transcript },
  ];
}

function buildNarrationMessages(
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
  payload: Record<string, unknown>,
): OllamaMessage[] {
  const languageInstruction = lang === 'ar'
    ? 'Respond using Arabic.'
    : 'Respond using English.';

  return [
    {
      role: 'system',
      content: `You are Lina, the assistant inside Sabah One.
${languageInstruction}
Return JSON matching the provided schema.

Write the visible assistant reply from verified facts only.
- Sound natural and concise.
- Never claim an action happened unless the facts say it completed.
- If the facts say the action was blocked or needs clarification, explain that honestly.
- Do not mention internal schemas, validators, or tool ids.`,
    },
    ...buildMessageHistory(conversationHistory),
    {
      role: 'user',
      content: `Verified turn facts JSON:\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

function parseHostedToolCalls(toolCalls: Array<{ callId: string; name: string; arguments: string }>): AssistantToolCallDraft[] | null {
  const parsedCalls: AssistantToolCallDraft[] = [];

  for (const toolCall of toolCalls) {
    const rawArguments = toolCall.arguments?.trim();
    if (!rawArguments) return null;

    try {
      const rawArgs = JSON.parse(rawArguments);
      const capabilityId = typeof toolCall.name === 'string'
        ? fromAssistantToolName(toolCall.name)
        : null;
      const args = capabilityId
        ? normalizeActionPlanArgs(rawArgs, capabilityId)
        : null;
      if (!capabilityId || !args) {
        return null;
      }
      parsedCalls.push({
        capability: capabilityId,
        args,
      });
    } catch {
      return null;
    }
  }

  return parsedCalls;
}

function requiresConfirmation(toolCalls: AssistantToolCall[]): boolean {
  return toolCalls.some(toolCall =>
    toolCall.requiresConfirmation || RISKY_CAPABILITY_IDS.has(toolCall.capability),
  );
}

function buildStepFacts(summary: string, entityRefs: AssistantEntityReference[] | undefined): string[] {
  const facts = [summary];
  if (entityRefs && entityRefs.length > 0) {
    facts.push(`Referenced entities: ${entityRefs.map(entity => `${entity.kind}:${entity.label}`).join(', ')}.`);
  }
  return facts;
}

function localNarrationFromResults(toolResults: AssistantToolResult[], fallback: string): string {
  const completed = toolResults.filter(result => result.status === 'completed');
  if (completed.length === 0) return fallback;
  return completed[completed.length - 1].summary;
}

function toPlannerStatus(status: 'available' | 'sign_in_required' | 'not_configured' | 'unavailable'): AssistantPlanningStatus {
  return status === 'available' ? 'planned' : 'blocked_provider_unavailable';
}

async function runHostedInitialTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    dialogState?: AssistantDialogState;
    pendingConfirmation?: AssistantPendingConfirmation;
    hostedModel?: string;
  },
): Promise<ModelTurnResult> {
  const hostedModel = normalizeHostedAssistantModel(options.hostedModel);
  const availability = await testHostedAssistantConnection({ model: hostedModel });
  const planningDialogState = options.pendingConfirmation
    ? {
        ...(options.dialogState || {
          currentSurface: context.currentSurface,
          recentEntities: [],
          recentPlans: [],
        }),
        pendingConfirmation: options.pendingConfirmation,
      }
    : options.dialogState;
  const bundle = buildPlanningBundle(transcript, context, planningDialogState);
  const capabilityIds = bundle.capabilities.map(candidate => candidate.id as CapabilityId);

  if (availability.status === 'sign_in_required') {
    return {
      assistantMessage: RESPONSES.hostedSignInRequired[options.lang],
      source: 'degraded',
      degradedReason: 'hosted_sign_in_required',
      planningSource: 'none',
      planningStatus: toPlannerStatus(availability.status),
      planningModel: availability.model || hostedModel,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: 'Hosted planner requires sign-in.' },
    };
  }

  if (availability.status === 'not_configured') {
    return {
      assistantMessage: RESPONSES.hostedNotConfigured[options.lang],
      source: 'degraded',
      degradedReason: 'hosted_not_configured',
      planningSource: 'none',
      planningStatus: toPlannerStatus(availability.status),
      planningModel: availability.model || hostedModel,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: 'Hosted planner is not configured.' },
    };
  }

  if (availability.status !== 'available') {
    return {
      assistantMessage: RESPONSES.hostedUnavailable[options.lang](availability.message || 'Hosted AI unavailable'),
      source: 'degraded',
      degradedReason: 'hosted_error',
      planningSource: 'none',
      planningStatus: toPlannerStatus(availability.status),
      planningModel: availability.model || hostedModel,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: availability.message || 'Hosted AI unavailable.' },
    };
  }

  try {
    const messages = buildAssistantInitialTurnMessages(
      transcript,
      bundle,
      options.lang,
      options.conversationHistory,
      options.pendingConfirmation,
    );
    const response = await runHostedAssistantTurn(messages, {
      model: hostedModel,
      format: buildAssistantModelTurnJsonSchema(capabilityIds),
      tools: buildAssistantToolDefinitions(capabilityIds),
    });
    const assistantBilling = buildOpenAIAssistantBilling(
      [
        buildOpenAIRequestBilling('planner', response.usage),
      ].filter((request): request is NonNullable<ReturnType<typeof buildOpenAIRequestBilling>> => request !== null),
    );

    let parsedTurn: AssistantModelTextTurn | null = null;
    let parsedPlan: ActionPlan | null = null;
    let validatedPlan: ActionPlan | null = null;
    let referencedEntities: AssistantEntityReference[] = [];
    let plannerValidation: AssistantPlannerValidation = { status: 'accepted' };
    let planningStatus: AssistantPlanningStatus = 'planned';
    let toolCalls: AssistantToolCall[] = [];
    let assistantMessage = '';

    if (response.type === 'tool_calls') {
      const parsedToolCalls = parseHostedToolCalls(response.toolCalls);
      if (!parsedToolCalls) {
        return {
          assistantMessage: RESPONSES.invalidTurn[options.lang],
          source: 'degraded',
          degradedReason: 'hosted_error',
          assistantBilling,
          planningSource: 'openai',
          planningStatus: 'model_response_invalid',
          planningModel: response.model,
          planningBundle: bundle,
          rawPlannerResponse: response.rawResponse,
          parsedPlan: null,
          validatedPlan: null,
          plannerValidation: { status: 'rejected', reason: 'Hosted tool calls could not be parsed.' },
        };
      }
      parsedPlan = toCompatibilityPlan('tool_calls', '', parsedToolCalls);
      const validation = validateModelPlan(transcript, parsedPlan, context, options.lang);
      validatedPlan = validation.plan;
      referencedEntities = validation.referencedEntities;
      plannerValidation = validation.plannerValidation;
      planningStatus = validation.planningStatus;
      toolCalls = validation.planningStatus === 'planned'
        ? buildToolCalls(validation.plan.steps, response.toolCalls.map(toolCall => toolCall.callId))
        : [];
      parsedTurn = {
        mode: 'tool_calls',
        assistantMessage: '',
        toolCalls: parsedToolCalls.map((toolCall, index) => ({
          ...toolCall,
          requiresConfirmation: toolCalls[index]?.requiresConfirmation,
        })),
      };
    } else {
      const envelope = (() => {
        try {
          return parseAssistantModelTextTurn(JSON.parse(response.text || ''));
        } catch {
          return null;
        }
      })();

      if (!envelope) {
        return {
          assistantMessage: RESPONSES.invalidTurn[options.lang],
          source: 'degraded',
          degradedReason: 'hosted_error',
          assistantBilling,
          planningSource: 'openai',
          planningStatus: 'model_response_invalid',
          planningModel: response.model,
          planningBundle: bundle,
          rawPlannerResponse: response.rawResponse || response.text,
          parsedPlan: null,
          validatedPlan: null,
          plannerValidation: { status: 'rejected', reason: 'Hosted text turn could not be parsed.' },
        };
      }

      parsedTurn = envelope;
      assistantMessage = envelope.assistantMessage;
      parsedPlan = toCompatibilityPlan(envelope.mode, envelope.assistantMessage, envelope.toolCalls);
      if (envelope.toolCalls.length > 0) {
        const validation = validateModelPlan(transcript, parsedPlan, context, options.lang);
        validatedPlan = validation.plan;
        referencedEntities = validation.referencedEntities;
        plannerValidation = validation.plannerValidation;
        planningStatus = validation.planningStatus;
        toolCalls = validation.planningStatus === 'planned'
          ? buildToolCalls(validation.plan.steps)
          : [];
      } else {
        validatedPlan = parsedPlan;
      }
    }

    const normalizedTurn = buildValidatedModelTurn(
      validatedPlan,
      parsedTurn?.mode,
      assistantMessage || parsedTurn?.assistantMessage || '',
      toolCalls,
    );

    if (planningStatus !== 'planned') {
      return {
        assistantMessage: normalizedTurn.assistantMessage || RESPONSES.invalidTurn[options.lang],
        modelTurn: normalizedTurn,
        toolCalls,
        assistantBilling,
        referencedEntities,
        source: 'openai',
        planningSource: 'openai',
        planningStatus,
        planningModel: response.model,
        planningBundle: bundle,
        rawPlannerResponse: response.rawResponse || response.text,
        parsedPlan,
        validatedPlan,
        plannerValidation,
      };
    }

    return {
      assistantMessage: normalizedTurn.assistantMessage,
      modelTurn: normalizedTurn,
      toolCalls,
      assistantBilling,
      referencedEntities,
      source: 'openai',
      planningSource: 'openai',
      planningStatus: 'planned',
      planningModel: response.model,
      planningBundle: bundle,
      rawPlannerResponse: response.rawResponse || response.text,
      parsedPlan,
      validatedPlan,
      plannerValidation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      assistantMessage: RESPONSES.hostedUnavailable[options.lang](message),
      source: 'degraded',
      degradedReason: 'hosted_error',
      planningSource: 'none',
      planningStatus: 'blocked_provider_unavailable',
      planningModel: hostedModel,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: message },
    };
  }
}

async function runOllamaInitialTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    endpoint?: string;
    ollamaModel?: string;
    conversationHistory?: AssistantConversationMessage[];
    dialogState?: AssistantDialogState;
    pendingConfirmation?: AssistantPendingConfirmation;
  },
): Promise<ModelTurnResult> {
  const endpoint = options.endpoint || OLLAMA_ENDPOINT;
  const model = options.ollamaModel || DEFAULT_OLLAMA_MODEL;
  const planningDialogState = options.pendingConfirmation
    ? {
        ...(options.dialogState || {
          currentSurface: context.currentSurface,
          recentEntities: [],
          recentPlans: [],
        }),
        pendingConfirmation: options.pendingConfirmation,
      }
    : options.dialogState;
  const bundle = buildPlanningBundle(transcript, context, planningDialogState);
  const capabilityIds = bundle.capabilities.map(candidate => candidate.id as CapabilityId);
  const available = await isOllamaAvailable(endpoint);

  if (!available) {
    return {
      assistantMessage: RESPONSES.ollamaUnavailable[options.lang],
      source: 'degraded',
      degradedReason: 'ollama_offline',
      planningSource: 'none',
      planningStatus: 'blocked_provider_unavailable',
      planningModel: model,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: 'Ollama is offline.' },
    };
  }

  try {
    const rawResponse = await chatWithOllama(
      buildAssistantInitialTurnMessages(
        transcript,
        bundle,
        options.lang,
        options.conversationHistory,
        options.pendingConfirmation,
      ),
      endpoint,
      model,
      buildAssistantModelTurnJsonSchema(capabilityIds),
    );

    let parsedTurn: AssistantModelTextTurn | null = null;
    try {
      parsedTurn = parseAssistantModelTextTurn(JSON.parse(rawResponse));
    } catch {
      parsedTurn = null;
    }

    if (!parsedTurn) {
      return {
        assistantMessage: RESPONSES.invalidTurn[options.lang],
        source: 'degraded',
        degradedReason: 'ollama_error',
        planningSource: 'ollama',
        planningStatus: 'model_response_invalid',
        planningModel: model,
        planningBundle: bundle,
        rawPlannerResponse: rawResponse,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: { status: 'rejected', reason: 'Ollama text turn could not be parsed.' },
      };
    }

    const parsedPlan = toCompatibilityPlan(parsedTurn.mode, parsedTurn.assistantMessage, parsedTurn.toolCalls);
    let validatedPlan: ActionPlan | null = parsedPlan;
    let referencedEntities: AssistantEntityReference[] = [];
    let plannerValidation: AssistantPlannerValidation = { status: 'accepted' };
    let planningStatus: AssistantPlanningStatus = 'planned';
    let toolCalls: AssistantToolCall[] = [];

    if (parsedTurn.toolCalls.length > 0) {
      const validation = validateModelPlan(transcript, parsedPlan, context, options.lang);
      validatedPlan = validation.plan;
      referencedEntities = validation.referencedEntities;
      plannerValidation = validation.plannerValidation;
      planningStatus = validation.planningStatus;
      toolCalls = validation.planningStatus === 'planned'
        ? buildToolCalls(validation.plan.steps)
        : [];
    }

    const normalizedTurn = buildValidatedModelTurn(
      validatedPlan,
      parsedTurn.mode,
      parsedTurn.assistantMessage,
      toolCalls,
    );

    return {
      assistantMessage: normalizedTurn.assistantMessage,
      modelTurn: normalizedTurn,
      toolCalls,
      referencedEntities,
      source: 'ollama',
      planningSource: 'ollama',
      planningStatus,
      planningModel: model,
      planningBundle: bundle,
      rawPlannerResponse: rawResponse,
      parsedPlan,
      validatedPlan,
      plannerValidation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      assistantMessage: RESPONSES.ollamaError[options.lang](message),
      source: 'degraded',
      degradedReason: 'ollama_error',
      planningSource: 'none',
      planningStatus: 'blocked_provider_unavailable',
      planningModel: model,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: message },
    };
  }
}

export async function runAssistantInitialModelTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    provider?: AssistantProvider;
    hostedModel?: string;
    endpoint?: string;
    ollamaModel?: string;
    dialogState?: AssistantDialogState;
    pendingConfirmation?: AssistantPendingConfirmation;
  },
): Promise<ModelTurnResult> {
  const provider = getAssistantProvider(options.provider);

  if (provider === 'hosted') {
    return runHostedInitialTurn(transcript, context, options);
  }

  if (provider === 'ollama') {
    return runOllamaInitialTurn(transcript, context, options);
  }

  const hosted = await runHostedInitialTurn(transcript, context, options);
  if (hosted.source === 'openai' && hosted.planningStatus === 'planned') {
    return hosted;
  }

  if (hosted.planningStatus === 'validator_rejected') {
    const ollama = await runOllamaInitialTurn(transcript, context, options);
    return ollama.planningStatus === 'planned' ? ollama : hosted;
  }

  if (hosted.degradedReason !== 'hosted_sign_in_required' && hosted.degradedReason !== 'hosted_not_configured') {
    const ollama = await runOllamaInitialTurn(transcript, context, options);
    if (ollama.source === 'ollama' && ollama.planningStatus === 'planned') {
      return ollama;
    }
    if (ollama.planningStatus === 'validator_rejected') {
      return ollama;
    }
    return hosted;
  }

  const ollama = await runOllamaInitialTurn(transcript, context, options);
  if (ollama.source === 'ollama' || ollama.planningStatus === 'validator_rejected') {
    return ollama;
  }

  return {
    assistantMessage: RESPONSES.noLivePlanner[options.lang],
    source: 'degraded',
    degradedReason: hosted.degradedReason || ollama.degradedReason || 'unsupported_without_ai',
    planningSource: 'none',
    planningStatus: 'blocked_provider_unavailable',
    planningBundle: hosted.planningBundle || ollama.planningBundle,
    parsedPlan: null,
    validatedPlan: null,
    plannerValidation: { status: 'skipped', reason: 'No live AI provider available.' },
  };
}

async function runNarrationWithHosted(
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
  payload: Record<string, unknown>,
  model?: string,
): Promise<AssistantNarrationResult> {
  const messages = buildNarrationMessages(lang, conversationHistory, payload);
  const response = await chatWithHostedAssistantDetailed(messages, buildAssistantNarrationJsonSchema(), {
    model: normalizeHostedAssistantModel(model),
  });
  const parsed = parseAssistantNarration(JSON.parse(response.text));
  if (!parsed?.assistantMessage) {
    throw new Error('Hosted narration returned invalid JSON.');
  }
  return {
    assistantMessage: parsed.assistantMessage,
    assistantBilling: buildOpenAIAssistantBilling(
      [
        buildOpenAIRequestBilling('narration', response.usage),
      ].filter((request): request is NonNullable<ReturnType<typeof buildOpenAIRequestBilling>> => request !== null),
    ),
    rawNarrationResponse: response.text,
    source: 'openai',
  };
}

async function runNarrationWithOllama(
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
  payload: Record<string, unknown>,
  endpoint?: string,
  model?: string,
): Promise<AssistantNarrationResult> {
  const rawResponse = await chatWithOllama(
    buildNarrationMessages(lang, conversationHistory, payload),
    endpoint || OLLAMA_ENDPOINT,
    model || DEFAULT_OLLAMA_MODEL,
    buildAssistantNarrationJsonSchema(),
  );
  const parsed = parseAssistantNarration(JSON.parse(rawResponse));
  if (!parsed?.assistantMessage) {
    throw new Error('Ollama narration returned invalid JSON.');
  }
  return {
    assistantMessage: parsed.assistantMessage,
    rawNarrationResponse: rawResponse,
    source: 'ollama',
  };
}

export async function narrateAssistantOutcome(
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    planningSource: AssistantPlanningSource;
    hostedModel?: string;
    endpoint?: string;
    ollamaModel?: string;
  },
  payload: Record<string, unknown>,
  localFallback: string,
): Promise<AssistantNarrationResult> {
  try {
    if (options.planningSource === 'openai') {
      return await runNarrationWithHosted(
        options.lang,
        options.conversationHistory,
        payload,
        options.hostedModel,
      );
    }

    if (options.planningSource === 'ollama') {
      return await runNarrationWithOllama(
        options.lang,
        options.conversationHistory,
        payload,
        options.endpoint,
        options.ollamaModel,
      );
    }
  } catch {
    // Fall through to local fallback.
  }

  return {
    assistantMessage: localFallback,
    source: options.planningSource === 'none' ? 'degraded' : 'local',
  };
}

export function buildPendingConfirmation(
  assistantMessage: string,
  toolCalls: AssistantToolCall[],
  referencedEntities: AssistantEntityReference[],
  source: AssistantPlanningSource,
  planningModel?: string,
): AssistantPendingConfirmation {
  return {
    assistantMessage,
    toolCalls,
    referencedEntities,
    createdAt: new Date().toISOString(),
    source,
    planningModel,
  };
}

export function buildExecutionFacts(results: AssistantToolResult[]): Record<string, unknown> {
  return {
    executedToolResults: results.map(result => ({
      callId: result.callId,
      capability: result.capability,
      status: result.status,
      summary: result.summary,
      facts: result.facts,
      entities: (result.entityRefs || []).map(entity => ({
        kind: entity.kind,
        id: entity.id,
        label: entity.label,
      })),
    })),
  };
}

export function getConfirmationRuleSummary(toolCalls: AssistantToolCall[]): string[] {
  return toolCalls.map(toolCall => {
    const capability = getCapabilityDefinition(toolCall.capability);
    return `${toolCall.capability}: ${capability.confirmationRule}`;
  });
}

export function needsConfirmation(toolCalls: AssistantToolCall[]): boolean {
  return requiresConfirmation(toolCalls);
}

export function buildExecutionFallbackMessage(
  toolResults: AssistantToolResult[],
  fallback: string,
): string {
  return localNarrationFromResults(toolResults, fallback);
}

export function buildToolResultFacts(
  toolResults: AssistantToolResult[],
): AssistantToolResult[] {
  return toolResults.map(result => ({
    ...result,
    facts: result.facts.length > 0 ? result.facts : buildStepFacts(result.summary, result.entityRefs),
  }));
}
