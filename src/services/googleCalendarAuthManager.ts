import type {
  CalendarAccount,
  CalendarAuthProvider,
  CalendarAuthStatus,
} from '../types/domain';
import {
  clearGoogleTokens,
  initiateOAuthFlow,
  loadGisScript,
  loadGoogleTokens,
  saveGoogleTokens,
  type GoogleTokens,
} from './googleAuth';
import {
  fetchCalendarList,
  type GoogleCalendarListEntry,
} from './googleCalendarApi';
import {
  getAuthSessionSnapshot,
  isAuthSessionBootstrapped,
  isSupabaseReady,
  signInWithGoogle,
  type AuthSessionSnapshot,
} from '../store/supabase';
import { TIMING } from '../config/constants';

export const GOOGLE_RECONNECT_REQUIRED_MESSAGE = 'Reconnect required';
export const GOOGLE_ACCESS_EXPIRED_MESSAGE = 'Google access expired. Reconnect this account.';
export const GOOGLE_PROFILE_RECONNECT_MESSAGE = 'Reconnect your HELM Google sign-in to restore Calendar access.';
export const GOOGLE_ACCESS_REVOKED_MESSAGE = 'Google access was revoked. Reconnect this account.';
export const GOOGLE_ACCOUNT_MISMATCH_MESSAGE = 'Google returned a different account. Reconnect this account explicitly.';
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

export interface GoogleCalendarPassiveSyncEligibility {
  eligible: boolean;
  blockedReason?: string;
}

export interface GoogleCalendarOwnershipResult {
  matches: boolean;
  primaryEmail?: string;
  message?: string;
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

function hasStoredGoogleTokens(tokens: GoogleTokens | null): boolean {
  return Boolean(tokens?.accessToken);
}

export function formatGoogleCalendarOwnershipMismatchMessage(
  expectedEmail: string,
  actualEmail?: string,
): string {
  if (actualEmail) {
    return `Google returned ${actualEmail} while syncing ${expectedEmail}. Reconnect this account explicitly.`;
  }

  return `Google could not verify ${expectedEmail} from the current Google session. Reconnect this account explicitly.`;
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
  if (account.authProvider === 'profile-google') {
    return 'profile-google';
  }
  return account.authProvider ?? 'calendar-oauth';
}

export function getGoogleCalendarAccountActivityTime(
  account: Pick<CalendarAccount, 'lastSyncTime' | 'lastAuthCheckAt'>,
): number {
  const lastSync = account.lastSyncTime ? new Date(account.lastSyncTime).getTime() : 0;
  const lastAuthCheck = account.lastAuthCheckAt ? new Date(account.lastAuthCheckAt).getTime() : 0;
  return Math.max(lastSync, lastAuthCheck);
}

export function getGoogleCalendarPassiveSyncEligibility(
  account: CalendarAccount,
  options: { manual?: boolean } = {},
): GoogleCalendarPassiveSyncEligibility {
  const manual = options.manual ?? false;

  if (!isGoogleCalendarAccount(account)) {
    return {
      eligible: false,
      blockedReason: 'This account is not an active Google Calendar connection.',
    };
  }

  const resolvedProvider = getResolvedGoogleAuthProvider(account);
  const storedTokenPresent = hasStoredGoogleTokens(loadGoogleTokens(account.id));
  if (resolvedProvider === 'profile-google' && isSupabaseReady() && !isAuthSessionBootstrapped()) {
    return {
      eligible: false,
      blockedReason: 'Waiting for HELM Google sign-in status to finish loading.',
    };
  }

  if (!manual && resolvedProvider !== 'profile-google' && !storedTokenPresent) {
    return {
      eligible: false,
      blockedReason: 'Auto sync is paused until this account has cached Google access again.',
    };
  }

  if (account.authStatus === 'revoked') {
    return {
      eligible: false,
      blockedReason: 'Google revoked access for this account. Reconnect it before syncing again.',
    };
  }

  if (!manual && account.authStatus === 'needs_reconnect') {
    return {
      eligible: false,
      blockedReason: 'Auto sync is paused until this account is rechecked or reconnected.',
    };
  }

  const activityTime = getGoogleCalendarAccountActivityTime(account);
  if (!manual && activityTime >= Date.now() - TIMING.SYNC_THROTTLE) {
    return {
      eligible: false,
      blockedReason: 'Auto sync is waiting for the next passive check window.',
    };
  }

  return {
    eligible: true,
    blockedReason: manual
      ? 'Ready for a manual passive auth check.'
      : 'Ready for passive background sync.',
  };
}

export function getGoogleCalendarOwnershipResult(
  account: CalendarAccount,
  calendars: readonly GoogleCalendarListEntry[],
): GoogleCalendarOwnershipResult {
  const expectedEmail = normalizeEmail(account.email);
  const primaryCalendar = calendars.find(calendar => calendar.primary)
    ?? calendars.find(calendar => normalizeEmail(calendar.id) === expectedEmail);
  const primaryEmail = normalizeEmail(primaryCalendar?.id);

  if (primaryEmail && primaryEmail === expectedEmail) {
    return {
      matches: true,
      primaryEmail,
    };
  }

  return {
    matches: false,
    primaryEmail: primaryEmail || undefined,
    message: formatGoogleCalendarOwnershipMismatchMessage(account.email, primaryEmail || undefined),
  };
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
  const storedTokenPresent = hasStoredGoogleTokens(storedTokens);
  const profileToken = snapshot?.providerToken ?? null;
  const profileExpiry = snapshot?.expiresAt ? new Date(snapshot.expiresAt * 1000).toISOString() : undefined;
  const authBootstrapped = !isSupabaseReady() || isAuthSessionBootstrapped();

  let authStatus: CalendarAuthStatus = account.authStatus ?? 'connected';
  let authExpiresAt = toAuthExpiry(storedTokens) ?? account.authExpiresAt;
  let lastAuthError = account.lastAuthError;
  let syncError = account.syncError;

  if (authProvider === 'profile-google') {
    if (profileToken) {
      authStatus = 'connected';
      authExpiresAt = profileExpiry;
      lastAuthError = undefined;
      syncError = undefined;
    } else if (!authBootstrapped) {
      authStatus = account.authStatus === 'revoked' ? 'revoked' : (account.authStatus ?? 'connected');
      authExpiresAt = profileExpiry ?? account.authExpiresAt;
    } else {
      authStatus = account.authStatus === 'revoked' ? 'revoked' : 'needs_reconnect';
      authExpiresAt = profileExpiry ?? account.authExpiresAt;
      lastAuthError = GOOGLE_PROFILE_RECONNECT_MESSAGE;
      syncError = undefined;
    }
  } else {
    authStatus = account.authStatus === 'revoked'
      ? 'revoked'
      : (account.authStatus ?? 'connected');
    authExpiresAt = toAuthExpiry(storedTokens) ?? account.authExpiresAt;

    if (authStatus === 'connected') {
      lastAuthError = undefined;
      syncError = undefined;
    } else if (authStatus === 'needs_reconnect' && !lastAuthError) {
      lastAuthError = storedTokenPresent
        ? GOOGLE_ACCESS_EXPIRED_MESSAGE
        : GOOGLE_RECONNECT_REQUIRED_MESSAGE;
      syncError = undefined;
    } else if (authStatus === 'revoked' && !lastAuthError) {
      lastAuthError = GOOGLE_ACCESS_REVOKED_MESSAGE;
      syncError = undefined;
    }
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

  if (authProvider === 'profile-google') {
    throw new GoogleCalendarReconnectRequiredError(GOOGLE_PROFILE_RECONNECT_MESSAGE, authProvider);
  }

  const storedTokens = loadGoogleTokens(account.id);
  if (storedTokens?.accessToken) {
    return {
      accessToken: storedTokens.accessToken,
      authProvider,
      authExpiresAt: toAuthExpiry(storedTokens),
    };
  }

  throw new GoogleCalendarReconnectRequiredError(GOOGLE_ACCESS_EXPIRED_MESSAGE, authProvider);
}

export async function getGoogleCalendarPassiveAccessTokenWithRefresh(
  account: CalendarAccount,
  clientId: string,
): Promise<PassiveTokenResult> {
  void clientId;
  return getGoogleCalendarPassiveAccessToken(account);
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
