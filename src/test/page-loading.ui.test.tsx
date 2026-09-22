import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceAssistant from '../components/VoiceAssistant';
import { PageReadinessGate } from '../store/PageReadinessGate';
import { ShellProvider, useShell } from '../store/ShellContext';
import { ASSISTANT_PAGE_COLLECTIONS, getPageCollections } from '../store/pageCollections';

const mocks = vi.hoisted(() => ({
  extraLoaded: false,
  wake: () => {},
  activate: vi.fn(),
  release: vi.fn(),
  refresh: vi.fn(),
  createConversation: vi.fn(),
  recordConversation: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
  listen: vi.fn(),
  runAssistantTurn: vi.fn(),
}));

vi.mock('../store/persistence', () => ({ activateStoreCollections: mocks.activate, releaseStoreCollections: mocks.release, refreshDatabasePersistence: mocks.refresh }));
vi.mock('../assistant/runtime', () => ({ runAssistantTurn: mocks.runAssistantTurn }));
vi.mock('../hooks/useVoiceInput', () => ({ useVoiceInput: () => ({ voiceBackend: 'chrome', startListening: mocks.listen, stopListening: mocks.stop, cancelListening: mocks.stop }) }));
vi.mock('../hooks/useVoiceOutput', () => ({ useVoiceOutput: () => ({ speak: mocks.speak, stopSpeaking: mocks.stop, notice: null }) }));
vi.mock('../hooks/useWakeWord', () => ({ useWakeWord: (options: { onWakeWordDetected: () => void }) => { mocks.wake = options.onWakeWordDetected; } }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => ({ loaded: true, settings: { assistantEnabled: true, wakeWordEnabled: true }, appTimeZone: { effectiveTimeZone: 'UTC' } }) }));
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
vi.mock('../store/contexts/AssistantContext', () => ({ useAssistantContext: () => ({ loaded: mocks.extraLoaded, corrections: [] }) }));
vi.mock('../store/contexts/AssistantActivityContext', () => ({ useAssistantActivityContext: () => ({ loaded: mocks.extraLoaded, assistantActivityLog: [] }) }));
vi.mock('../store/contexts/AssistantUndoContext', () => ({ useAssistantUndo: () => ({}) }));
vi.mock('../store/contexts/ChatContext', () => ({ useChatContext: () => ({ loaded: mocks.extraLoaded, createConversation: mocks.createConversation, recordAssistantConversationTurn: mocks.recordConversation }) }));

function PageProbe() {
  const shell = useShell();
  return <>
    <button onClick={() => shell.navigate('inventory')}>Inventory navigation</button>
    <button onClick={() => shell.navigate('dashboard')}>Dashboard navigation</button>
    <PageReadinessGate><output>{shell.surface} data</output></PageReadinessGate>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.extraLoaded = false;
  mocks.activate.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.createConversation.mockReturnValue('confirmed-conversation');
  mocks.speak.mockResolvedValue(undefined);
});

describe('page demand and readiness', () => {
  it('keeps navigation available, hides unloaded page content, and does not reactivate on provider renders', async () => {
    const view = render(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('dashboard data')).toBeVisible();
    expect(mocks.activate).toHaveBeenLastCalledWith(getPageCollections('dashboard'));
    fireEvent.click(screen.getByText('Inventory navigation'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading page data');
    expect(screen.queryByText('inventory data')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard navigation')).toBeEnabled();
    expect(mocks.activate).toHaveBeenLastCalledWith(getPageCollections('inventory'));
    mocks.extraLoaded = true;
    view.rerender(<ShellProvider><PageProbe /></ShellProvider>);
    expect(screen.getByText('inventory data')).toBeVisible();
    expect(mocks.activate).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('reports a page load error and reserves recovery reset for explicit retry', async () => {
    mocks.activate.mockImplementation((keys: readonly string[]) => keys.includes('inventoryItems')
      ? Promise.reject(new Error('Database temporarily unavailable')) : Promise.resolve());
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

describe('Lina demand loading', () => {
  it('keeps the affordance idle and waits for a current provider render before hands-free conversation creation', async () => {
    let finishActivation!: () => void;
    mocks.activate.mockImplementation((keys: readonly string[]) => keys.includes('conversations')
      ? new Promise<void>(resolve => { finishActivation = resolve; }) : Promise.resolve());
    const view = render(<ShellProvider><VoiceAssistant /></ShellProvider>);
    expect(screen.getByRole('button', { name: 'Talk to Lina' })).toBeEnabled();
    expect(mocks.activate).not.toHaveBeenCalledWith(ASSISTANT_PAGE_COLLECTIONS, 'assistant');
    act(() => mocks.wake());
    expect(mocks.activate).toHaveBeenCalledWith(ASSISTANT_PAGE_COLLECTIONS, 'assistant');
    expect(screen.getByRole('status')).toHaveTextContent('Loading Lina account data');
    expect(mocks.createConversation).not.toHaveBeenCalled();
    await act(async () => finishActivation());
    expect(mocks.createConversation).not.toHaveBeenCalled();
    mocks.extraLoaded = true;
    view.rerender(<ShellProvider><VoiceAssistant /></ShellProvider>);
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledOnce());
    expect(mocks.runAssistantTurn).not.toHaveBeenCalled();
  });

  it('cancels a pending wake activation when Lina closes', async () => {
    let finishActivation!: () => void;
    mocks.activate.mockImplementation((keys: readonly string[]) => keys.includes('conversations')
      ? new Promise<void>(resolve => { finishActivation = resolve; }) : Promise.resolve());
    const view = render(<ShellProvider><VoiceAssistant /></ShellProvider>);
    act(() => mocks.wake());
    fireEvent.click(screen.getByRole('button', { name: 'Close Lina' }));
    mocks.extraLoaded = true;
    view.rerender(<ShellProvider><VoiceAssistant /></ShellProvider>);
    await act(async () => finishActivation());
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.runAssistantTurn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();
  });

  it('cancels the provider-readiness wait when account access unmounts Lina', async () => {
    const view = render(<ShellProvider><VoiceAssistant /></ShellProvider>);
    await act(async () => mocks.wake());
    expect(screen.getByRole('status')).toHaveTextContent('Loading Lina account data');
    await act(async () => view.unmount());
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.runAssistantTurn).not.toHaveBeenCalled();
  });
  it('reactivates already-loaded data on a later wake and waits before creating a conversation', async () => {
    mocks.extraLoaded = true;
    render(<ShellProvider><VoiceAssistant /></ShellProvider>);
    await act(async () => mocks.wake());
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Close Lina' }));
    expect(mocks.release).toHaveBeenCalledWith('assistant');
    let finish!: () => void;
    mocks.activate.mockImplementation((keys: readonly string[]) => keys.includes('conversations')
      ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
    act(() => mocks.wake());
    expect(mocks.createConversation).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Lina account data');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.activate).toHaveBeenLastCalledWith(ASSISTANT_PAGE_COLLECTIONS, 'assistant');
    await act(async () => finish());
    await waitFor(() => expect(mocks.createConversation).toHaveBeenCalledTimes(2));
  });

  it('hides manual command controls while already-loaded stale context reactivates on reopen', async () => {
    mocks.extraLoaded = true;
    mocks.runAssistantTurn.mockResolvedValue({ assistantMessage: 'Ready', dialogState: { currentSurface: 'dashboard', recentEntities: [], recentPlans: [] } });
    render(<ShellProvider><VoiceAssistant /></ShellProvider>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Talk to Lina' })));
    expect(await screen.findByRole('textbox')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Lina' }));
    let finish!: () => void;
    mocks.activate.mockImplementation((keys: readonly string[]) => keys.includes('conversations')
      ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Lina' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading Lina account data');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.runAssistantTurn).not.toHaveBeenCalled();
    await act(async () => finish());
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Show projects' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(mocks.runAssistantTurn).toHaveBeenCalledOnce();
  });

});
