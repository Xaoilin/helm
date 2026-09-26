/**
 * The OAuth consent approval transaction.
 *
 * Approving a client is two writes that must succeed together: the domain
 * allowlist row, then the Supabase authorization. If the authorization step
 * fails, the allowlist row is revoked again so a client never keeps domain
 * access for a request the user did not complete. A failed compensation is
 * reported alongside the original failure, never hidden.
 */

export interface OAuthConsentDependencies {
  /** Allow the client in the selected domain's database allowlist. */
  approveClientAccess(clientId: string, clientName: string): Promise<unknown>;
  /** Approve the Supabase authorization request and return the client redirect URL. */
  approveAuthorization(authorizationId: string): Promise<string>;
  /** Compensation: block the client in the selected domain's allowlist again. */
  revokeClientAccess(clientId: string): Promise<unknown>;
}

export interface OAuthConsentRequest {
  authorizationId: string;
  clientId: string;
  clientName: string;
  /** User-facing name of the approved area, e.g. "Employment". */
  areaLabel: string;
}

export type OAuthConsentOutcome =
  | { ok: true; redirectUrl: string }
  | {
    ok: false;
    /** User-facing message combining the failure and any rollback failure. */
    message: string;
    error: unknown;
    /** Present only when the compensating revoke also failed. */
    rollbackError?: unknown;
  };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function approveOAuthConsent(
  dependencies: OAuthConsentDependencies,
  request: OAuthConsentRequest,
): Promise<OAuthConsentOutcome> {
  try {
    await dependencies.approveClientAccess(request.clientId, request.clientName);
    const redirectUrl = await dependencies.approveAuthorization(request.authorizationId);
    return { ok: true, redirectUrl };
  } catch (error) {
    const message = describe(error);
    try {
      await dependencies.revokeClientAccess(request.clientId);
      return { ok: false, message, error };
    } catch (rollbackError) {
      return {
        ok: false,
        message: `${message} ${request.areaLabel} approval could not be rolled back: ${describe(rollbackError)}. `
          + `Revoke this client's ${request.areaLabel} access in Settings.`,
        error,
        rollbackError,
      };
    }
  }
}
