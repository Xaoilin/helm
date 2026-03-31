import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './store/AppContext';
import App from './App';
import { initSupabase } from './store/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// Initialize Supabase from config (env vars or settings fallback)
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  initSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
