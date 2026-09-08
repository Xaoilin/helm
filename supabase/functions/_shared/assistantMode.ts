import { ASSISTANT_DEPLOY_SHA } from './assistantDeployment.ts';
import { jsonResponse } from './cors.ts';

// Provider work requires an explicit server-side opt-in. Missing/invalid values pause it.
export const HOSTED_AI_ENABLED = Deno.env.get('HOSTED_AI_ENABLED') === 'true';
export const HOSTED_AI_PAUSED_MESSAGE = 'Hosted AI is paused. Use the app controls directly; chat and voice AI will return when hosted AI is re-enabled.';

export function hostedAIPausedResponse(): Response {
  return jsonResponse({
    ok: false,
    code: 'hosted_ai_paused',
    mode: 'paused',
    error: HOSTED_AI_PAUSED_MESSAGE,
    deploymentSha: ASSISTANT_DEPLOY_SHA,
  }, { status: 503 });
}
