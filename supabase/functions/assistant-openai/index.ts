import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  buildOpenAIResponsesPayload,
  isAssistantMessage,
} from './openaiPayload.ts';
import { extractOutputText } from './openaiResponse.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5.4';
const OPENAI_URL = 'https://api.openai.com/v1/responses';

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse(
      { error: 'OPENAI_API_KEY is not configured for the hosted assistant.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('action' in body) || typeof body.action !== 'string') {
    return jsonResponse({ error: 'Missing action.' }, { status: 400 });
  }

  if (body.action === 'health') {
    return jsonResponse({
      ok: true,
      provider: 'openai',
      model: OPENAI_MODEL,
    });
  }

  if (body.action !== 'chat') {
    return jsonResponse({ error: `Unsupported action: ${body.action}` }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0 || !messages.every(isAssistantMessage)) {
    return jsonResponse({ error: 'messages must be a non-empty array of assistant messages.' }, { status: 400 });
  }

  if (typeof body.format !== 'object' || body.format === null || Array.isArray(body.format)) {
    return jsonResponse({ error: 'format must be a JSON schema object.' }, { status: 400 });
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAIResponsesPayload({
      model: OPENAI_MODEL,
      messages,
      format: body.format,
    })),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return jsonResponse(
      { error: `OpenAI error ${response.status}: ${getOpenAIErrorMessage(data)}` },
      { status: 502 },
    );
  }

  const text = extractOutputText(data).trim();
  if (!text) {
    return jsonResponse({ error: 'OpenAI returned no output_text.' }, { status: 502 });
  }

  const usage = typeof data === 'object' && data !== null && 'usage' in data && typeof data.usage === 'object' && data.usage !== null
    ? {
        inputTokens: 'input_tokens' in data.usage && typeof data.usage.input_tokens === 'number' ? data.usage.input_tokens : undefined,
        outputTokens: 'output_tokens' in data.usage && typeof data.usage.output_tokens === 'number' ? data.usage.output_tokens : undefined,
        totalTokens: 'total_tokens' in data.usage && typeof data.usage.total_tokens === 'number' ? data.usage.total_tokens : undefined,
      }
    : undefined;

  return jsonResponse({
    ok: true,
    provider: 'openai',
    model: OPENAI_MODEL,
    text,
    usage,
  });
});
