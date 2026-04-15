// Google Identity Services integration for browser-based authorization-code flow.
// Legacy token storage remains for migration diagnostics only.

import { logWarn } from './logger';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const SCOPES = 'https://www.googleapis.com/auth/calendar';
const TOKEN_KEY_PREFIX = 'helm:google-tokens:';

export interface GoogleTokens {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

export interface GoogleAuthorizationCode {
  code: string;
  scope: string;
}

let gisLoaded = false;
let gisLoading: Promise<void> | null = null;

/** Dynamically load the Google Identity Services script. Idempotent. */
export function loadGisScript(): Promise<void> {
  if (gisLoaded && window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;

  gisLoading = new Promise<void>((resolve, reject) => {
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

/**
 * Start the GIS authorization-code flow in a popup.
 * The backend exchanges the returned code for durable refreshable credentials.
 */
export function requestGoogleAuthorizationCode(
  clientId: string,
  options: {
    loginHint?: string;
    selectAccount?: boolean;
  } = {},
): Promise<GoogleAuthorizationCode> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: 'popup',
      include_granted_scopes: true,
      login_hint: options.loginHint,
      select_account: options.selectAccount ?? true,
      callback: (response: GoogleCodeResponse) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }

        if (!response.code) {
          reject(new Error('Google did not return an authorization code.'));
          return;
        }

        resolve({
          code: response.code,
          scope: response.scope || SCOPES,
        });
      },
      error_callback: (error: GoogleErrorResponse) => {
        reject(new Error(error.message || 'OAuth code flow failed'));
      },
    });

    client.requestCode();
  });
}

/** Revoke access token at Google. */
export async function revokeAccess(accessToken: string): Promise<void> {
  try {
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
  } catch {
    logWarn('GoogleAuth', 'Token revocation failed (best-effort)');
  }
}

// ── Legacy token storage for migration diagnostics ──

export function saveGoogleTokens(accountId: string, tokens: GoogleTokens): void {
  localStorage.setItem(TOKEN_KEY_PREFIX + accountId, JSON.stringify(tokens));
}

export function loadGoogleTokens(accountId: string): GoogleTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY_PREFIX + accountId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleTokens;
  } catch {
    return null;
  }
}

export function clearGoogleTokens(accountId: string): void {
  localStorage.removeItem(TOKEN_KEY_PREFIX + accountId);
}

/** Check if a legacy token is still fresh (with 60s buffer). */
export function isTokenValid(tokens: GoogleTokens | null): boolean {
  if (!tokens) return false;
  return Date.now() < tokens.expiresAt - 60000;
}

interface GoogleCodeResponse {
  code?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleErrorResponse {
  type: string;
  message?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient(config: {
            client_id: string;
            scope: string;
            ux_mode?: 'popup' | 'redirect';
            include_granted_scopes?: boolean;
            login_hint?: string;
            redirect_uri?: string;
            select_account?: boolean;
            callback: (response: GoogleCodeResponse) => void;
            error_callback?: (error: GoogleErrorResponse) => void;
          }): { requestCode(): void };
          revoke(token: string, callback: () => void): void;
        };
      };
    };
  }
}
