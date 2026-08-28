import './App.css';
import { lazy, Suspense, useState, useEffect } from 'react';
import type { ComponentType } from 'react';
import { useApp } from './store/AppContext';
import DashboardSurface from './surfaces/DashboardSurface';
import PrayerGlobalOverlays from './components/prayer/PrayerGlobalOverlays';
import ErrorBoundary from './components/ErrorBoundary';
import {
  isSupabaseReady,
  signInWithGoogle as startGoogleSignIn,
  signOut as endSupabaseSession,
} from './store/supabase';
import type { Surface } from './types/domain';
import { APP_RELEASE_LABEL, APP_RELEASE_VERSION } from './config/release';
import {
  getGoogleCalendarAuthPatch,
  isGoogleCalendarAccount,
} from './services/googleCalendarAuthManager';
import { useReleaseRefresh } from './hooks/useReleaseRefresh';
import { useOptionalAuthSession } from './store/AuthSessionContext';
import { useSyncAvailability } from './store/SyncAvailabilityContext';

type SurfaceDefinition = {
  label: string;
  icon: string;
  component: ComponentType;
};

const SURFACE_REGISTRY = {
  dashboard: { label: 'Dashboard', icon: '\u{1F3E0}', component: DashboardSurface },
  chat: { label: 'Chat', icon: '\u{1F4AC}', component: lazy(() => import('./surfaces/ChatSurface')) },
  calendar: { label: 'Calendar', icon: '\u{1F4C5}', component: lazy(() => import('./surfaces/CalendarSurface')) },
  clock: { label: 'Clock', icon: '\u23F1\uFE0F', component: lazy(() => import('./surfaces/ClockSurface')) },
  trips: { label: 'Trips', icon: '\u{1F6EB}', component: lazy(() => import('./surfaces/TripsSurface')) },
  projects: { label: 'Projects', icon: '\u{1F4CB}', component: lazy(() => import('./surfaces/ProjectsSurface')) },
  inventory: { label: 'Inventory', icon: '\u{1F9F0}', component: lazy(() => import('./surfaces/InventorySurface')) },
  secrets: { label: 'Secrets', icon: '\u{1F510}', component: lazy(() => import('./surfaces/SecretsSurface')) },
  tasks: { label: 'Tasks', icon: '\u2705', component: lazy(() => import('./surfaces/TasksSurface')) },
  finance: { label: 'Finance', icon: '\u{1F4B7}', component: lazy(() => import('./surfaces/FinanceSurface')) },
  health: { label: 'Health', icon: '\u{1F34E}', component: lazy(() => import('./surfaces/HealthSurface')) },
  knowledge: { label: 'Knowledge', icon: '\u{1F4DA}', component: lazy(() => import('./surfaces/KnowledgeSurface')) },
  profile: { label: 'Profile', icon: '\u{1F3C6}', component: lazy(() => import('./surfaces/ProfileSurface')) },
  integrations: { label: 'Integrations', icon: '\u{1F50C}', component: lazy(() => import('./surfaces/IntegrationsSurface')) },
  activity: { label: 'Activity', icon: '\u{1F4DD}', component: lazy(() => import('./surfaces/ActivitySurface')) },
  settings: { label: 'Settings', icon: '\u2699\uFE0F', component: lazy(() => import('./surfaces/SettingsSurface')) },
  debug: { label: 'Debug', icon: '\u{1F41E}', component: lazy(() => import('./surfaces/DebugSurface')) },
} satisfies Record<Surface, SurfaceDefinition>;

const NAV_ITEMS: { surface: Surface; label: string; icon: string }[] = (Object.keys(SURFACE_REGISTRY) as Surface[]).map(surface => ({
  surface,
  label: SURFACE_REGISTRY[surface].label,
  icon: SURFACE_REGISTRY[surface].icon,
}));

const PRIMARY_MOBILE_NAV: Surface[] = ['dashboard', 'chat', 'calendar', 'tasks'];
const MOBILE_NAV_ITEMS = NAV_ITEMS.filter(item => PRIMARY_MOBILE_NAV.includes(item.surface));
const MOBILE_MORE_ITEMS = NAV_ITEMS.filter(item => !PRIMARY_MOBILE_NAV.includes(item.surface));
const VoiceAssistant = lazy(() => import('./components/VoiceAssistant'));

function AppInner() {
  const app = useApp();
  const { readOnly } = useSyncAvailability();
  const authSession = useOptionalAuthSession();
  const authUser = authSession?.authUser ?? null;
  const authLoading = authSession?.loading ?? false;
  const signInWithGoogle = authSession?.signInWithGoogle ?? startGoogleSignIn;
  const signOut = authSession?.signOut ?? endSupabaseSession;
  const supabaseReady = authSession?.supabaseReady ?? isSupabaseReady();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useReleaseRefresh();

  useEffect(() => {
    if (!mobileMoreOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMoreOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMoreOpen]);

  useEffect(() => {
    if (readOnly) return;
    for (const account of app.calendarAccounts) {
      if (!isGoogleCalendarAccount(account)) continue;

      const patch = getGoogleCalendarAuthPatch(account);
      const hasChanges = Object.entries(patch).some(([key, value]) => account[key as keyof typeof account] !== value);
      if (hasChanges) {
        app.updateCalendarAccount(account.id, patch);
      }
    }
  }, [app, app.calendarAccounts, authUser?.email, readOnly]);

  useEffect(() => {
    if (readOnly) return;
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
  }, [app, app.calendarAccounts, app.integrations, readOnly]);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error('Sign in failed:', err);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const renderSurface = () => {
    const SurfaceComponent = SURFACE_REGISTRY[app.surface].component;
    return (
      <ErrorBoundary name={app.surface} key={app.surface}>
        <Suspense fallback={<div role="status" aria-live="polite">Loading surface...</div>}>
          <SurfaceComponent />
        </Suspense>
      </ErrorBoundary>
    );
  };

  const renderAuthContent = (variant: 'sidebar' | 'mobile') => {
    if (!supabaseReady) {
      return <span className={`${variant}-auth-status`}>Account database unavailable in this build.</span>;
    }

    if (authLoading) {
      return <span className={`${variant}-auth-status`}>Checking sign-in status...</span>;
    }

    if (authUser) {
      return (
        <div className={`${variant}-auth`}>
          <div className={`${variant}-auth-user`}>
            <span className={`${variant}-auth-avatar`}>
              {authUser.user_metadata?.full_name?.charAt(0) || authUser.email?.charAt(0) || '?'}
            </span>
            <span className={`${variant}-auth-email`} title={authUser.email || ''}>{authUser.email?.split('@')[0] || 'Signed in'}</span>
          </div>
          <button className="btn-icon btn-sm" onClick={handleSignOut} aria-label="Sign out">Sign out</button>
        </div>
      );
    }

    return (
      <button className={`${variant}-auth-login`} onClick={handleSignIn}>
        <span style={{ fontSize: 14 }}>G</span> Sign in with Google
      </button>
    );
  };

  const navigateFromMobile = (surface: Surface) => {
    app.navigate(surface);
    setMobileMoreOpen(false);
  };

  const moreIsActive = MOBILE_MORE_ITEMS.some(item => item.surface === app.surface);

  return (
    <div className="app-layout">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-logo" role="banner" aria-label="Sabah One">
          <span className="sidebar-monogram" aria-hidden="true">S1</span>
          <span className="sidebar-wordmark">SABAH ONE</span>
        </div>
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
              <span className="sidebar-item-label">{item.label}</span>
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
          {renderAuthContent('sidebar')}
        </div>
      </nav>
      <main
        className="main-content"
        aria-label={`${app.surface} surface`}
        aria-disabled={readOnly || undefined}
        inert={readOnly || undefined}
      >
        {renderSurface()}
      </main>
      {mobileMoreOpen && (
        <div className="mobile-more-backdrop" onClick={() => setMobileMoreOpen(false)}>
          <section
            className="mobile-more-sheet"
            aria-label="More navigation"
            aria-modal="true"
            role="dialog"
            onClick={event => event.stopPropagation()}
          >
            <div className="mobile-more-handle" aria-hidden="true" />
            <div className="mobile-more-header">
              <div>
                <div className="mobile-more-title">More</div>
                <div className="mobile-more-subtitle">All Lina surfaces</div>
              </div>
              <button className="btn-icon" onClick={() => setMobileMoreOpen(false)} aria-label="Close more navigation">
                &times;
              </button>
            </div>
            <div className="mobile-more-grid">
              {MOBILE_MORE_ITEMS.map(item => (
                <button
                  key={item.surface}
                  className={`mobile-more-item ${app.surface === item.surface ? 'active' : ''}`}
                  onClick={() => navigateFromMobile(item.surface)}
                  aria-current={app.surface === item.surface ? 'page' : undefined}
                >
                  <span className="mobile-more-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mobile-more-release" aria-label={APP_RELEASE_LABEL}>
              <div>
                <div className="mobile-more-release-label">Current release</div>
                <div className="mobile-more-release-value">{APP_RELEASE_VERSION}</div>
              </div>
              <div className="mobile-more-release-copy">Exact build running on this device.</div>
            </div>
            <div className="mobile-auth-panel">
              {renderAuthContent('mobile')}
            </div>
          </section>
        </div>
      )}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {MOBILE_NAV_ITEMS.map(item => (
          <button
            key={item.surface}
            className={`mobile-nav-item ${app.surface === item.surface ? 'active' : ''}`}
            onClick={() => navigateFromMobile(item.surface)}
            aria-current={app.surface === item.surface ? 'page' : undefined}
            aria-label={`Navigate to ${item.label}`}
          >
            <span className="mobile-nav-icon" aria-hidden="true">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </button>
        ))}
        <button
          className={`mobile-nav-item ${moreIsActive || mobileMoreOpen ? 'active' : ''}`}
          onClick={() => setMobileMoreOpen(open => !open)}
          aria-expanded={mobileMoreOpen}
          aria-label="Open more navigation"
        >
          <span className="mobile-nav-icon" aria-hidden="true">...</span>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>
      {!readOnly && <PrayerGlobalOverlays />}
      {!readOnly && (
        <Suspense fallback={null}>
          <VoiceAssistant />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
