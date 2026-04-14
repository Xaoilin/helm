import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  buildLastSevenUtcDayRange,
  buildOpenAIOrganizationUrl,
  extractCostBuckets,
  extractUsageBuckets,
} from './openaiBilling.ts';

const OPENAI_ADMIN_KEY = Deno.env.get('OPENAI_ADMIN_KEY') || '';
const OPENAI_PROJECT_ID = Deno.env.get('OPENAI_PROJECT_ID') || '';

function getOpenAIErrorMessage(data: unknown): string {
  if (typeof data !== 'object' || data === null || !('error' in data)) {
    return 'Unknown OpenAI error';
  }

  const error = data.error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unknown OpenAI error';
}

async function fetchOpenAIJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OPENAI_ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${getOpenAIErrorMessage(data)}`);
  }

  return data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!OPENAI_ADMIN_KEY) {
    return jsonResponse(
      { error: 'OPENAI_ADMIN_KEY is not configured for hosted billing.' },
      { status: 503 },
    );
  }

  if (!OPENAI_PROJECT_ID) {
    return jsonResponse(
      { error: 'OPENAI_PROJECT_ID is not configured for hosted billing.' },
      { status: 503 },
    );
  }

  const range = buildLastSevenUtcDayRange();

  try {
    const [costsRaw, usageRaw] = await Promise.all([
      fetchOpenAIJson(buildOpenAIOrganizationUrl('/v1/organization/costs', {
        start_time: range.startTime,
        end_time: range.endTime,
        bucket_width: '1d',
        limit: 7,
        project_ids: [OPENAI_PROJECT_ID],
      })),
      fetchOpenAIJson(buildOpenAIOrganizationUrl('/v1/organization/usage/completions', {
        start_time: range.startTime,
        end_time: range.endTime,
        bucket_width: '1d',
        limit: 7,
        project_ids: [OPENAI_PROJECT_ID],
        group_by: ['model', 'service_tier'],
      })),
    ]);

    return jsonResponse({
      ok: true,
      projectId: OPENAI_PROJECT_ID,
      fetchedAt: new Date().toISOString(),
      costs: extractCostBuckets(costsRaw),
      usage: extractUsageBuckets(usageRaw),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
});
