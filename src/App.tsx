import './App.css';
import { useApp } from './store/AppContext';
import DashboardSurface from './surfaces/DashboardSurface';
import ChatSurface from './surfaces/ChatSurface';
import CalendarSurface from './surfaces/CalendarSurface';
import TasksSurface from './surfaces/TasksSurface';
import KnowledgeSurface from './surfaces/KnowledgeSurface';
import ProfileSurface from './surfaces/ProfileSurface';
import CredentialsSurface from './surfaces/CredentialsSurface';
import WorkspacesSurface from './surfaces/WorkspacesSurface';
import IntegrationsSurface from './surfaces/IntegrationsSurface';
import SettingsSurface from './surfaces/SettingsSurface';
import type { Surface } from './types/domain';

const NAV_ITEMS: { surface: Surface; label: string; icon: string }[] = [
  { surface: 'dashboard', label: 'Dashboard', icon: '\u{1F3E0}' },
  { surface: 'chat', label: 'Chat', icon: '\u{1F4AC}' },
  { surface: 'calendar', label: 'Calendar', icon: '\u{1F4C5}' },
  { surface: 'tasks', label: 'Tasks', icon: '\u2705' },
  { surface: 'knowledge', label: 'Knowledge', icon: '\u{1F4DA}' },
  { surface: 'profile', label: 'Profile', icon: '\u{1F3C6}' },
  { surface: 'credentials', label: 'Credentials', icon: '\u{1F511}' },
  { surface: 'workspaces', label: 'Workspaces', icon: '\u{1F4C1}' },
  { surface: 'integrations', label: 'Integrations', icon: '\u{1F50C}' },
  { surface: 'settings', label: 'Settings', icon: '\u2699\uFE0F' },
];

function AppInner() {
  const app = useApp();

  const renderSurface = () => {
    switch (app.surface) {
      case 'dashboard': return <DashboardSurface />;
      case 'chat': return <ChatSurface />;
      case 'calendar': return <CalendarSurface />;
      case 'tasks': return <TasksSurface />;
      case 'knowledge': return <KnowledgeSurface />;
      case 'profile': return <ProfileSurface />;
      case 'credentials': return <CredentialsSurface />;
      case 'workspaces': return <WorkspacesSurface />;
      case 'integrations': return <IntegrationsSurface />;
      case 'settings': return <SettingsSurface />;
    }
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
          HELM v0.1.0 &middot; Local-first
        </div>
      </nav>
      <main className="main-content" aria-label={`${app.surface} surface`}>
        {renderSurface()}
      </main>
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
