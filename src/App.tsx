import './App.css';
import { useState, useEffect } from 'react';
import { useApp } from './store/AppContext';
import DashboardSurface from './surfaces/DashboardSurface';
import ChatSurface from './surfaces/ChatSurface';
import CalendarSurface from './surfaces/CalendarSurface';
import TasksSurface from './surfaces/TasksSurface';
import FinanceSurface from './surfaces/FinanceSurface';
import KnowledgeSurface from './surfaces/KnowledgeSurface';
import ProfileSurface from './surfaces/ProfileSurface';
import CredentialsSurface from './surfaces/CredentialsSurface';
import WorkspacesSurface from './surfaces/WorkspacesSurface';
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

const NAV_ITEMS: { surface: Surface; label: string; icon: string }[] = [
  { surface: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { surface: 'chat', label: 'Chat', icon: '\u{1F4AC}' },
  { surface: 'calendar', label: 'Calendar', icon: '\u{1F4C5}' },
  { surface: 'tasks', label: 'Tasks', icon: '\u2705' },
  { surface: 'finance', label: 'Finance', icon: '\u{1F4B7}' },
  { surface: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
  { surface: 'profile', label: 'Profile', icon: '\u{1F3C6}' },
  { surface: 'credentials', label: 'Credentials', icon: '\u{1F511}' },
  { surface: 'workspaces', label: 'Workspaces', icon: '\u{1F4C1}' },
  { surface: 'integrations', label: 'Integrations', icon: '\u{1F50C}' },
  { surface: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
  { surface: 'debug', label: 'Debug', icon: '\u{1F41E}' },
];

function AppInner() {
  const app = useApp();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Check session on mount + listen for auth changes
  useEffect(() => {
    if (!isSupabaseReady()) { setAuthLoading(false); return; }
    let initialLoad = true;

    getSessionUser().then(user => {
      setAuthUser(user);
      setAuthLoading(false);
      // Mark initial load complete after a tick
      setTimeout(() => { initialLoad = false; }, TIMING.AUTH_LOAD_DEBOUNCE);
    });

    const unsub = onAuthStateChange(user => {
      if (initialLoad) {
        // Skip the initial auth event (session restore on page load)
        setAuthUser(user);
        return;
      }
      // Real auth transition (user clicked sign in/out) — reload to fetch correct data
      window.location.reload();
    });
    return unsub;
  }, []);

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
        case 'tasks': return <TasksSurface />;
        case 'finance': return <FinanceSurface />;
        case 'knowledge': return <KnowledgeSurface />;
        case 'profile': return <ProfileSurface />;
        case 'credentials': return <CredentialsSurface />;
        case 'workspaces': return <WorkspacesSurface />;
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
          {isSupabaseReady() && !authLoading ? (
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
          ) : (
            <span>HELM v0.1.0 &middot; Local-first</span>
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
