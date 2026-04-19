import './App.css';
import { useState, useEffect, useRef } from 'react';
import { useApp } from './store/AppContext';
import DashboardSurface from './surfaces/DashboardSurface';
import ChatSurface from './surfaces/ChatSurface';
import CalendarSurface from './surfaces/CalendarSurface';
import ClockSurface from './surfaces/ClockSurface';
import TripsSurface from './surfaces/TripsSurface';
import TasksSurface from './surfaces/TasksSurface';
import ProjectsSurface from './surfaces/ProjectsSurface';
import FinanceSurface from './surfaces/FinanceSurface';
import KnowledgeSurface from './surfaces/KnowledgeSurface';
import ProfileSurface from './surfaces/ProfileSurface';
import IntegrationsSurface from './surfaces/IntegrationsSurface';
import SettingsSurface from './surfaces/SettingsSurface';
import DebugSurface from './surfaces/DebugSurface';
import VoiceAssistant from './components/VoiceAssistant';
import ErrorBoundary from './components/ErrorBoundary';
import {
  isSupabaseReady,
  getSessionUser,
  signInWithGoogle,
  signOut,
  onAuthStateChange,
} from './store/supabase';
import type { Surface } from './types/domain';
import type { User } from '@supabase/supabase-js';
import { TIMING } from './config/constants';
import { APP_RELEASE_LABEL, APP_RELEASE_VERSION } from './config/release';
import {
  getGoogleCalendarAuthPatch,
  isGoogleCalendarAccount,
} from './services/googleCalendarAuthManager';
import { useReleaseRefresh } from './hooks/useReleaseRefresh';
import { logInfo } from './services/logger';
import { shouldReloadForAuthStateChange } from './services/authStateReload';

const NAV_ITEMS: { surface: Surface; label: string; icon: string }[] = [
  { surface: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { surface: 'chat', label: 'Chat', icon: '\u{1F4AC}' },
  { surface: 'calendar', label: 'Calendar', icon: '\u{1F4C5}' },
  { surface: 'clock', label: 'Clock', icon: '\u23F1\uFE0F' },
  { surface: 'trips', label: 'Trips', icon: '\u{1F6EB}' },
  { surface: 'projects', label: 'Projects', icon: '\u{1F4CB}' },
  { surface: 'tasks', label: 'Tasks', icon: '\u2705' },
  { surface: 'finance', label: 'Finance', icon: '\u{1F4B7}' },
  { surface: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
  { surface: 'profile', label: 'Profile', icon: '\u{1F3C6}' },
  { surface: 'integrations', label: 'Integrations', icon: '\u{1F50C}' },
  { surface: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
  { surface: 'debug', label: 'Debug', icon: '\u{1F41E}' },
];

const AUTH_RELOAD_SOURCE = 'AppAuth';

function AppInner() {
  const app = useApp();
  const supabaseReady = isSupabaseReady();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(supabaseReady);
  const authUserRef = useRef<User | null>(null);

  useReleaseRefresh();

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    for (const account of app.calendarAccounts) {
      if (!isGoogleCalendarAccount(account)) continue;

      const patch = getGoogleCalendarAuthPatch(account);
      const hasChanges = Object.entries(patch).some(([key, value]) => account[key as keyof typeof account] !== value);
      if (hasChanges) {
        app.updateCalendarAccount(account.id, patch);
      }
    }
  }, [app, app.calendarAccounts, authUser?.email]);

  useEffect(() => {
    const googleIntegration = app.integrations.find(integration => integration.provider === 'google');
    if (!googleIntegration) return;

    const googleAccounts = app.calendarAccounts.filter(isGoogleCalendarAccount);
    const problemAccount = googleAccounts.find(account =>
      account.authStatus === 'needs_reconnect'
      || account.authStatus === 'revoked'
      || account.authStatus === 'error',
    );

    const nextStatus = googleAccounts.length === 0
      ? 'disconnected'
      : problemAccount ? 'error' : 'connected';
    const nextError = problemAccount?.lastAuthError || problemAccount?.syncError;

    if (googleIntegration.status !== nextStatus || googleIntegration.lastError !== nextError) {
      app.updateIntegration(googleIntegration.id, {
        status: nextStatus,
        lastError: nextError,
        configuredAt: nextStatus === 'connected'
          ? (googleIntegration.configuredAt || new Date().toISOString())
          : googleIntegration.configuredAt,
      });
    }
  }, [app, app.calendarAccounts, app.integrations]);

  // Check session on mount + listen for auth changes
  useEffect(() => {
    if (!supabaseReady) return;
    let initialLoad = true;

    getSessionUser().then(user => {
      setAuthUser(user);
      setAuthLoading(false);
      // Mark initial load complete after a tick
      setTimeout(() => { initialLoad = false; }, TIMING.AUTH_LOAD_DEBOUNCE);
    });

    const unsub = onAuthStateChange(({ event, user }) => {
      if (initialLoad) {
        // Skip the initial auth event (session restore on page load)
        setAuthUser(user);
        return;
      }

      const previousUserId = authUserRef.current?.id ?? null;
      const nextUserId = user?.id ?? null;

      if (shouldReloadForAuthStateChange(event, previousUserId, nextUserId)) {
        logInfo(AUTH_RELOAD_SOURCE, `Reloading after auth event ${event}.`);
        window.location.reload();
        return;
      }

      logInfo(AUTH_RELOAD_SOURCE, `Ignoring auth event ${event}; keeping the current shell state.`);
      setAuthUser(user);
    });
    return unsub;
  }, [supabaseReady]);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Sign in failed:', err);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthUser(null);
  };

  const renderSurface = () => {
    const surface = (() => {
      switch (app.surface) {
        case 'dashboard': return <DashboardSurface />;
        case 'chat': return <ChatSurface />;
        case 'calendar': return <CalendarSurface />;
        case 'clock': return <ClockSurface />;
        case 'trips': return <TripsSurface />;
        case 'projects': return <ProjectsSurface />;
        case 'tasks': return <TasksSurface />;
        case 'finance': return <FinanceSurface />;
        case 'knowledge': return <KnowledgeSurface />;
        case 'profile': return <ProfileSurface />;
        case 'integrations': return <IntegrationsSurface />;
        case 'settings': return <SettingsSurface />;
        case 'debug': return <DebugSurface />;
      }
    })();
    return <ErrorBoundary name={app.surface} key={app.surface}>{surface}</ErrorBoundary>;
  };

  return (
    <div className="app-layout">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-logo" role="banner">HELM</div>
        <div className="sidebar-nav" role="navigation">
          {NAV_ITEMS.map(item => (
            <button
              key={item.surface}
              className={`sidebar-item ${app.surface === item.surface ? 'active' : ''}`}
              onClick={() => app.navigate(item.surface)}
              aria-current={app.surface === item.surface ? 'page' : undefined}
              aria-label={`Navigate to ${item.label}`}
            >
              <span className="icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="sidebar-footer" role="contentinfo">
          <div className="sidebar-release" aria-label={APP_RELEASE_LABEL}>
            <div className="sidebar-release-copy">
              <div className="sidebar-release-label">Current release</div>
              <div className="sidebar-release-value">{APP_RELEASE_VERSION}</div>
            </div>
          </div>
          <div className="sidebar-release-meta">
            This sidebar always shows the exact build version you are running.
          </div>
          {supabaseReady ? (
            authLoading ? (
              <span className="sidebar-auth-status">Checking sign-in status...</span>
            ) : (
            authUser ? (
              <div className="sidebar-auth">
                <div className="sidebar-auth-user">
                  <span className="sidebar-auth-avatar">{authUser.user_metadata?.full_name?.charAt(0) || authUser.email?.charAt(0) || '?'}</span>
                  <span className="sidebar-auth-email" title={authUser.email || ''}>{authUser.email?.split('@')[0] || 'Signed in'}</span>
                </div>
                <button className="btn-icon btn-sm" onClick={handleSignOut} aria-label="Sign out" style={{ fontSize: 10, color: '#6b6f85' }}>Sign out</button>
              </div>
            ) : (
              <button className="sidebar-auth-login" onClick={handleSignIn}>
                <span style={{ fontSize: 14 }}>G</span> Sign in with Google
              </button>
            )
            )
          ) : (
            <span className="sidebar-auth-status">Local-first mode. Cloud sync is unavailable in this build.</span>
          )}
        </div>
      </nav>
      <main className="main-content" aria-label={`${app.surface} surface`}>
        {renderSurface()}
      </main>
      <VoiceAssistant />
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
