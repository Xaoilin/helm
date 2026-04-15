import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { GOOGLE_CALENDAR_OAUTH_FUNCTION } from '../config';
import { API_TIMEOUT } from '../config/constants';
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

interface GoogleCalendarFunctionFailure {
  ok: false;
  error: GoogleCalendarFunctionFailureCode;
  message: string;
  accountEmail?: string;
  credential?: GoogleCalendarServerCredentialStatus;
}

interface GoogleCalendarFunctionSuccess<T> {
  ok: true;
  result: T;
}

type GoogleCalendarFunctionResponse<T> =
  | GoogleCalendarFunctionFailure
  | GoogleCalendarFunctionSuccess<T>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return error.message;
  }

  if (isHttpError(error)) {
    const response = error.context;
    const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
          return `${statusLabel}: ${data.message}`;
        }
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
          return `${statusLabel}: ${data.error}`;
        }
      }

      const text = await response.text();
      if (text) return `${statusLabel}: ${text}`;
    } catch {
      return `${statusLabel}: ${error.message}`;
    }

    return `${statusLabel}: ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

export class GoogleCalendarOAuthFunctionError extends Error {
  readonly code: GoogleCalendarFunctionFailureCode;
  readonly accountEmail?: string;
  readonly credential?: GoogleCalendarServerCredentialStatus;

  constructor(
    code: GoogleCalendarFunctionFailureCode,
    message: string,
    options: {
      accountEmail?: string;
      credential?: GoogleCalendarServerCredentialStatus;
    } = {},
  ) {
    super(message);
    this.name = 'GoogleCalendarOAuthFunctionError';
    this.code = code;
    this.accountEmail = options.accountEmail;
    this.credential = options.credential;
  }
}

async function invokeGoogleCalendarOAuthFunction<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!isSupabaseReady()) {
    throw new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Supabase sign-in is required for durable Google Calendar access in the browser.',
    );
  }

  const client = getClient();
  if (!client) {
    throw new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Supabase sign-in is required for durable Google Calendar access in the browser.',
    );
  }

  const accessToken = getCurrentAccessToken();
  if (!accessToken) {
    throw new GoogleCalendarOAuthFunctionError(
      'sign_in_required',
      'Sign in to HELM to use durable Google Calendar sync in the browser.',
    );
  }

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
    throw new GoogleCalendarOAuthFunctionError(
      'temporary_unavailable',
      await extractFunctionErrorMessage(error),
    );
  }

  if (!data) {
    throw new GoogleCalendarOAuthFunctionError(
      'temporary_unavailable',
      'Google Calendar auth returned no data.',
    );
  }

  if (!data.ok) {
    throw new GoogleCalendarOAuthFunctionError(data.error, data.message, {
      accountEmail: data.accountEmail,
      credential: data.credential,
    });
  }

  return data.result;
}

export async function exchangeGoogleCalendarAuthorizationCode(options: {
  code: string;
  redirectUri: string;
  expectedEmail?: string;
}): Promise<GoogleCalendarServerConnectedAccount> {
  return invokeGoogleCalendarOAuthFunction<GoogleCalendarServerConnectedAccount>({
    action: 'exchange_code',
    code: options.code,
    redirectUri: options.redirectUri,
    ...(options.expectedEmail ? { expectedEmail: normalizeEmail(options.expectedEmail) } : {}),
  });
}

export async function bootstrapGoogleCalendarProfileCredential(options: {
  email: string;
  providerRefreshToken?: string | null;
}): Promise<GoogleCalendarServerConnectedAccount> {
  return invokeGoogleCalendarOAuthFunction<GoogleCalendarServerConnectedAccount>({
    action: 'bootstrap_profile_session',
    email: normalizeEmail(options.email),
    providerRefreshToken: options.providerRefreshToken ?? null,
  });
}

export async function mintGoogleCalendarAccessToken(accountEmail: string): Promise<GoogleCalendarServerMintedAccessToken> {
  return invokeGoogleCalendarOAuthFunction<GoogleCalendarServerMintedAccessToken>({
    action: 'mint_access_token',
    accountEmail: normalizeEmail(accountEmail),
  });
}

export async function getGoogleCalendarCredentialStatuses(
  accountEmails?: string[],
): Promise<GoogleCalendarServerCredentialStatus[]> {
  return invokeGoogleCalendarOAuthFunction<GoogleCalendarServerCredentialStatus[]>({
    action: 'get_account_status',
    accountEmails: accountEmails?.map(normalizeEmail) ?? null,
  });
}

export async function revokeGoogleCalendarCredential(accountEmail: string): Promise<void> {
  await invokeGoogleCalendarOAuthFunction<{ revoked: true }>({
    action: 'revoke_account',
    accountEmail: normalizeEmail(accountEmail),
  });
}
