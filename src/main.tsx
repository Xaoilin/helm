import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppRoot from './AppRoot';
import { initSupabase } from './store/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { AuthSessionProvider } from './store/AuthSessionContext';
import OAuthConsentPage from './surfaces/OAuthConsentPage';

// Initialize the account database only from build-managed configuration.
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const isOAuthConsent = /\/oauth\/consent\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOAuthConsent ? (
      <AuthSessionProvider><OAuthConsentPage /></AuthSessionProvider>
    ) : <AppRoot />}
  </StrictMode>,
);
