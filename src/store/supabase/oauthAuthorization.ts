/** Spring OAuth consent bridge. Tokens/codes and redirect decisions remain owned by the backend. */
import { accessRequest, accessServiceUrl } from './client';

export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: { id: string; name: string };
  user: { id: string; email: string };
}
export type OAuthAuthorizationLookup = { kind: 'pending'; details: OAuthAuthorizationDetails };
export async function getOAuthAuthorization(authorizationId: string): Promise<OAuthAuthorizationLookup> {
  const details = await accessRequest<OAuthAuthorizationDetails>(`/consent/${encodeURIComponent(authorizationId)}`);
  return { kind: 'pending', details };
}

/** A top-level form lets the authorization server redirect directly to the registered agent callback. */
export async function submitOAuthAuthorization(details: OAuthAuthorizationDetails, allow: boolean): Promise<void> {
  const csrf = await accessRequest<{ headerName: string; token: string }>('/csrf');
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = accessServiceUrl('/oauth2/authorize');
  const fields: Record<string, string> = {
    client_id: details.client.id, state: details.authorization_id, _csrf: csrf.token,
  };
  if (allow) fields.scope = details.scope;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  form.remove();
}
