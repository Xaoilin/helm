import { jsonResponse } from './cors.ts';
import { ASSISTANT_DEPLOY_SHA } from './assistantDeployment.ts';

type AssistantIdentity = { kind: 'user'; billingOperator: boolean } | { kind: 'benchmark' };

function signInRequired(): Response {
  return jsonResponse({ code: 'sign_in_required', error: 'Sign in to Sabah One again to use hosted AI.' }, { status: 401 });
}

function authUnavailable(category: string, status?: number): Response {
  // Never log the token, Auth response body, or unsanitized network exception.
  console.warn('Hosted assistant identity verification failed', { category, ...(status ? { status } : {}) });
  return jsonResponse({ code: 'auth_unavailable', error: 'Hosted sign-in verification is unavailable. Try again later.' }, { status: 503 });
}

async function verifyBenchmark(token: string): Promise<boolean> {
  const match = /^benchmark\.([a-f0-9]{40})\.([0-9]{10})\.([a-f0-9]{64})$/u.exec(token);
  const secret = Deno.env.get('ASSISTANT_BENCHMARK_SECRET') || '';
  if (!match || secret.length < 32 || match[1] !== ASSISTANT_DEPLOY_SHA) return false;
  const expires = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + 300) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  const signature = Uint8Array.from(match[3].match(/../gu)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(`assistant-benchmark:${match[1]}:${expires}`));
}

export async function authenticateAssistant(request: Request, allowBenchmark = false): Promise<AssistantIdentity | Response> {
  const token = /^Bearer (\S+)$/iu.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) return signInRequired();
  if (token.startsWith('benchmark.')) {
    return allowBenchmark && await verifyBenchmark(token) ? { kind: 'benchmark' } : signInRequired();
  }

  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !key) {
    return authUnavailable('configuration');
  }
  if (token === key || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return signInRequired();

  try {
    // This Auth service request verifies the token and returns current, server-owned app metadata.
    const response = await fetch(`${url.replace(/\/$/u, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) return signInRequired();
    if (!response.ok) return authUnavailable('auth_service_http', response.status);
    const user = await response.json();
    if (typeof user?.id !== 'string' || !user.id || user.role !== 'authenticated' || user.is_anonymous === true) {
      return signInRequired();
    }
    return { kind: 'user', billingOperator: user.app_metadata?.assistant_billing_operator === true };
  } catch (error) {
    return authUnavailable(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_or_response');
  }
}
