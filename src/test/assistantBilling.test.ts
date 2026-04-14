import { describe, expect, it } from 'vitest';
import type { ChatConversation } from '../types/domain';
import {
  buildOpenAIAssistantBilling,
  buildOpenAIRequestBilling,
  buildProviderOnlyAssistantBilling,
  estimateOpenAICostUsd,
  summarizeConversationAssistantBilling,
} from '../services/assistantBilling';

describe('assistantBilling', () => {
  it('estimates GPT-5.4 costs from OpenAI usage', () => {
    expect(estimateOpenAICostUsd({
      model: 'gpt-5.4',
      inputTokens: 1_000_000,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 1_000_000,
    })).toBe(2.5);
  });

  it('estimates GPT-5.4 mini costs with cached tokens', () => {
    expect(estimateOpenAICostUsd({
      model: 'gpt-5.4-mini',
      inputTokens: 1_000_000,
      cachedTokens: 200_000,
      outputTokens: 100_000,
      reasoningTokens: 60_000,
      totalTokens: 1_100_000,
    })).toBe(1.065);
  });

  it('uses output token totals while preserving reasoning-token usage details', () => {
    expect(estimateOpenAICostUsd({
      model: 'gpt-5.4-nano',
      inputTokens: 500_000,
      cachedTokens: 100_000,
      outputTokens: 400_000,
      reasoningTokens: 250_000,
      totalTokens: 900_000,
    })).toBe(0.582);
  });

  it('aggregates planner and narration requests into one assistant-turn estimate', () => {
    const planner = buildOpenAIRequestBilling('planner', {
      responseId: 'resp-plan',
      model: 'gpt-5.4',
      serviceTier: 'default',
      inputTokens: 1_000,
      cachedTokens: 100,
      outputTokens: 200,
      reasoningTokens: 120,
      totalTokens: 1_200,
    });
    const narration = buildOpenAIRequestBilling('narration', {
      responseId: 'resp-narration',
      model: 'gpt-5.4',
      serviceTier: 'default',
      inputTokens: 600,
      cachedTokens: 50,
      outputTokens: 120,
      reasoningTokens: 70,
      totalTokens: 720,
    });

    const billing = buildOpenAIAssistantBilling([planner, narration].filter(Boolean));

    expect(billing).toEqual(expect.objectContaining({
      provider: 'openai',
      requestCount: 2,
      estimatedUsd: 0.008463,
      totals: {
        inputTokens: 1_600,
        cachedTokens: 150,
        outputTokens: 320,
        reasoningTokens: 190,
        totalTokens: 1_920,
      },
    }));
  });

  it('summarizes conversations using hosted OpenAI turns only and excludes other providers', () => {
    const conversation: ChatConversation = {
      id: 'conv-1',
      title: 'Billing test',
      createdAt: '2026-04-14T09:00:00.000Z',
      updatedAt: '2026-04-14T09:10:00.000Z',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Show my tasks.',
          timestamp: '2026-04-14T09:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Opening your tasks.',
          timestamp: '2026-04-14T09:00:05.000Z',
          assistantBilling: buildOpenAIAssistantBilling([
            buildOpenAIRequestBilling('planner', {
              responseId: 'resp-1',
              model: 'gpt-5.4',
              serviceTier: 'default',
              inputTokens: 1_000,
              cachedTokens: 100,
              outputTokens: 200,
              reasoningTokens: 120,
              totalTokens: 1_200,
            })!,
          ])!,
        },
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'I can still help locally.',
          timestamp: '2026-04-14T09:00:09.000Z',
          assistantBilling: buildProviderOnlyAssistantBilling('local', 'local-fallback'),
        },
        {
          id: 'msg-4',
          role: 'assistant',
          content: 'Saved.',
          timestamp: '2026-04-14T09:00:12.000Z',
          assistantBilling: buildOpenAIAssistantBilling([
            buildOpenAIRequestBilling('planner', {
              responseId: 'resp-2',
              model: 'gpt-5.4-mini',
              serviceTier: 'default',
              inputTokens: 500,
              cachedTokens: 100,
              outputTokens: 100,
              reasoningTokens: 40,
              totalTokens: 600,
            })!,
          ])!,
        },
      ],
    };

    expect(summarizeConversationAssistantBilling(conversation)).toEqual({
      totalEstimatedUsd: 0.006033,
      requestCount: 2,
      openAITurnCount: 2,
      totals: {
        inputTokens: 1_500,
        cachedTokens: 200,
        outputTokens: 300,
        reasoningTokens: 160,
        totalTokens: 1_800,
      },
      hasExcludedAssistantTurns: true,
    });
  });
});
