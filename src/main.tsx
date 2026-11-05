import { startBrowserObservability } from './services/browserObservability';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppRoot from './AppRoot';
import { initAccessService } from './store/supabase';
import { ACCESS_BACKEND_URL } from './config';
import { AuthSessionProvider } from './store/AuthSessionContext';
import OAuthConsentPage from './surfaces/OAuthConsentPage';
import { clearRetiredDashboardCaches } from './store/deviceSettings';

startBrowserObservability();

// These retired, account-unscoped caches must also disappear before sign-in.
clearRetiredDashboardCaches();

// Initialize the account database only from build-managed configuration.
if (ACCESS_BACKEND_URL) {
  initAccessService(ACCESS_BACKEND_URL);
}

const isOAuthConsent = /\/oauth\/consent\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOAuthConsent ? (
      <AuthSessionProvider><OAuthConsentPage /></AuthSessionProvider>
    ) : <AppRoot />}
  </StrictMode>,
);
