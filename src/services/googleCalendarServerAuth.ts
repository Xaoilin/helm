import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { GOOGLE_CALENDAR_OAUTH_FUNCTION } from '../config';
import { API_TIMEOUT } from '../config/constants';
import {
  appendGoogleCalendarDiagnosticEvent,
  type GoogleCalendarBackendReadiness,
  type GoogleCalendarDiagnosticOperation,
} from './googleCalendarDiagnosticEvents';
import {
  getClient,
  getCurrentAccessToken,
  isSupabaseReady,
} from '../store/supabase';
import type { GoogleCalendarListEntry } from './googleCalendarApi';

export type GoogleCalendarCredentialHealth = 'refreshable' | 'needs_reconnect' | 'revoked';
export type GoogleCalendarCredentialOrigin = 'oauth_code' | 'profile_session';
export type GoogleCalendarFunctionFailureCode =
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

export interface GoogleCalendarServerCredentialStatus {
  accountEmail: string;
  serverCredentialPresent: boolean;
  credentialHealth: GoogleCalendarCredentialHealth;
  currentAccessTokenExpiresAt?: string;
  scope?: string;
  lastRefreshAt?: string;
  lastRefreshFailureReason?: string;
  lastRefreshFailureAt?: string;
  credentialOrigin?: GoogleCalendarCredentialOrigin;
}

export interface GoogleCalendarServerConnectedAccount {
  credential: GoogleCalendarServerCredentialStatus;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
}

export interface GoogleCalendarServerMintedAccessToken {
  accessToken: string;
  credential: GoogleCalendarServerCredentialStatus;
}

export interface GoogleCalendarFunctionMeta {
  requestId: string;
  checkedAt: string;
  readiness: GoogleCalendarBackendReadiness;
}

export interface GoogleCalendarCredentialStatusSnapshot {
  statuses: GoogleCalendarServerCredentialStatus[];
  requestId: string;
  checkedAt: string;
  readiness: GoogleCalendarBackendReadiness;
}

interface GoogleCalendarFunctionFailure {
  ok: false;
  error: GoogleCalendarFunctionFailureCode;
  message: string;
  accountEmail?: string;
  credential?: GoogleCalendarServerCredentialStatus;
  meta?: GoogleCalendarFunctionMeta;
}

interface GoogleCalendarFunctionSuccess<T> {
  ok: true;
  result: T;
  meta?: GoogleCalendarFunctionMeta;
}

type GoogleCalendarFunctionResponse<T> =
  | GoogleCalendarFunctionFailure
  | GoogleCalendarFunctionSuccess<T>;

const ES256_JWT_GATEWAY_ERROR_PATTERN = /unsupported jwt algorithm es256/i;
const ES256_JWT_GATEWAY_ERROR_MESSAGE = 'Hosted Google Calendar auth rejected the Sabah One session token before the function ran (HTTP 401: Unsupported JWT algorithm ES256). Redeploy google-calendar-oauth with --no-verify-jwt so the function can validate Supabase auth internally.';
const GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_PATTERN = /could not find the table ['"]public\.google_calendar_credentials['"] in the schema cache/i;
const GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_MESSAGE = 'Hosted Google Calendar database schema is missing the google_calendar_credentials table. Apply the Supabase migration for durable Google Calendar credentials, then retry reconnecting or syncing.';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getDiagnosticOperationForAction(action: string | undefined): GoogleCalendarDiagnosticOperation {
  switch (action) {
    case 'exchange_code':
      return 'oauth_code_exchange';
    case 'bootstrap_profile_session':
      return 'profile_bootstrap';
    case 'mint_access_token':
      return 'access_token_mint';
    case 'get_account_status':
      return 'server_status_refresh';
    case 'revoke_account':
      return 'disconnect';
    default:
      return 'server_status_refresh';
  }
}

function defaultBackendReadiness(): GoogleCalendarBackendReadiness {
  return {
    functionReachable: true,
    oauthConfigured: true,
    originAllowed: true,
    signedIn: true,
  };
}

function getReadinessForFailureCode(code: GoogleCalendarFunctionFailureCode): GoogleCalendarBackendReadiness {
  switch (code) {
    case 'oauth_not_configured':
      return {
        ...defaultBackendReadiness(),
        oauthConfigured: false,
      };
    case 'unauthorized_origin':
      return {
        ...defaultBackendReadiness(),
        originAllowed: false,
      };
    case 'sign_in_required':
      return {
        ...defaultBackendReadiness(),
        signedIn: false,
      };
    default:
      return defaultBackendReadiness();
  }
}

function isHttpError(error: unknown): error is FunctionsHttpError {
  return error instanceof FunctionsHttpError
    || (
      typeof error === 'object'
      && error !== null
      && 'context' in error
      && typeof error.context === 'object'
      && error.context !== null
      && 'headers' in error.context
      && 'json' in error.context
      && 'text' in error.context
    );
}

async function extractFunctionErrorDetails(error: unknown): Promise<{ message: string; httpStatus?: number }> {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return { message: error.message };
  }

  if (isHttpError(error)) {
    const response = error.context;
    const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
          return { message: `${statusLabel}: ${data.message}`, httpStatus: response.status };
        }
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
          return { message: `${statusLabel}: ${data.error}`, httpStatus: response.status };
        }
      }

      const text = await response.text();
      if (text) return { message: `${statusLabel}: ${text}`, httpStatus: response.status };
    } catch {
      return { message: `${statusLabel}: ${error.message}`, httpStatus: response.status };
    }

    return { message: `${statusLabel}: ${error.message}`, httpStatus: response.status };
  }

  return { message: error instanceof Error ? error.message : String(error) };
}

function isEs256GatewayJwtVerificationError(errorDetails: { message: string; httpStatus?: number }): boolean {
  return errorDetails.httpStatus === 401 && ES256_JWT_GATEWAY_ERROR_PATTERN.test(errorDetails.message);
}

function isGoogleCredentialsSchemaCacheError(errorDetails: { message: string; httpStatus?: number }): boolean {
  return GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_PATTERN.test(errorDetails.message);
}

function normalizeHostedGoogleCalendarErrorMessage(message: string): string {
  if (GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_PATTERN.test(message)) {
    return GOOGLE_CREDENTIALS_SCHEMA_CACHE_ERROR_MESSAGE;
  }

  return message;
}

export class GoogleCalendarOAuthFunctionError extends Error {
  readonly code: GoogleCalendarFunctionFailureCode;
  readonly accountEmail?: string;
  readonly credential?: GoogleCalendarServerCredentialStatus;
  readonly requestId?: string;
  readonly readiness?: GoogleCalendarBackendReadiness;
  readonly httpStatus?: number;

  constructor(
    code: GoogleCalendarFunctionFailureCode,
    message: string,
    options: {
      accountEmail?: string;
      credential?: GoogleCalendarServerCredentialStatus;
      requestId?: string;
      readiness?: GoogleCalendarBackendReadiness;
      httpStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = 'GoogleCalendarOAuthFunctionError';
    this.code = code;
    this.accountEmail = options.accountEmail;
    this.credential = options.credential;
    this.requestId = options.requestId;
    this.readiness = options.readiness;
    this.httpStatus = options.httpStatus;
  }
}

async function invokeGoogleCalendarOAuthFunction<T>(
  body: Record<string, unknown>,
): Promise<{ result: T; meta: GoogleCalendarFunctionMeta }> {
  const action = typeof body.action === 'string' ? body.action : undefined;
  const operation = getDiagnosticOperationForAction(action);
  const accountEmail = typeof body.accountEmail === 'string'
    ? body.accountEmail
    : typeof body.expectedEmail === 'string'
      ? body.expectedEmail
      : typeof body.email === 'string'
        ? body.email
        : undefined;

  if (!isSupabaseReady()) {
    const error = new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Supabase sign-in is required for durable Google Calendar access in the browser.',
      { readiness: getReadinessForFailureCode('sign_in_required') },
    );
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: 'blocked',
      message: error.message,
      code: error.code,
      readiness: error.readiness,
      email: accountEmail,
    });
    throw error;
  }

  const client = getClient();
  if (!client) {
    const error = new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Supabase sign-in is required for durable Google Calendar access in the browser.',
      { readiness: getReadinessForFailureCode('sign_in_required') },
    );
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: 'blocked',
      message: error.message,
      code: error.code,
      readiness: error.readiness,
      email: accountEmail,
    });
    throw error;
  }

  const accessToken = getCurrentAccessToken();
  if (!accessToken) {
    const error = new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Sign in to Sabah One to use durable Google Calendar sync in the browser.',
      { readiness: getReadinessForFailureCode('sign_in_required') },
    );
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: 'blocked',
      message: error.message,
      code: error.code,
      readiness: error.readiness,
      email: accountEmail,
    });
    throw error;
  }

  appendGoogleCalendarDiagnosticEvent({
    operation,
    phase: 'start',
    outcome: 'info',
    message: `Starting ${action || 'unknown'} on the hosted Google Calendar auth function.`,
    email: accountEmail,
  });

  const { data, error } = await client.functions.invoke<GoogleCalendarFunctionResponse<T>>(
    GOOGLE_CALENDAR_OAUTH_FUNCTION,
    {
      body,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: API_TIMEOUT.GOOGLE_CALENDAR_OAUTH,
    },
  );

  if (error) {
    const errorDetails = await extractFunctionErrorDetails(error);
    const isEs256JwtGatewayFailure = isEs256GatewayJwtVerificationError(errorDetails);
    const isSchemaCacheFailure = isGoogleCredentialsSchemaCacheError(errorDetails);
    const functionError = new GoogleCalendarOAuthFunctionError(
      'temporary_unavailable',
      isEs256JwtGatewayFailure
        ? ES256_JWT_GATEWAY_ERROR_MESSAGE
        : normalizeHostedGoogleCalendarErrorMessage(errorDetails.message),
      {
        httpStatus: errorDetails.httpStatus,
        readiness: isEs256JwtGatewayFailure || isSchemaCacheFailure
          ? defaultBackendReadiness()
          : {
              ...defaultBackendReadiness(),
              functionReachable: false,
            },
      },
    );
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: 'temporary_unavailable',
      message: functionError.message,
      code: functionError.code,
      httpStatus: functionError.httpStatus,
      readiness: functionError.readiness,
      email: accountEmail,
    });
    throw functionError;
  }

  if (!data) {
    const functionError = new GoogleCalendarOAuthFunctionError(
      'temporary_unavailable',
      'Google Calendar auth returned no data.',
      {
        readiness: {
          ...defaultBackendReadiness(),
          functionReachable: false,
        },
      },
    );
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: 'temporary_unavailable',
      message: functionError.message,
      code: functionError.code,
      readiness: functionError.readiness,
      email: accountEmail,
    });
    throw functionError;
  }

  if (!data.ok) {
    const functionError = new GoogleCalendarOAuthFunctionError(data.error, data.message, {
      accountEmail: data.accountEmail,
      credential: data.credential,
      requestId: data.meta?.requestId,
      readiness: data.meta?.readiness || getReadinessForFailureCode(data.error),
    });
    appendGoogleCalendarDiagnosticEvent({
      operation,
      phase: 'failure',
      outcome: data.error === 'revoked'
        ? 'revoked'
        : data.error === 'needs_reconnect' || data.error === 'missing_credential' || data.error === 'missing_refresh_token' || data.error === 'account_mismatch'
          ? 'needs_reconnect'
          : data.error === 'temporary_unavailable'
            ? 'temporary_unavailable'
            : 'failure',
      message: functionError.message,
      code: functionError.code,
      requestId: functionError.requestId,
      readiness: functionError.readiness,
      email: functionError.accountEmail || accountEmail,
    });
    throw functionError;
  }

  const meta = data.meta || {
    requestId: 'unknown',
    checkedAt: new Date().toISOString(),
    readiness: defaultBackendReadiness(),
  };
  appendGoogleCalendarDiagnosticEvent({
    operation,
    phase: 'success',
    outcome: 'success',
    message: `Hosted Google Calendar auth action ${action || 'unknown'} succeeded.`,
    requestId: meta.requestId,
    readiness: meta.readiness,
    email: accountEmail,
  });

  return { result: data.result, meta };
}

export async function exchangeGoogleCalendarAuthorizationCode(options: {
  code: string;
  redirectUri: string;
  expectedEmail?: string;
}): Promise<GoogleCalendarServerConnectedAccount> {
  const response = await invokeGoogleCalendarOAuthFunction<GoogleCalendarServerConnectedAccount>({
    action: 'exchange_code',
    code: options.code,
    redirectUri: options.redirectUri,
    ...(options.expectedEmail ? { expectedEmail: normalizeEmail(options.expectedEmail) } : {}),
  });
  return response.result;
}

export async function bootstrapGoogleCalendarProfileCredential(options: {
  email: string;
  providerRefreshToken?: string | null;
}): Promise<GoogleCalendarServerConnectedAccount> {
  const response = await invokeGoogleCalendarOAuthFunction<GoogleCalendarServerConnectedAccount>({
    action: 'bootstrap_profile_session',
    email: normalizeEmail(options.email),
    providerRefreshToken: options.providerRefreshToken ?? null,
  });
  return response.result;
}

export async function mintGoogleCalendarAccessToken(accountEmail: string): Promise<GoogleCalendarServerMintedAccessToken> {
  const response = await invokeGoogleCalendarOAuthFunction<GoogleCalendarServerMintedAccessToken>({
    action: 'mint_access_token',
    accountEmail: normalizeEmail(accountEmail),
  });
  return response.result;
}

export async function getGoogleCalendarCredentialStatuses(
  accountEmails?: string[],
): Promise<GoogleCalendarServerCredentialStatus[]> {
  const response = await invokeGoogleCalendarOAuthFunction<GoogleCalendarServerCredentialStatus[]>({
    action: 'get_account_status',
    accountEmails: accountEmails?.map(normalizeEmail) ?? null,
  });
  return response.result;
}

export async function getGoogleCalendarCredentialStatusSnapshot(
  accountEmails?: string[],
): Promise<GoogleCalendarCredentialStatusSnapshot> {
  const response = await invokeGoogleCalendarOAuthFunction<GoogleCalendarServerCredentialStatus[]>({
    action: 'get_account_status',
    accountEmails: accountEmails?.map(normalizeEmail) ?? null,
  });

  return {
    statuses: response.result,
    requestId: response.meta.requestId,
    checkedAt: response.meta.checkedAt,
    readiness: response.meta.readiness,
  };
}

export async function revokeGoogleCalendarCredential(accountEmail: string): Promise<void> {
  await invokeGoogleCalendarOAuthFunction<{ revoked: true }>({
    action: 'revoke_account',
    accountEmail: normalizeEmail(accountEmail),
  });
}
