import type {
  CalendarAccount,
  CalendarAuthProvider,
  CalendarAuthStatus,
} from '../types/domain';
import {
  clearGoogleTokens,
  initiateOAuthFlow,
  isTokenValid,
  loadGisScript,
  loadGoogleTokens,
  refreshAccessToken,
  saveGoogleTokens,
  type GoogleTokens,
} from './googleAuth';
import {
  fetchCalendarList,
  type GoogleCalendarListEntry,
} from './googleCalendarApi';
import {
  getAuthSessionSnapshot,
  signInWithGoogle,
  type AuthSessionSnapshot,
} from '../store/supabase';

export const GOOGLE_RECONNECT_REQUIRED_MESSAGE = 'Reconnect required';
export const GOOGLE_ACCESS_EXPIRED_MESSAGE = 'Google access expired. Reconnect this account.';
export const GOOGLE_PROFILE_RECONNECT_MESSAGE = 'Reconnect your HELM Google sign-in to restore Calendar access.';
export const GOOGLE_ACCESS_REVOKED_MESSAGE = 'Google access was revoked. Reconnect this account.';
export const GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE = 'Google Calendar temporarily unavailable.';

export interface GoogleCalendarConnectionResult {
  email: string;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
}

interface PassiveTokenResult {
  accessToken: string;
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
}

export class GoogleCalendarReconnectRequiredError extends Error {
  readonly authProvider: CalendarAuthProvider;
  readonly authStatus: CalendarAuthStatus;

  constructor(message: string, authProvider: CalendarAuthProvider, authStatus: CalendarAuthStatus = 'needs_reconnect') {
    super(message);
    this.name = 'GoogleCalendarReconnectRequiredError';
    this.authProvider = authProvider;
    this.authStatus = authStatus;
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

function toAuthExpiry(tokens: GoogleTokens | null): string | undefined {
  return tokens ? new Date(tokens.expiresAt).toISOString() : undefined;
}

export function isGoogleCalendarAccount(account: CalendarAccount): boolean {
  return account.provider === 'google' && account.connected && !account.mocked;
}

export function getResolvedGoogleAuthProvider(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): CalendarAuthProvider {
  const profileEmail = normalizeEmail(snapshot?.email);
  const accountEmail = normalizeEmail(account.email);
  if (profileEmail && profileEmail === accountEmail) {
    return 'profile-google';
  }
  return account.authProvider === 'profile-google' ? 'calendar-oauth' : (account.authProvider ?? 'calendar-oauth');
}

export function getGoogleCalendarAuthPatch(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): Partial<CalendarAccount> {
  if (!isGoogleCalendarAccount(account)) {
    return {};
  }

  const authProvider = getResolvedGoogleAuthProvider(account, snapshot);
  const storedTokens = loadGoogleTokens(account.id);
  const storedTokenValid = isTokenValid(storedTokens);
  const profileToken = snapshot?.providerToken ?? null;
  const profileExpiry = snapshot?.expiresAt ? new Date(snapshot.expiresAt * 1000).toISOString() : undefined;

  let authStatus: CalendarAuthStatus = account.authStatus ?? 'connected';
  let authExpiresAt = account.authExpiresAt;
  let lastAuthError = account.lastAuthError;
  let syncError = account.syncError;

  if (authProvider === 'profile-google') {
    if (profileToken) {
      authStatus = 'connected';
      authExpiresAt = profileExpiry;
      lastAuthError = undefined;
      syncError = undefined;
    } else if (storedTokenValid) {
      authStatus = 'connected';
      authExpiresAt = toAuthExpiry(storedTokens);
      lastAuthError = undefined;
      syncError = undefined;
    } else {
      authStatus = account.authStatus === 'revoked' ? 'revoked' : 'needs_reconnect';
      authExpiresAt = toAuthExpiry(storedTokens) ?? profileExpiry;
      lastAuthError = account.lastAuthError || GOOGLE_PROFILE_RECONNECT_MESSAGE;
      syncError = undefined;
    }
  } else if (storedTokenValid) {
    authStatus = 'connected';
    authExpiresAt = toAuthExpiry(storedTokens);
    lastAuthError = undefined;
    syncError = undefined;
  } else {
    authStatus = account.authStatus === 'revoked' ? 'revoked' : 'needs_reconnect';
    authExpiresAt = toAuthExpiry(storedTokens);
    lastAuthError = account.lastAuthError || GOOGLE_ACCESS_EXPIRED_MESSAGE;
    syncError = undefined;
  }

  return {
    authProvider,
    authStatus,
    authEmail: account.email,
    authExpiresAt,
    lastAuthError,
    lastAuthCheckAt: account.lastAuthCheckAt,
    syncError,
  };
}

export function getGoogleCalendarPassiveAccessToken(
  account: CalendarAccount,
): PassiveTokenResult {
  const snapshot = getAuthSessionSnapshot();
  const authProvider = getResolvedGoogleAuthProvider(account, snapshot);

  if (authProvider === 'profile-google' && snapshot?.providerToken) {
    return {
      accessToken: snapshot.providerToken,
      authProvider,
      authExpiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt * 1000).toISOString() : undefined,
    };
  }

  const storedTokens = loadGoogleTokens(account.id);
  if (storedTokens && isTokenValid(storedTokens)) {
    return {
      accessToken: storedTokens.accessToken,
      authProvider,
      authExpiresAt: toAuthExpiry(storedTokens),
    };
  }

  const message = authProvider === 'profile-google'
    ? GOOGLE_PROFILE_RECONNECT_MESSAGE
    : GOOGLE_ACCESS_EXPIRED_MESSAGE;
  throw new GoogleCalendarReconnectRequiredError(message, authProvider);
}

export async function getGoogleCalendarPassiveAccessTokenWithRefresh(
  account: CalendarAccount,
  clientId: string,
): Promise<PassiveTokenResult> {
  try {
    return getGoogleCalendarPassiveAccessToken(account);
  } catch (error) {
    if (!(error instanceof GoogleCalendarReconnectRequiredError)) {
      throw error;
    }

    const authProvider = getResolvedGoogleAuthProvider(account);
    if (authProvider === 'profile-google') {
      throw error;
    }

    const existingTokens = loadGoogleTokens(account.id);
    if (!existingTokens || !clientId) {
      throw error;
    }

    try {
      await loadGisScript();
      const refreshed = await refreshAccessToken(clientId);
      saveGoogleTokens(account.id, refreshed);
      return {
        accessToken: refreshed.accessToken,
        authProvider,
        authExpiresAt: toAuthExpiry(refreshed),
      };
    } catch {
      throw new GoogleCalendarReconnectRequiredError(GOOGLE_ACCESS_EXPIRED_MESSAGE, authProvider);
    }
  }
}

export async function connectGoogleCalendarOAuthAccount(clientId: string): Promise<GoogleCalendarConnectionResult & { tokens: GoogleTokens }> {
  await loadGisScript();
  const tokens = await initiateOAuthFlow(clientId.trim());
  const calendars = await fetchCalendarList(tokens.accessToken);
  const primaryCal = calendars.find(calendar => calendar.primary);
  const email = primaryCal?.id || 'google-user';
  const accountName = primaryCal?.summary || 'Google Calendar';

  return {
    email,
    accountName,
    calendars,
    tokens,
    authProvider: 'calendar-oauth',
    authExpiresAt: toAuthExpiry(tokens),
  };
}

export async function reconnectGoogleCalendarOAuthAccount(
  account: CalendarAccount,
  clientId: string,
): Promise<GoogleCalendarConnectionResult> {
  const result = await connectGoogleCalendarOAuthAccount(clientId);
  if (normalizeEmail(result.email) !== normalizeEmail(account.email)) {
    throw new Error(`Reconnect ${account.email} by signing into that same Google account.`);
  }

  saveGoogleTokens(account.id, result.tokens);
  return result;
}

export async function connectProfileGoogleCalendar(): Promise<GoogleCalendarConnectionResult> {
  const snapshot = getAuthSessionSnapshot();
  if (!snapshot?.providerToken || !snapshot.email) {
    throw new GoogleCalendarReconnectRequiredError(GOOGLE_PROFILE_RECONNECT_MESSAGE, 'profile-google');
  }

  const calendars = await fetchCalendarList(snapshot.providerToken);
  const primaryCal = calendars.find(calendar => calendar.primary);
  return {
    email: snapshot.email,
    accountName: primaryCal?.summary || 'Google Calendar',
    calendars,
    authProvider: 'profile-google',
    authExpiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt * 1000).toISOString() : undefined,
  };
}

export async function triggerProfileGoogleReconnect(): Promise<void> {
  await signInWithGoogle();
}

export function clearGoogleCalendarAuth(accountId: string): void {
  clearGoogleTokens(accountId);
}

export function getGoogleCalendarStatusLabel(account: CalendarAccount): string {
  if (!isGoogleCalendarAccount(account)) {
    return account.connected ? 'Connected' : 'Local';
  }

  switch (account.authStatus) {
    case 'connected':
      return 'Connected';
    case 'needs_reconnect':
      return 'Needs reconnect';
    case 'revoked':
      return 'Revoked';
    case 'error':
      return 'Temporarily unavailable';
    default:
      return account.connected ? 'Connected' : 'Disconnected';
  }
}
