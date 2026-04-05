// Google Identity Services OAuth2 integration
// Uses the GIS token model (implicit grant) for browser-based auth

import { logWarn } from './logger';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCOPES = 'https://www.googleapis.com/auth/calendar';
const TOKEN_KEY_PREFIX = 'helm:google-tokens:';

export interface GoogleTokens {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

let gisLoaded = false;
let gisLoading: Promise<void> | null = null;

/** Dynamically load the Google Identity Services script. Idempotent. */
export function loadGisScript(): Promise<void> {
  if (gisLoaded && window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;

  gisLoading = new Promise<void>((resolve, reject) => {
    // Check if already loaded
    if (window.google?.accounts?.oauth2) {
      gisLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      gisLoaded = true;
      resolve();
    };
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Failed to load Google Identity Services script'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

/** Initiate OAuth2 consent flow via popup. Returns access token on success. */
export function initiateOAuthFlow(clientId: string): Promise<GoogleTokens> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: 'consent',
      callback: (response: GoogleTokenResponse) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        const tokens: GoogleTokens = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in * 1000),
          scope: response.scope,
        };
        resolve(tokens);
      },
      error_callback: (error: GoogleErrorResponse) => {
        reject(new Error(error.message || 'OAuth flow failed'));
      },
    });

    client.requestAccessToken();
  });
}

/** Silent token refresh (no popup). Works while Google session cookie is active. */
export function refreshAccessToken(clientId: string): Promise<GoogleTokens> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: '',
      callback: (response: GoogleTokenResponse) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        const tokens: GoogleTokens = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in * 1000),
          scope: response.scope,
        };
        resolve(tokens);
      },
      error_callback: (error: GoogleErrorResponse) => {
        reject(new Error(error.message || 'Silent refresh failed'));
      },
    });

    client.requestAccessToken();
  });
}

/** Revoke access token at Google. */
export async function revokeAccess(accessToken: string): Promise<void> {
  try {
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
  } catch (e) {
    logWarn('GoogleAuth', 'Token revocation failed (best-effort)');
  }
}

// ── Token Storage ──

export function saveGoogleTokens(accountId: string, tokens: GoogleTokens): void {
  localStorage.setItem(TOKEN_KEY_PREFIX + accountId, JSON.stringify(tokens));
}

export function loadGoogleTokens(accountId: string): GoogleTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY_PREFIX + accountId);
  if (!raw) return null;
  try { return JSON.parse(raw) as GoogleTokens; } catch { return null; }
}

export function clearGoogleTokens(accountId: string): void {
  localStorage.removeItem(TOKEN_KEY_PREFIX + accountId);
}

/** Check if token is valid (not expired with 60s buffer). */
export function isTokenValid(tokens: GoogleTokens | null): boolean {
  if (!tokens) return false;
  return Date.now() < tokens.expiresAt - 60000;
}

/**
 * Get an access token for the given account.
 *
 * Strategy: return the stored token even if it looks expired.
 * Google tokens often work slightly past their stated expiry.
 * The caller should handle 401 errors from the API — that's the
 * real signal that re-auth is needed, not the local expiry clock.
 *
 * This avoids opening a Google sign-in popup every time the user
 * visits the Calendar page after the 1-hour token window.
 * GIS token model does NOT support true silent refresh — requestAccessToken()
 * with prompt:'' still opens a popup if the session is stale.
 *
 * Throws only if no tokens exist at all.
 */
export async function getValidAccessToken(accountId: string, _clientId: string): Promise<string> {
  const tokens = loadGoogleTokens(accountId);
  if (tokens?.accessToken) return tokens.accessToken;
  throw new Error('No stored tokens. Please reconnect this account.');
}

// ── GIS type declarations ──

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

interface GoogleErrorResponse {
  type: string;
  message?: string;
}

// Extend window for GIS
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: GoogleErrorResponse) => void;
          }): { requestAccessToken(): void };
          revoke(token: string, callback: () => void): void;
        };
      };
    };
  }
}
