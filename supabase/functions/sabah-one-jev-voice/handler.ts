import { VOICE, buildVoiceQuestions, readVoiceDecision, validateVoiceInput } from '../_shared/jevVoice.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

export const SPEECH = {
  grantUrl: 'https://api.deepgram.com/v1/auth/grant', ttlSeconds: 30,
  action: 'speech_token', decisionAction: 'decide',
} as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP = { ok: 200, badRequest: 400, unauthorized: 401, forbidden: 403, method: 405, tooLarge: 413, rateLimit: 429, upstream: 502, unavailable: 503 } as const;
const PROVIDER_NAMES = { jev: /typesafe|jev/i, speech: /deepgram/i } as const;

export interface VoiceServerDependencies {
  /** Returns an account-scoped reader only after verifying a first-party user token. */
  authorize: (request: Request) => Promise<null | {
    readKey: (secretId: string, provider: 'jev' | 'speech') => Promise<string | null>;
  }>;
  fetch: typeof fetch;
  deploymentSha: string;
}

export const VOICE_PROVIDER_NAMES = PROVIDER_NAMES;

export function createVoiceHandler(dependencies: VoiceServerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (request.method === 'GET') return jsonResponse({ prototype: 'jev-voice', deploySha: dependencies.deploymentSha, model: VOICE.model });
    if (request.method !== 'POST') return jsonResponse({ message: 'Use POST.' }, { status: HTTP.method });
    let stage = 'authentication';
    try {
      const account = await dependencies.authorize(request);
      if (!account) return jsonResponse({ message: 'Sign in to Sabah One again.' }, { status: HTTP.unauthorized });
      const bodyText = await request.text();
      if (bodyText.length > VOICE.maxBody) return jsonResponse({ message: 'Voice request is too large.' }, { status: HTTP.tooLarge });
      let body: Record<string, unknown>;
      try { body = JSON.parse(bodyText); } catch { return jsonResponse({ message: 'Invalid voice request.' }, { status: HTTP.badRequest }); }
      if (!body || typeof body !== 'object' || typeof body.secretId !== 'string' || !UUID_PATTERN.test(body.secretId)) {
        return jsonResponse({ message: 'Choose a provider API key saved in your Vault.' }, { status: HTTP.badRequest });
      }
      const speech = body.action === SPEECH.action;
      if (!speech && body.action !== SPEECH.decisionAction) return jsonResponse({ message: 'Unsupported voice operation.' }, { status: HTTP.badRequest });
      let input;
      if (!speech) {
        try { input = validateVoiceInput(body.input); } catch { return jsonResponse({ message: 'Invalid voice command or item list.' }, { status: HTTP.badRequest }); }
      }
      stage = 'vault';
      const key = await account.readKey(body.secretId, speech ? 'speech' : 'jev');
      if (!key) return jsonResponse({ message: 'That provider key is unavailable in your Vault. Check its label, type and archive state.' }, { status: HTTP.forbidden });
      const started = performance.now();
      stage = 'provider';
      const upstream = await dependencies.fetch(speech ? SPEECH.grantUrl : VOICE.endpoint, {
        method: 'POST', headers: { Authorization: `${speech ? 'Token' : 'Bearer'} ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(speech ? { ttl_seconds: SPEECH.ttlSeconds } : buildVoiceQuestions(input!)),
        signal: AbortSignal.timeout(VOICE.timeoutMs),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return jsonResponse({ message: `${speech ? 'Deepgram' : 'TypeSafe'} refused the request (HTTP ${upstream.status}). Check the provider key and credits.`, providerStatus: upstream.status },
          { status: upstream.status === HTTP.rateLimit ? HTTP.rateLimit : HTTP.upstream });
      }
      stage = 'response';
      const value = await upstream.json();
      if (speech) {
        if (typeof value?.access_token !== 'string' || !value.access_token || typeof value.expires_in !== 'number') {
          throw new Error('Invalid speech token response.');
        }
        return jsonResponse({ accessToken: value.access_token, expiresIn: value.expires_in }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return jsonResponse(readVoiceDecision(value, input!, Math.round(performance.now() - started)), { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Never expose a provider body, credential, transcript or exception to logs or responses.
      return jsonResponse({ message: `Voice service could not finish the request (${stage}). Retry when the provider is available.`, stage }, { status: HTTP.unavailable });
    }
  };
}
