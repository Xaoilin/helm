import { createOperationalHandler } from './handler.ts';
import { verifyOperationalUser } from './auth.ts';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';

Deno.serve(createOperationalHandler({
  now: Date.now,
  enabled: () => Deno.env.get('OPERATIONAL_TELEMETRY_ENABLED') !== 'false',
  authenticate: token => verifyOperationalUser(token, {
    url: Deno.env.get('SUPABASE_URL') || '', key: Deno.env.get('SUPABASE_ANON_KEY') || '',
  }),
  emit: event => console.info(JSON.stringify({ schema: 'sabah-one/operational-event/v1', ...event, collectorRelease: ASSISTANT_DEPLOY_SHA })),
}));
