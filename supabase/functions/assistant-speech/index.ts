import { authenticateAssistant } from '../_shared/assistantAuth.ts';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';
import { HOSTED_AI_ENABLED, hostedAIPausedResponse } from '../_shared/assistantMode.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function failure(status: number, code: string, error: string): Response {
  return jsonResponse({ code, error, deploymentSha: ASSISTANT_DEPLOY_SHA }, { status });
}

async function handle(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'Use POST.');
  const identity = await authenticateAssistant(request);
  if (identity instanceof Response) return identity;
  if (!HOSTED_AI_ENABLED) return hostedAIPausedResponse();

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 40_000) return failure(413, 'speech_too_long', 'Use at most 5,000 characters.');
    body = JSON.parse(raw);
  } catch {
    return failure(400, 'invalid_speech_request', 'Provide text, a Secrets reference and a public voice ID.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['text', 'secretId', 'voiceId'].includes(key))
    || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 5_000
    || typeof body.secretId !== 'string' || !UUID.test(body.secretId)
    || typeof body.voiceId !== 'string' || !/^[a-z0-9]{1,100}$/iu.test(body.voiceId)) {
    return failure(400, 'invalid_speech_request', 'Provide text, a Secrets reference and a public voice ID.');
  }

  // The caller's verified JWT is passed unchanged to the existing ownership RPCs.
  // No service-role client or alternative Vault store is involved.
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/u, '');
  const headers = {
    apikey: Deno.env.get('SUPABASE_ANON_KEY') || '',
    Authorization: request.headers.get('Authorization')!,
    'Content-Type': 'application/json',
  };
  const rpc = (name: string, payload: object) => fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
  });
  let stage = 'vault_metadata';
  try {
    const metadata = await rpc('list_helm_secrets', {});
    if (!metadata.ok) return failure(503, 'voice_setup_unavailable', 'Voice setup is unavailable. Browser speech is available instead.');
    const summaries = await metadata.json();
    const owned = Array.isArray(summaries?.secrets) && summaries.secrets.some((entry: {
      secretId?: string; kind?: string; archivedAt?: string | null;
    }) => entry.secretId === body.secretId && entry.kind === 'api_key' && entry.archivedAt === null);
    if (!owned) return failure(404, 'voice_reference_unavailable', 'Choose an active API key from your account in Secrets.');

    stage = 'vault_value';
    const revealed = await rpc('reveal_helm_secret', { p_secret_id: body.secretId });
    if (!revealed.ok) return failure(404, 'voice_reference_unavailable', 'The selected voice reference is unavailable. Check Secrets.');
    const detail = await revealed.json();
    if (detail?.secretId !== body.secretId || typeof detail.value !== 'string'
      || !detail.value.trim() || /[\r\n]/u.test(detail.value)) {
      return failure(404, 'voice_reference_unavailable', 'The selected voice reference is unavailable. Check Secrets.');
    }

    stage = 'synthesis';
    const audio = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${body.voiceId}?output_format=mp3_44100_128`, {
      method: 'POST', redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      headers: { 'xi-api-key': detail.value, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: body.text, model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 } }),
    });
    if (!audio.ok || audio.headers.get('Content-Type')?.split(';')[0].trim() !== 'audio/mpeg') {
      // Upstream bodies and headers may echo submitted values; never return or log them.
      console.warn('Speech provider unavailable', { status: audio.status });
      return failure(502, 'speech_provider_unavailable', 'ElevenLabs is unavailable. Check the selected API key and voice in Settings, or use browser speech.');
    }
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const mp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
      || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    if (!mp3) return failure(502, 'invalid_speech_audio', 'Voice audio was invalid. Browser speech is available instead.');
    return new Response(bytes, { headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' } });
  } catch {
    console.warn('Speech request unavailable', { stage });
    return failure(503, 'speech_unavailable', 'Voice is temporarily unavailable. Browser speech is available instead.');
  }
}

Deno.serve(async request => {
  const response = await handle(request);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Helm-Deployment-Sha', ASSISTANT_DEPLOY_SHA);
  return response;
});
