import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './store/AppContext';
import App from './App';
import { initFromEnv, initFromSettings } from './store/supabase';

// Initialize Supabase from env vars first, then from user settings
initFromEnv();
initFromSettings();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
