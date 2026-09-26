/**
 * Supabase OAuth 2.1 server calls for the consent page: read a pending
 * authorization request, then approve or deny it without a browser redirect so
 * the caller decides when to leave the page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getClient } from './client';

export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
}

/** A pending request to review, or a request Supabase already resolved. */
export type OAuthAuthorizationLookup =
  | { kind: 'pending'; details: OAuthAuthorizationDetails }
  | { kind: 'resolved'; redirectUrl: string };

function requireOAuthServer(): SupabaseClient['auth']['oauth'] {
  const database = getClient();
  if (!database) throw new Error('Sabah One database configuration is unavailable.');
  return database.auth.oauth;
}

export async function getOAuthAuthorization(authorizationId: string): Promise<OAuthAuthorizationLookup> {
  const { data, error } = await requireOAuthServer().getAuthorizationDetails(authorizationId);
  if (error || !data) {
    throw new Error(error?.message || 'This authorization request is unavailable or expired.');
  }
  if ('redirect_url' in data) return { kind: 'resolved', redirectUrl: data.redirect_url };
  return { kind: 'pending', details: data as OAuthAuthorizationDetails };
}

/** Approve the request and return the client redirect URL. */
export async function approveOAuthAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await requireOAuthServer().approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) {
    throw error || new Error('OAuth approval did not return a redirect.');
  }
  return data.redirect_url;
}

/** Deny the request and return the client redirect URL. */
export async function denyOAuthAuthorization(authorizationId: string): Promise<string> {
  const { data, error } = await requireOAuthServer().denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) {
    throw new Error(error?.message || 'The authorization request could not be denied.');
  }
  return data.redirect_url;
}
