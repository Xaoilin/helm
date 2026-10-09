import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { getFreshAccessToken } from '../store/supabase/auth';
import type { VoiceDecision, VoiceInput } from '../../supabase/functions/_shared/jevVoice';

const VOICE_FUNCTION = '/functions/v1/sabah-one-jev-voice';
const VOICE_REQUEST_TIMEOUT_MS = 15_000;
const VOICE_OPERATION = { decide: 'decide', speech: 'speech_token' } as const;
const UNAUTHORIZED_STATUS = 401;

async function requestVoice<T>(body: unknown, signal: AbortSignal): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Sabah One voice is not configured.');
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS)]);
  async function send(forceRefresh: boolean) {
    const token = await getFreshAccessToken({ forceRefresh });
    if (!token) throw new Error('Sign in to Sabah One again.');
    boundedSignal.throwIfAborted();
    return fetch(`${SUPABASE_URL}${VOICE_FUNCTION}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: boundedSignal,
    });
  }
  let response = await send(false);
  if (response.status === UNAUTHORIZED_STATUS) {
    await response.body?.cancel();
    response = await send(true);
  }
  let value;
  try { value = await response.json(); } catch { throw new Error('Voice service returned an invalid response.'); }
  if (!response.ok) throw new Error(typeof value?.message === 'string' ? value.message : 'Voice service is unavailable.');
  return value as T;
}

export function decideVoiceCommand(secretId: string, input: VoiceInput, signal: AbortSignal): Promise<VoiceDecision> {
  return requestVoice({ action: VOICE_OPERATION.decide, secretId, input }, signal);
}

export async function getSpeechToken(secretId: string, signal: AbortSignal): Promise<string> {
  const value = await requestVoice<{ accessToken: string }>({ action: VOICE_OPERATION.speech, secretId }, signal);
  if (typeof value.accessToken !== 'string' || !value.accessToken) throw new Error('Deepgram returned an invalid speech token.');
  return value.accessToken;
}
