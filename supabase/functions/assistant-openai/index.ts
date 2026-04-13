import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  buildOpenAIResponsesPayload,
  isAssistantMessage,
  type OpenAIToolDefinition,
} from './openaiPayload.ts';
import { extractFunctionCalls, extractOutputText } from './openaiResponse.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5.4';
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const ALLOWED_OPENAI_MODELS = new Set([
  OPENAI_MODEL,
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
]);

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

function isToolDefinition(value: unknown): value is OpenAIToolDefinition {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'function'
    && 'name' in value
    && typeof value.name === 'string'
    && 'description' in value
    && typeof value.description === 'string'
    && 'parameters' in value;
}

function extractUsage(data: unknown) {
  return typeof data === 'object' && data !== null && 'usage' in data && typeof data.usage === 'object' && data.usage !== null
    ? {
        inputTokens: 'input_tokens' in data.usage && typeof data.usage.input_tokens === 'number' ? data.usage.input_tokens : undefined,
        outputTokens: 'output_tokens' in data.usage && typeof data.usage.output_tokens === 'number' ? data.usage.output_tokens : undefined,
        totalTokens: 'total_tokens' in data.usage && typeof data.usage.total_tokens === 'number' ? data.usage.total_tokens : undefined,
      }
    : undefined;
}

function stringifyRawResponse(data: unknown): string {
  return JSON.stringify({
    output_text: typeof data === 'object' && data !== null && 'output_text' in data ? data.output_text : undefined,
    output: typeof data === 'object' && data !== null && 'output' in data ? data.output : undefined,
  }, null, 2);
}

function resolveRequestedModel(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return OPENAI_MODEL;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return OPENAI_MODEL;
  }

  return ALLOWED_OPENAI_MODELS.has(normalized) ? normalized : null;
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

  const requestedModel = resolveRequestedModel('model' in body ? body.model : undefined);
  if (!requestedModel) {
    return jsonResponse({ error: 'Unsupported OpenAI model requested for the hosted assistant.' }, { status: 400 });
  }

  if (body.action === 'health') {
    return jsonResponse({
      ok: true,
      provider: 'openai',
      model: requestedModel,
    });
  }

  if (body.action !== 'chat' && body.action !== 'turn') {
    return jsonResponse({ error: `Unsupported action: ${body.action}` }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0 || !messages.every(isAssistantMessage)) {
    return jsonResponse({ error: 'messages must be a non-empty array of assistant messages.' }, { status: 400 });
  }

  if (
    body.action === 'chat'
    && (typeof body.format !== 'object' || body.format === null || Array.isArray(body.format))
  ) {
    return jsonResponse({ error: 'format must be a JSON schema object.' }, { status: 400 });
  }

  if (
    body.action === 'turn'
    && body.format !== undefined
    && (typeof body.format !== 'object' || body.format === null || Array.isArray(body.format))
  ) {
    return jsonResponse({ error: 'format must be a JSON schema object when provided.' }, { status: 400 });
  }

  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (body.action === 'turn' && tools.some(tool => !isToolDefinition(tool))) {
    return jsonResponse({ error: 'tools must be valid OpenAI function tool definitions.' }, { status: 400 });
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAIResponsesPayload({
      model: requestedModel,
      messages,
      format: typeof body.format === 'object' && body.format !== null && !Array.isArray(body.format)
        ? body.format
        : undefined,
      tools: body.action === 'turn'
        ? tools
        : undefined,
    })),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return jsonResponse(
      { error: `OpenAI error ${response.status}: ${getOpenAIErrorMessage(data)}` },
      { status: 502 },
    );
  }

  const usage = extractUsage(data);
  const rawResponse = stringifyRawResponse(data);

  if (body.action === 'turn') {
    const toolCalls = extractFunctionCalls(data);
    if (toolCalls.length > 0) {
      return jsonResponse({
        ok: true,
        provider: 'openai',
        model: requestedModel,
        turn: {
          type: 'tool_calls',
          toolCalls,
        },
        rawResponse,
        usage,
      });
    }

    const text = extractOutputText(data).trim();
    if (!text) {
      return jsonResponse({ error: 'OpenAI returned neither output_text nor tool calls.' }, { status: 502 });
    }

    return jsonResponse({
      ok: true,
      provider: 'openai',
      model: requestedModel,
      turn: {
        type: 'text',
        text,
      },
      rawResponse,
      usage,
    });
  }

  const text = extractOutputText(data).trim();
  if (!text) {
    return jsonResponse({ error: 'OpenAI returned no output_text.' }, { status: 502 });
  }

  return jsonResponse({
    ok: true,
    provider: 'openai',
    model: requestedModel,
    text,
    usage,
  });
});
