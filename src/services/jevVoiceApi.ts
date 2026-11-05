/** Historical voice interfaces are retained for copied editors; voice is outside Sabah One's product scope. */
import type { VoiceDecision, VoiceInput } from '../../supabase/functions/_shared/jevVoice';
export const decideVoiceCommand: (secretId: string, input: VoiceInput, signal: AbortSignal) => Promise<VoiceDecision> = async () => {
  throw new Error('Voice is not available in Sabah One.');
};
export const getSpeechToken: (secretId: string, signal: AbortSignal) => Promise<string> = async () => {
  throw new Error('Voice is not available in Sabah One.');
};
