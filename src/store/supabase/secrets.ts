/** Optional account Secrets was retired by the owner during the DigitalOcean migration. */
import type { HelmSecretDetail, HelmSecretSummary, SaveHelmSecretInput } from '../../types/domain';
function retired(): never { throw new Error('Account Secrets is no longer available.'); }
export async function listHelmSecrets(): Promise<{ accountVersion: number; secrets: HelmSecretSummary[] }> { return retired(); }
export const revealHelmSecret: (secretId: string) => Promise<HelmSecretDetail> = async () => retired();
export const saveHelmSecret: (requestId: string, input: SaveHelmSecretInput) => Promise<HelmSecretSummary> = async () => retired();
export const setHelmSecretArchived: (requestId: string, secretId: string, archived: boolean) => Promise<HelmSecretSummary> = async () => retired();
