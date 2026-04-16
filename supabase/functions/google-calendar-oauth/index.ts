import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') || '';
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') || '';
const GOOGLE_OAUTH_ALLOWED_ORIGINS = (Deno.env.get('GOOGLE_OAUTH_ALLOWED_ORIGINS') || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader';
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;
const GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_PATTERN = /could not find the table ['"]public\.google_calendar_credentials['"] in the schema cache/i;
const GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_MESSAGE = 'Hosted Google Calendar database schema is missing the google_calendar_credentials table. Apply the Supabase migration for durable Google Calendar credentials, then retry reconnecting or syncing.';

type CredentialOrigin = 'oauth_code' | 'profile_session';
type CredentialHealth = 'refreshable' | 'needs_reconnect' | 'revoked';
type FailureCode =
  | 'account_mismatch'
  | 'invalid_request'
  | 'missing_credential'
  | 'missing_refresh_token'
  | 'needs_reconnect'
  | 'oauth_not_configured'
  | 'revoked'
  | 'sign_in_required'
  | 'temporary_unavailable'
  | 'unauthorized_origin';

type Action =
  | 'exchange_code'
  | 'bootstrap_profile_session'
  | 'mint_access_token'
  | 'get_account_status'
  | 'revoke_account';

interface GoogleCalendarCredentialRow {
  user_id: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  scope: string | null;
  credential_origin: CredentialOrigin;
  last_refresh_at: string | null;
  last_refresh_failure_reason: string | null;
  last_refresh_failure_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole: string;
  selected?: boolean;
}

interface GoogleCalendarCredentialStatus {
  accountEmail: string;
  serverCredentialPresent: boolean;
  credentialHealth: CredentialHealth;
  currentAccessTokenExpiresAt?: string;
  scope?: string;
  lastRefreshAt?: string;
  lastRefreshFailureReason?: string;
  lastRefreshFailureAt?: string;
  credentialOrigin?: CredentialOrigin;
}

interface GoogleCalendarConnectedAccount {
  credential: GoogleCalendarCredentialStatus;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
}

interface GoogleCalendarMintedAccessToken {
  accessToken: string;
  credential: GoogleCalendarCredentialStatus;
}

interface GoogleTokenSuccessResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleTokenErrorResponse {
  error?: string;
  error_description?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
}

interface AuthenticatedUser {
  id: string;
  email?: string;
}

interface ActionRequest {
  action?: Action;
  code?: string;
  redirectUri?: string;
  expectedEmail?: string;
  email?: string;
  providerRefreshToken?: string | null;
  accountEmail?: string;
  accountEmails?: string[] | null;
}

interface FailurePayload {
  ok: false;
  error: FailureCode;
  message: string;
  accountEmail?: string;
  credential?: GoogleCalendarCredentialStatus;
  meta: ResponseMeta;
}

interface SuccessPayload<T> {
  ok: true;
  result: T;
  meta: ResponseMeta;
}

interface BackendReadiness {
  functionReachable: boolean;
  oauthConfigured: boolean;
  originAllowed: boolean;
  signedIn: boolean;
}

interface ResponseMeta {
  requestId: string;
  checkedAt: string;
  readiness: BackendReadiness;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function expiryFromNow(expiresInSeconds: number | undefined): string | undefined {
  if (typeof expiresInSeconds !== 'number' || !Number.isFinite(expiresInSeconds)) {
    return undefined;
  }
  return new Date(Date.now() + (expiresInSeconds * 1000)).toISOString();
}

function isLikelyReconnectReason(reason: string | null): boolean {
  if (!reason) return false;
  const normalized = reason.toLowerCase();
  return normalized.includes('invalid_grant')
    || normalized.includes('needs reconnect')
    || normalized.includes('reconnect')
    || normalized.includes('missing refresh token');
}

function toCredentialStatus(row: GoogleCalendarCredentialRow): GoogleCalendarCredentialStatus {
  const credentialHealth: CredentialHealth = row.revoked_at
    ? 'revoked'
    : isLikelyReconnectReason(row.last_refresh_failure_reason)
      ? 'needs_reconnect'
      : 'refreshable';

  return {
    accountEmail: row.google_email,
    serverCredentialPresent: true,
    credentialHealth,
    currentAccessTokenExpiresAt: row.access_token_expires_at || undefined,
    scope: row.scope || undefined,
    lastRefreshAt: row.last_refresh_at || undefined,
    lastRefreshFailureReason: row.last_refresh_failure_reason || undefined,
    lastRefreshFailureAt: row.last_refresh_failure_at || undefined,
    credentialOrigin: row.credential_origin,
  };
}

function success<T>(result: T, meta: ResponseMeta): Response {
  return jsonResponse({ ok: true, result, meta } satisfies SuccessPayload<T>);
}

function failure(
  error: FailureCode,
  message: string,
  options: {
    accountEmail?: string;
    credential?: GoogleCalendarCredentialStatus;
  } = {},
  meta: ResponseMeta,
): Response {
  return jsonResponse({
    ok: false,
    error,
    message,
    ...(options.accountEmail ? { accountEmail: options.accountEmail } : {}),
    ...(options.credential ? { credential: options.credential } : {}),
    meta,
  } satisfies FailurePayload);
}

function createResponseMeta(
  requestId: string,
  readiness: Partial<BackendReadiness> = {},
): ResponseMeta {
  return {
    requestId,
    checkedAt: nowIso(),
    readiness: {
      functionReachable: true,
      oauthConfigured: Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET),
      originAllowed: true,
      signedIn: false,
      ...readiness,
    },
  };
}

function unauthorizedOriginFailure(requestId: string): Response {
  return failure(
    'unauthorized_origin',
    'This browser origin is not allowed to use the hosted Google Calendar OAuth function.',
    {},
    createResponseMeta(requestId, { originAllowed: false }),
  );
}

function invalidRequest(message: string, meta: ResponseMeta): Response {
  return failure('invalid_request', message, {}, meta);
}

function oauthNotConfiguredFailure(requestId: string): Response {
  return failure(
    'oauth_not_configured',
    'Google Calendar OAuth is not configured on the hosted function. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
    {},
    createResponseMeta(requestId, { oauthConfigured: false }),
  );
}

function ensureOriginAllowed(request: Request, requestId: string): Response | null {
  if (GOOGLE_OAUTH_ALLOWED_ORIGINS.length === 0) return null;
  const origin = request.headers.get('origin');
  if (!origin) return unauthorizedOriginFailure(requestId);
  if (!GOOGLE_OAUTH_ALLOWED_ORIGINS.includes(origin)) {
    return unauthorizedOriginFailure(requestId);
  }
  return null;
}

function getEnvReadinessFailure(requestId: string): Response | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return failure(
      'temporary_unavailable',
      'Supabase function secrets are incomplete for Google Calendar OAuth.',
      {},
      createResponseMeta(requestId, { functionReachable: true }),
    );
  }
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    return oauthNotConfiguredFailure(requestId);
  }
  return null;
}

function normalizeCredentialTableErrorMessage(message: string): string {
  if (GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_PATTERN.test(message)) {
    return GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_MESSAGE;
  }

  return message;
}

function createAuthClient(authHeader: string | null) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

function createServiceRoleClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getAuthenticatedUser(request: Request, requestId: string): Promise<AuthenticatedUser | Response> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return failure(
      'sign_in_required',
      'Sign in to HELM to use durable Google Calendar sync in the browser.',
      {},
      createResponseMeta(requestId, { signedIn: false }),
    );
  }

  const authClient = createAuthClient(authHeader);
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    return failure(
      'sign_in_required',
      'Sign in to HELM to use durable Google Calendar sync in the browser.',
      {},
      createResponseMeta(requestId, { signedIn: false }),
    );
  }

  return {
    id: data.user.id,
    email: data.user.email || undefined,
  };
}

async function parseBody(request: Request, meta: ResponseMeta): Promise<ActionRequest | Response> {
  try {
    const body = await request.json();
    if (typeof body !== 'object' || body === null) {
      return invalidRequest('Request body must be a JSON object.', meta);
    }
    return body as ActionRequest;
  } catch {
    return invalidRequest('Invalid JSON body.', meta);
  }
}

async function exchangeGoogleToken(params: URLSearchParams): Promise<{
  ok: true;
  data: GoogleTokenSuccessResponse;
} | {
  ok: false;
  error: FailureCode;
  message: string;
}> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json().catch(() => null) as GoogleTokenSuccessResponse | GoogleTokenErrorResponse | null;

  if (!response.ok || !data || !('access_token' in data)) {
    const googleError = typeof data?.error === 'string' ? data.error : 'unknown_error';
    const googleMessage = typeof data?.error_description === 'string' ? data.error_description : 'Google token exchange failed.';

    if (googleError === 'invalid_grant') {
      return {
        ok: false,
        error: 'needs_reconnect',
        message: googleMessage,
      };
    }

    if (googleError === 'unauthorized_client' || googleError === 'invalid_client') {
      return {
        ok: false,
        error: 'oauth_not_configured',
        message: googleMessage,
      };
    }

    return {
      ok: false,
      error: 'temporary_unavailable',
      message: googleMessage,
    };
  }

  return {
    ok: true,
    data,
  };
}

async function exchangeAuthorizationCode(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  return exchangeGoogleToken(params);
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return exchangeGoogleToken(params);
}

async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

async function fetchCalendarList(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const response = await fetch(GOOGLE_CALENDAR_LIST_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('needs_reconnect');
    }
    if (response.status === 403) {
      throw new Error('revoked');
    }
    throw new Error(`Google Calendar API ${response.status}: ${response.statusText}`);
  }

  const data = await response.json().catch(() => null) as GoogleCalendarListResponse | null;
  return data?.items || [];
}

function resolvePrimaryCalendar(calendars: GoogleCalendarListEntry[]): GoogleCalendarListEntry | undefined {
  return calendars.find(calendar => calendar.primary)
    ?? calendars.find(calendar => calendar.accessRole === 'owner')
    ?? calendars[0];
}

async function resolveGoogleAccount(accessToken: string): Promise<{
  accountEmail: string;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
}> {
  const calendars = await fetchCalendarList(accessToken);
  const primary = resolvePrimaryCalendar(calendars);
  const accountEmail = primary?.id ? normalizeEmail(primary.id) : '';
  if (!accountEmail) {
    throw new Error('Google Calendar did not return a primary account email.');
  }

  return {
    accountEmail,
    accountName: primary?.summary || accountEmail,
    calendars,
  };
}

async function loadCredentialRow(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  accountEmail: string,
): Promise<GoogleCalendarCredentialRow | null> {
  const normalizedEmail = normalizeEmail(accountEmail);
  const { data, error } = await serviceRoleClient
    .from('google_calendar_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('google_email', normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(normalizeCredentialTableErrorMessage(error.message));
  }

  return data as GoogleCalendarCredentialRow | null;
}

async function upsertCredentialRow(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  row: Omit<GoogleCalendarCredentialRow, 'created_at' | 'updated_at'>,
): Promise<GoogleCalendarCredentialRow> {
  const { data, error } = await serviceRoleClient
    .from('google_calendar_credentials')
    .upsert(row, { onConflict: 'user_id,google_email' })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(normalizeCredentialTableErrorMessage(error?.message || 'Failed to save Google Calendar credential.'));
  }

  return data as GoogleCalendarCredentialRow;
}

async function updateCredentialFailureState(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  row: GoogleCalendarCredentialRow,
  reason: string,
): Promise<GoogleCalendarCredentialRow> {
  const { data, error } = await serviceRoleClient
    .from('google_calendar_credentials')
    .update({
      access_token: null,
      access_token_expires_at: null,
      last_refresh_failure_reason: reason,
      last_refresh_failure_at: nowIso(),
      revoked_at: reason.toLowerCase().includes('revoked') ? nowIso() : null,
    })
    .eq('user_id', row.user_id)
    .eq('google_email', row.google_email)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(normalizeCredentialTableErrorMessage(error?.message || 'Failed to update Google Calendar credential failure state.'));
  }

  return data as GoogleCalendarCredentialRow;
}

async function handleConnectedCredential(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  meta: ResponseMeta,
  options: {
    userId: string;
    accessToken: string;
    expiresInSeconds?: number;
    refreshToken?: string;
    scope?: string;
    credentialOrigin: CredentialOrigin;
    expectedEmail?: string;
  },
): Promise<GoogleCalendarConnectedAccount | Response> {
  const resolved = await resolveGoogleAccount(options.accessToken);
  const expectedEmail = options.expectedEmail ? normalizeEmail(options.expectedEmail) : undefined;

  if (expectedEmail && expectedEmail !== resolved.accountEmail) {
    await revokeGoogleToken(options.accessToken);
    return failure(
      'account_mismatch',
      `Google returned ${resolved.accountEmail} instead of ${expectedEmail}. Reconnect this account explicitly.`,
      { accountEmail: resolved.accountEmail },
      meta,
    );
  }

  const existing = await loadCredentialRow(serviceRoleClient, options.userId, resolved.accountEmail);
  const refreshToken = options.refreshToken || existing?.refresh_token || '';
  if (!refreshToken) {
    return failure(
      'missing_refresh_token',
      'Google did not return a refresh token. Reconnect once more with consent so HELM can store a durable Calendar credential.',
      {
        accountEmail: resolved.accountEmail,
        credential: existing ? toCredentialStatus(existing) : undefined,
      },
      meta,
    );
  }

  const saved = await upsertCredentialRow(serviceRoleClient, {
    user_id: options.userId,
    google_email: resolved.accountEmail,
    refresh_token: refreshToken,
    access_token: options.accessToken,
    access_token_expires_at: expiryFromNow(options.expiresInSeconds) || null,
    scope: options.scope || existing?.scope || null,
    credential_origin: options.credentialOrigin,
    last_refresh_at: existing?.last_refresh_at || null,
    last_refresh_failure_reason: null,
    last_refresh_failure_at: null,
    revoked_at: null,
  });

  return {
    credential: toCredentialStatus(saved),
    accountName: resolved.accountName,
    calendars: resolved.calendars,
  };
}

async function mintStoredAccessToken(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  meta: ResponseMeta,
  row: GoogleCalendarCredentialRow,
): Promise<GoogleCalendarMintedAccessToken | Response> {
  const existingExpiry = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;

  if (row.access_token && existingExpiry > Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    return {
      accessToken: row.access_token,
      credential: toCredentialStatus(row),
    };
  }

  const refreshed = await refreshGoogleAccessToken(row.refresh_token);
  if (!refreshed.ok) {
    const failedRow = await updateCredentialFailureState(
      serviceRoleClient,
      row,
      refreshed.message || refreshed.error,
    );

    return failure(
      refreshed.error === 'needs_reconnect' ? 'needs_reconnect' : refreshed.error,
      refreshed.error === 'needs_reconnect'
        ? 'Google refresh token expired or was revoked. Reconnect this account.'
        : refreshed.message,
      {
        accountEmail: row.google_email,
        credential: toCredentialStatus(failedRow),
      },
      meta,
    );
  }

  const updatedRow = await upsertCredentialRow(serviceRoleClient, {
    ...row,
    access_token: refreshed.data.access_token,
    access_token_expires_at: expiryFromNow(refreshed.data.expires_in) || row.access_token_expires_at,
    scope: refreshed.data.scope || row.scope,
    last_refresh_at: nowIso(),
    last_refresh_failure_reason: null,
    last_refresh_failure_at: null,
    revoked_at: null,
  });

  return {
    accessToken: refreshed.data.access_token,
    credential: toCredentialStatus(updatedRow),
  };
}

async function handleExchangeCode(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  user: AuthenticatedUser,
  meta: ResponseMeta,
  body: ActionRequest,
): Promise<Response> {
  if (!body.code || !body.redirectUri) {
    return invalidRequest('exchange_code requires code and redirectUri.', meta);
  }

  const exchanged = await exchangeAuthorizationCode(body.code, body.redirectUri);
  if (!exchanged.ok) {
    return failure(exchanged.error, exchanged.message, {}, meta);
  }

  const connected = await handleConnectedCredential(serviceRoleClient, meta, {
    userId: user.id,
    accessToken: exchanged.data.access_token,
    expiresInSeconds: exchanged.data.expires_in,
    refreshToken: exchanged.data.refresh_token,
    scope: exchanged.data.scope,
    credentialOrigin: 'oauth_code',
    expectedEmail: body.expectedEmail,
  });

  return connected instanceof Response ? connected : success(connected, meta);
}

async function handleBootstrapProfileSession(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  user: AuthenticatedUser,
  meta: ResponseMeta,
  body: ActionRequest,
): Promise<Response> {
  if (!body.email) {
    return invalidRequest('bootstrap_profile_session requires email.', meta);
  }
  if (!body.providerRefreshToken) {
    return failure(
      'missing_refresh_token',
      'Your HELM Google sign-in is missing a Google refresh token. Reconnect your HELM Google sign-in once to upgrade Calendar access.',
      { accountEmail: normalizeEmail(body.email) },
      meta,
    );
  }

  const refreshed = await refreshGoogleAccessToken(body.providerRefreshToken);
  if (!refreshed.ok) {
    return failure(refreshed.error, refreshed.message, {
      accountEmail: normalizeEmail(body.email),
    }, meta);
  }

  const connected = await handleConnectedCredential(serviceRoleClient, meta, {
    userId: user.id,
    accessToken: refreshed.data.access_token,
    expiresInSeconds: refreshed.data.expires_in,
    refreshToken: body.providerRefreshToken,
    scope: refreshed.data.scope,
    credentialOrigin: 'profile_session',
    expectedEmail: body.email,
  });

  return connected instanceof Response ? connected : success(connected, meta);
}

async function handleMintAccessToken(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  user: AuthenticatedUser,
  meta: ResponseMeta,
  body: ActionRequest,
): Promise<Response> {
  if (!body.accountEmail) {
    return invalidRequest('mint_access_token requires accountEmail.', meta);
  }

  const row = await loadCredentialRow(serviceRoleClient, user.id, body.accountEmail);
  if (!row) {
    return failure(
      'missing_credential',
      'No hosted Google Calendar credential exists for this account yet.',
      { accountEmail: normalizeEmail(body.accountEmail) },
      meta,
    );
  }

  const minted = await mintStoredAccessToken(serviceRoleClient, meta, row);
  return minted instanceof Response ? minted : success(minted, meta);
}

async function handleGetAccountStatus(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  user: AuthenticatedUser,
  meta: ResponseMeta,
  body: ActionRequest,
): Promise<Response> {
  let query = serviceRoleClient
    .from('google_calendar_credentials')
    .select('*')
    .eq('user_id', user.id)
    .order('google_email', { ascending: true });

  if (Array.isArray(body.accountEmails) && body.accountEmails.length > 0) {
    query = query.in('google_email', body.accountEmails.map(normalizeEmail));
  }

  const { data, error } = await query;
  if (error) {
    return failure('temporary_unavailable', normalizeCredentialTableErrorMessage(error.message), {}, meta);
  }

  const statuses = (data as GoogleCalendarCredentialRow[] | null || []).map(toCredentialStatus);
  return success(statuses, meta);
}

async function handleRevokeAccount(
  serviceRoleClient: ReturnType<typeof createServiceRoleClient>,
  user: AuthenticatedUser,
  meta: ResponseMeta,
  body: ActionRequest,
): Promise<Response> {
  if (!body.accountEmail) {
    return invalidRequest('revoke_account requires accountEmail.', meta);
  }

  const row = await loadCredentialRow(serviceRoleClient, user.id, body.accountEmail);
  if (!row) {
    return failure(
      'missing_credential',
      'No hosted Google Calendar credential exists for this account.',
      { accountEmail: normalizeEmail(body.accountEmail) },
      meta,
    );
  }

  await Promise.all([
    revokeGoogleToken(row.refresh_token),
    row.access_token ? revokeGoogleToken(row.access_token) : Promise.resolve(),
  ]);

  const { error } = await serviceRoleClient
    .from('google_calendar_credentials')
    .delete()
    .eq('user_id', user.id)
    .eq('google_email', row.google_email);

  if (error) {
    return failure('temporary_unavailable', normalizeCredentialTableErrorMessage(error.message), {
      accountEmail: row.google_email,
      credential: toCredentialStatus(row),
    }, meta);
  }

  return success({ revoked: true }, meta);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = newRequestId();

  const envFailure = getEnvReadinessFailure(requestId);
  if (envFailure) return envFailure;

  const originFailure = ensureOriginAllowed(request, requestId);
  if (originFailure) return originFailure;

  const user = await getAuthenticatedUser(request, requestId);
  if (user instanceof Response) {
    return user;
  }

  const meta = createResponseMeta(requestId, { signedIn: true });

  const body = await parseBody(request, meta);
  if (body instanceof Response) {
    return body;
  }

  const serviceRoleClient = createServiceRoleClient();

  try {
    switch (body.action) {
      case 'exchange_code':
        return await handleExchangeCode(serviceRoleClient, user, meta, body);
      case 'bootstrap_profile_session':
        return await handleBootstrapProfileSession(serviceRoleClient, user, meta, body);
      case 'mint_access_token':
        return await handleMintAccessToken(serviceRoleClient, user, meta, body);
      case 'get_account_status':
        return await handleGetAccountStatus(serviceRoleClient, user, meta, body);
      case 'revoke_account':
        return await handleRevokeAccount(serviceRoleClient, user, meta, body);
      default:
        return invalidRequest('Unsupported action.', meta);
    }
  } catch (error) {
    const message = normalizeCredentialTableErrorMessage(error instanceof Error ? error.message : 'Google Calendar OAuth function failed.');
    if (message === 'needs_reconnect') {
      return failure('needs_reconnect', 'Google access expired. Reconnect this account.', {}, meta);
    }
    if (message === 'revoked') {
      return failure('revoked', 'Google access was revoked. Reconnect this account.', {}, meta);
    }
    return failure('temporary_unavailable', message, {}, meta);
  }
});
