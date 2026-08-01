import './App.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from './store/AppContext';
import DashboardSurface from './surfaces/DashboardSurface';
import ChatSurface from './surfaces/ChatSurface';
import CaptureInboxSurface from './surfaces/CaptureInboxSurface';
import CalendarSurface from './surfaces/CalendarSurface';
import ClockSurface from './surfaces/ClockSurface';
import TripsSurface from './surfaces/TripsSurface';
import TasksSurface from './surfaces/TasksSurface';
import ProjectsSurface from './surfaces/ProjectsSurface';
import SecretsSurface from './surfaces/SecretsSurface';
import FinanceSurface from './surfaces/FinanceSurface';
import HealthSurface from './surfaces/HealthSurface';
import KnowledgeSurface from './surfaces/KnowledgeSurface';
import ProfileSurface from './surfaces/ProfileSurface';
import IntegrationsSurface from './surfaces/IntegrationsSurface';
import ActivitySurface from './surfaces/ActivitySurface';
import SettingsSurface from './surfaces/SettingsSurface';
import DebugSurface from './surfaces/DebugSurface';
import VoiceAssistant from './components/VoiceAssistant';
import PrayerGlobalOverlays from './components/prayer/PrayerGlobalOverlays';
import ErrorBoundary from './components/ErrorBoundary';
import {
  isSupabaseReady,
  signInWithGoogle as startGoogleSignIn,
  signOut as endSupabaseSession,
} from './store/supabase';
import type { CaptureItemSource, Surface } from './types/domain';
import { TIMING } from './config/constants';
import { APP_RELEASE_LABEL, APP_RELEASE_VERSION } from './config/release';
import {
  getGoogleCalendarAuthPatch,
  isGoogleCalendarAccount,
} from './services/googleCalendarAuthManager';
import { useReleaseRefresh } from './hooks/useReleaseRefresh';
import { useOptionalAuthSession } from './store/AuthSessionContext';
import { useSyncAvailability } from './store/SyncAvailabilityContext';

const NAV_ITEMS: { surface: Surface; label: string; icon: string }[] = [
  { surface: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { surface: 'chat', label: 'Chat', icon: '\u{1F4AC}' },
  { surface: 'inbox', label: 'Inbox', icon: '\u{1F4E5}' },
  { surface: 'calendar', label: 'Calendar', icon: '\u{1F4C5}' },
  { surface: 'clock', label: 'Clock', icon: '\u23F1\uFE0F' },
  { surface: 'trips', label: 'Trips', icon: '\u{1F6EB}' },
  { surface: 'projects', label: 'Projects', icon: '\u{1F4CB}' },
  { surface: 'secrets', label: 'Secrets', icon: '\u{1F510}' },
  { surface: 'tasks', label: 'Tasks', icon: '\u2705' },
  { surface: 'finance', label: 'Finance', icon: '\u{1F4B7}' },
  { surface: 'health', label: 'Health', icon: '\u{1F34E}' },
  { surface: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
  { surface: 'profile', label: 'Profile', icon: '\u{1F3C6}' },
  { surface: 'integrations', label: 'Integrations', icon: '\u{1F50C}' },
  { surface: 'activity', label: 'Activity', icon: '\u{1F4DD}' },
  { surface: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
  { surface: 'debug', label: 'Debug', icon: '\u{1F41E}' },
];

const PRIMARY_MOBILE_NAV: Surface[] = ['dashboard', 'chat', 'calendar', 'tasks'];
const MOBILE_NAV_ITEMS = NAV_ITEMS.filter(item => PRIMARY_MOBILE_NAV.includes(item.surface));
const MOBILE_MORE_ITEMS = NAV_ITEMS.filter(item => !PRIMARY_MOBILE_NAV.includes(item.surface));

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
  const [captureModalSource, setCaptureModalSource] = useState<CaptureItemSource | null>(null);
  const [quickCaptureText, setQuickCaptureText] = useState('');
  const [captureNotice, setCaptureNotice] = useState('');
  const captureInputRef = useRef<HTMLTextAreaElement>(null);

  useReleaseRefresh();

  const openCaptureModal = useCallback((source: CaptureItemSource) => {
    if (readOnly) return;
    setQuickCaptureText('');
    setCaptureModalSource(source);
  }, [readOnly]);

  const closeCaptureModal = useCallback(() => {
    setCaptureModalSource(null);
    setQuickCaptureText('');
  }, []);

  const submitQuickCapture = useCallback(() => {
    const content = quickCaptureText.trim();
    if (readOnly || !content || !captureModalSource) return;

    app.addCaptureItem({
      content,
      source: captureModalSource,
      classification: 'unknown',
      status: 'unprocessed',
      sourceSurface: app.surface,
    });
    closeCaptureModal();
    setCaptureNotice('Captured to Inbox.');
    window.setTimeout(() => setCaptureNotice(''), TIMING.TOAST_LIFETIME);
  }, [app, captureModalSource, closeCaptureModal, quickCaptureText, readOnly]);

  useEffect(() => {
    if (!captureModalSource) return;
    window.setTimeout(() => captureInputRef.current?.focus(), TIMING.INPUT_FOCUS_DELAY);
  }, [captureModalSource]);

  useEffect(() => {
    const handleCaptureShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCaptureModal('shortcut');
      }
    };

    window.addEventListener('keydown', handleCaptureShortcut);
    return () => window.removeEventListener('keydown', handleCaptureShortcut);
  }, [openCaptureModal]);

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
    const surface = (() => {
      switch (app.surface) {
        case 'dashboard': return <DashboardSurface />;
        case 'chat': return <ChatSurface />;
        case 'inbox': return <CaptureInboxSurface />;
        case 'calendar': return <CalendarSurface />;
        case 'clock': return <ClockSurface />;
        case 'trips': return <TripsSurface />;
        case 'projects': return <ProjectsSurface />;
        case 'secrets': return <SecretsSurface />;
        case 'tasks': return <TasksSurface />;
        case 'finance': return <FinanceSurface />;
        case 'health': return <HealthSurface />;
        case 'knowledge': return <KnowledgeSurface />;
        case 'profile': return <ProfileSurface />;
        case 'integrations': return <IntegrationsSurface />;
        case 'activity': return <ActivitySurface />;
        case 'settings': return <SettingsSurface />;
        case 'debug': return <DebugSurface />;
      }
    })();
    return <ErrorBoundary name={app.surface} key={app.surface}>{surface}</ErrorBoundary>;
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
        <div className="sidebar-logo" role="banner">HELM</div>
        <div className="sidebar-capture">
          <button
            type="button"
            className="sidebar-capture-button"
            onClick={() => openCaptureModal('quick_button')}
            disabled={readOnly}
            title="Quick capture (Ctrl+Shift+K)"
          >
            <span aria-hidden="true">+</span>
            <span>Capture</span>
          </button>
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
      {!readOnly && <VoiceAssistant />}
      {captureNotice && (
        <div className="capture-toast" role="status">
          {captureNotice}
        </div>
      )}
      {captureModalSource && (
        <div className="capture-modal-overlay" onClick={closeCaptureModal}>
          <div className="capture-modal" role="dialog" aria-modal="true" aria-label="Quick capture" onClick={event => event.stopPropagation()}>
            <div className="capture-modal-header">
              <h2>Quick capture</h2>
              <button type="button" className="btn-icon btn-sm" onClick={closeCaptureModal} aria-label="Close quick capture">
                &times;
              </button>
            </div>
            <textarea
              ref={captureInputRef}
              className="form-input capture-modal-input"
              value={quickCaptureText}
              onChange={event => setQuickCaptureText(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitQuickCapture();
                }
                if (event.key === 'Escape') {
                  closeCaptureModal();
                }
              }}
              aria-label="Capture text"
              placeholder="Write capture..."
            />
            <div className="capture-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeCaptureModal}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submitQuickCapture} disabled={!quickCaptureText.trim()}>
                Save to Inbox
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
