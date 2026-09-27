import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageReadinessGate } from '../store/PageReadinessGate';
import { ShellProvider, useShell } from '../store/ShellContext';
import { getPageCollections } from '../store/pageCollections';

const mocks = vi.hoisted(() => ({
  extraLoaded: false,
  activate: vi.fn(),
  release: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../store/persistence', () => ({ activateStoreCollections: mocks.activate, releaseStoreCollections: mocks.release, refreshDatabasePersistence: mocks.refresh }));
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
    <button onClick={() => shell.navigate('finance')}>Inventory navigation</button>
    <button onClick={() => shell.navigate('dashboard')}>Dashboard navigation</button>
    <PageReadinessGate><output>{shell.surface} data</output></PageReadinessGate>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extraLoaded = false;
  mocks.activate.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
});

describe('page demand and readiness', () => {
  it('keeps navigation available, hides unloaded page content, and does not reactivate on provider renders', async () => {
    const view = render(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('dashboard data')).toBeVisible();
    expect(mocks.activate).toHaveBeenLastCalledWith(getPageCollections('dashboard'));
    fireEvent.click(screen.getByText('Inventory navigation'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading page data');
    expect(screen.queryByText('finance data')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard navigation')).toBeEnabled();
    expect(mocks.activate).toHaveBeenLastCalledWith(getPageCollections('finance'));
    mocks.extraLoaded = true;
    view.rerender(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('finance data')).toBeVisible();
    expect(mocks.activate).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('reports a page load error and reserves recovery reset for explicit retry', async () => {
    // The dashboard's activation succeeds; the next page's fails.
    mocks.activate.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Database temporarily unavailable'));
    render(<ShellProvider><PageProbe /></ShellProvider>);
    fireEvent.click(screen.getByText('Inventory navigation'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database temporarily unavailable');
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText('Dashboard navigation'));
    expect(screen.getByText('dashboard data')).toBeVisible();
  });
});

