import { createClient } from 'npm:@supabase/supabase-js@2.100.1';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';
import { createVoiceHandler } from './handler.ts';
import { authorizeVoiceAccount } from './authorization.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

Deno.serve(createVoiceHandler({
  deploymentSha: ASSISTANT_DEPLOY_SHA,
  fetch,
  authorize: async request => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return authorizeVoiceAccount(request, token => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }));
  },
}));
