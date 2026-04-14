import { describe, expect, it } from 'vitest';
import {
  buildLastSevenUtcDayRange,
  extractCostBuckets,
  extractUsageBuckets,
} from '../../supabase/functions/assistant-openai-billing/openaiBilling';

describe('openaiBilling helpers', () => {
  it('builds the last seven UTC day range', () => {
    expect(buildLastSevenUtcDayRange(new Date('2026-04-14T15:30:00.000Z'))).toEqual({
      startTime: 1_775_606_400,
      endTime: 1_776_211_200,
    });
  });

  it('extracts and sums project cost buckets from OpenAI responses', () => {
    expect(extractCostBuckets({
      data: [
        {
          start_time: 1_775_606_400,
          end_time: 1_775_692_800,
          results: [
            {
              amount: {
                currency: 'usd',
                value: 1.25,
              },
            },
            {
              amount: {
                currency: 'usd',
                value: 0.75,
              },
            },
          ],
        },
      ],
    })).toEqual([
      {
        startTime: 1_775_606_400,
        endTime: 1_775_692_800,
        amount: {
          currency: 'usd',
          value: 2,
        },
      },
    ]);
  });

  it('extracts usage buckets from result and results arrays and sorts rows', () => {
    expect(extractUsageBuckets({
      data: [
        {
          start_time: 1_775_692_800,
          end_time: 1_775_779_200,
          result: [
            {
              model: 'gpt-5.4-mini',
              service_tier: 'priority',
              input_tokens: 200,
              input_cached_tokens: 20,
              output_tokens: 40,
              num_model_requests: 3,
            },
            {
              model: 'gpt-5.4',
              service_tier: 'default',
              input_tokens: 100,
              input_cached_tokens: 10,
              output_tokens: 30,
              num_model_requests: 2,
            },
          ],
        },
        {
          start_time: 1_775_606_400,
          end_time: 1_775_692_800,
          results: [
            {
              model: 'gpt-5.4-nano',
              service_tier: 'default',
              input_tokens: 50,
              input_cached_tokens: 5,
              output_tokens: 10,
              num_model_requests: 1,
            },
          ],
        },
      ],
    })).toEqual([
      {
        startTime: 1_775_606_400,
        endTime: 1_775_692_800,
        results: [
          {
            model: 'gpt-5.4-nano',
            serviceTier: 'default',
            inputTokens: 50,
            cachedTokens: 5,
            outputTokens: 10,
            totalRequests: 1,
          },
        ],
      },
      {
        startTime: 1_775_692_800,
        endTime: 1_775_779_200,
        results: [
          {
            model: 'gpt-5.4',
            serviceTier: 'default',
            inputTokens: 100,
            cachedTokens: 10,
            outputTokens: 30,
            totalRequests: 2,
          },
          {
            model: 'gpt-5.4-mini',
            serviceTier: 'priority',
            inputTokens: 200,
            cachedTokens: 20,
            outputTokens: 40,
            totalRequests: 3,
          },
        ],
      },
    ]);
  });
});
