import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageReadinessGate } from '../store/PageReadinessGate';
import { ShellProvider, useShell } from '../store/ShellContext';

const mocks = vi.hoisted(() => ({ extraLoaded: false }));

vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => ({ loaded: true, settings: {}, appTimeZone: { effectiveTimeZone: 'UTC' } }) }));
vi.mock('../store/contexts/CalendarContext', () => ({ useCalendar: () => ({ loaded: true, calendarAccounts: [], calendarSources: [], calendarEvents: [] }) }));
vi.mock('../store/contexts/TaskContext', () => ({ useTaskContext: () => ({ loaded: true, tasks: [] }) }));
vi.mock('../store/contexts/GamificationContext', () => ({ useGamificationContext: () => ({ loaded: true, gamification: {} }) }));
vi.mock('../store/contexts/DailyMomentumContext', () => ({ useDailyMomentumContext: () => ({ loaded: true }) }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => ({ loaded: true }) }));
vi.mock('../store/contexts/ClockContext', () => ({ useClockContext: () => ({ loaded: true }) }));
vi.mock('../store/contexts/KnowledgeContext', () => ({ useKnowledgeContext: () => ({ loaded: true, knowledgeEntries: [], knowledgeTopics: [], lifestyleItems: [] }) }));
vi.mock('../store/contexts/ProjectContext', () => ({ useProjectContext: () => ({ loaded: mocks.extraLoaded, projects: [] }) }));
vi.mock('../store/contexts/InventoryContext', () => ({ useInventoryContext: () => ({ loaded: mocks.extraLoaded, inventoryItems: [], inventoryNeeds: [] }) }));
vi.mock('../store/contexts/FinanceContext', () => ({ useFinanceContext: () => ({ loaded: mocks.extraLoaded, financeAccounts: [], transactions: [] }) }));
vi.mock('../store/contexts/TripContext', () => ({ useTripContext: () => ({ loaded: mocks.extraLoaded }) }));
vi.mock('../store/contexts/HealthContext', () => ({ useHealthContext: () => ({ loaded: mocks.extraLoaded }) }));

function PageProbe() {
  const shell = useShell();
  return <>
    <button onClick={() => shell.navigate('finance')}>Finance navigation</button>
    <button onClick={() => shell.navigate('dashboard')}>Dashboard navigation</button>
    <PageReadinessGate><output>{shell.surface} data</output></PageReadinessGate>
  </>;
}

beforeEach(() => {
  mocks.extraLoaded = false;
});

describe('page demand and readiness', () => {
  it('keeps navigation available and hides page content until its service data has loaded', () => {
    const view = render(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('dashboard data')).toBeVisible();
    fireEvent.click(screen.getByText('Finance navigation'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading page data');
    expect(screen.queryByText('finance data')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard navigation')).toBeEnabled();
    mocks.extraLoaded = true;
    view.rerender(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('finance data')).toBeVisible();
    fireEvent.click(screen.getByText('Dashboard navigation'));
    expect(screen.getByText('dashboard data')).toBeVisible();
  });
});
