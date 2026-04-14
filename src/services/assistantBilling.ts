import type {
  AssistantMessageBilling,
  AssistantReplyProvider,
  AssistantTokenUsageTotals,
  ChatConversation,
  OpenAIAssistantRequestBilling,
} from '../types/domain';

export interface HostedAssistantUsageSnapshot extends AssistantTokenUsageTotals {
  responseId?: string;
  model: string;
  serviceTier?: string;
}

export interface ConversationAssistantBillingSummary {
  totalEstimatedUsd: number;
  requestCount: number;
  openAITurnCount: number;
  totals: AssistantTokenUsageTotals;
  hasExcludedAssistantTurns: boolean;
}

type SupportedOpenAIModel = 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano';

interface OpenAIModelPricing {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const TOKEN_DIVISOR = 1_000_000;

const OPENAI_MODEL_PRICING: Record<SupportedOpenAIModel, OpenAIModelPricing> = {
  'gpt-5.4': {
    inputUsdPerMillion: 2.5,
    cachedInputUsdPerMillion: 0.25,
    outputUsdPerMillion: 15,
  },
  'gpt-5.4-mini': {
    inputUsdPerMillion: 0.75,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 4.5,
  },
  'gpt-5.4-nano': {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 1.25,
  },
};

export const OPENAI_USAGE_ESTIMATE_LABEL = 'Estimated from OpenAI usage';

export function normalizeOpenAIBillingModel(model: string): SupportedOpenAIModel | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('gpt-5.4-mini')) return 'gpt-5.4-mini';
  if (normalized.startsWith('gpt-5.4-nano')) return 'gpt-5.4-nano';
  if (normalized.startsWith('gpt-5.4')) return 'gpt-5.4';
  return null;
}

export function createEmptyAssistantTokenTotals(): AssistantTokenUsageTotals {
  return {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function sumAssistantTokenTotals(
  groups: Array<Partial<AssistantTokenUsageTotals> | undefined | null>,
): AssistantTokenUsageTotals {
  return groups.reduce<AssistantTokenUsageTotals>((totals, group) => ({
    inputTokens: totals.inputTokens + Math.max(0, group?.inputTokens ?? 0),
    cachedTokens: totals.cachedTokens + Math.max(0, group?.cachedTokens ?? 0),
    outputTokens: totals.outputTokens + Math.max(0, group?.outputTokens ?? 0),
    reasoningTokens: totals.reasoningTokens + Math.max(0, group?.reasoningTokens ?? 0),
    totalTokens: totals.totalTokens + Math.max(0, group?.totalTokens ?? 0),
  }), createEmptyAssistantTokenTotals());
}

export function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

export function estimateOpenAICostUsd(usage: HostedAssistantUsageSnapshot): number | null {
  const model = normalizeOpenAIBillingModel(usage.model);
  if (!model) return null;

  const pricing = OPENAI_MODEL_PRICING[model];
  const cachedInputTokens = Math.min(Math.max(usage.cachedTokens, 0), Math.max(usage.inputTokens, 0));
  const uncachedInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);

  return roundUsd(
    (uncachedInputTokens / TOKEN_DIVISOR) * pricing.inputUsdPerMillion
      + (cachedInputTokens / TOKEN_DIVISOR) * pricing.cachedInputUsdPerMillion
      + (Math.max(usage.outputTokens, 0) / TOKEN_DIVISOR) * pricing.outputUsdPerMillion,
  );
}

export function buildOpenAIRequestBilling(
  kind: OpenAIAssistantRequestBilling['kind'],
  usage: HostedAssistantUsageSnapshot | undefined,
): OpenAIAssistantRequestBilling | null {
  if (!usage) return null;

  const estimatedUsd = estimateOpenAICostUsd(usage);
  if (estimatedUsd === null) return null;

  return {
    kind,
    responseId: usage.responseId,
    model: usage.model,
    serviceTier: usage.serviceTier,
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    estimatedUsd,
  };
}

export function buildOpenAIAssistantBilling(
  requests: OpenAIAssistantRequestBilling[],
): AssistantMessageBilling | undefined {
  if (requests.length === 0) return undefined;

  const normalizedModels = [...new Set(requests.map(request => normalizeOpenAIBillingModel(request.model) || request.model))];
  const totals = sumAssistantTokenTotals(requests);

  return {
    provider: 'openai',
    model: normalizedModels.length === 1 ? normalizedModels[0] : 'mixed',
    requestCount: requests.length,
    requests,
    totals,
    estimatedUsd: roundUsd(requests.reduce((sum, request) => sum + request.estimatedUsd, 0)),
    estimateStatus: 'estimated_from_openai_usage',
    estimateLabel: OPENAI_USAGE_ESTIMATE_LABEL,
  };
}

export function mergeAssistantMessageBilling(
  ...billings: Array<AssistantMessageBilling | undefined>
): AssistantMessageBilling | undefined {
  const defined = billings.filter((billing): billing is AssistantMessageBilling => billing !== undefined);
  if (defined.length === 0) return undefined;

  const openAIRequests = defined
    .filter(billing => billing.provider === 'openai')
    .flatMap(billing => billing.requests);

  if (openAIRequests.length > 0) {
    return buildOpenAIAssistantBilling(openAIRequests);
  }

  return defined[defined.length - 1];
}

export function buildProviderOnlyAssistantBilling(
  provider: AssistantReplyProvider,
  model?: string,
): AssistantMessageBilling {
  return {
    provider,
    model,
    requestCount: 0,
    requests: [],
  };
}

export function summarizeConversationAssistantBilling(
  conversation: ChatConversation | null | undefined,
): ConversationAssistantBillingSummary | null {
  if (!conversation) return null;

  const assistantMessages = conversation.messages.filter(
    message => message.role === 'assistant' && message.assistantBilling,
  );
  const openAIMessages = assistantMessages.filter(
    message => message.assistantBilling?.provider === 'openai' && typeof message.assistantBilling.estimatedUsd === 'number',
  );

  if (openAIMessages.length === 0) {
    return null;
  }

  return {
    totalEstimatedUsd: roundUsd(openAIMessages.reduce(
      (sum, message) => sum + (message.assistantBilling?.estimatedUsd ?? 0),
      0,
    )),
    requestCount: openAIMessages.reduce(
      (sum, message) => sum + (message.assistantBilling?.requestCount ?? 0),
      0,
    ),
    openAITurnCount: openAIMessages.length,
    totals: sumAssistantTokenTotals(openAIMessages.map(message => message.assistantBilling?.totals)),
    hasExcludedAssistantTurns: assistantMessages.some(
      message => message.assistantBilling?.provider !== 'openai',
    ),
  };
}

export function formatUsdEstimate(value: number): string {
  if (value >= 1) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatCurrencyAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency.toUpperCase()} ${value.toFixed(2)}`;
  }
}

export function formatAssistantTokenCount(value: number): string {
  return value.toLocaleString('en-US');
}
