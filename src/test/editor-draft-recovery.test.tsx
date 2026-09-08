import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecretsSurface from '../surfaces/SecretsSurface';
import TripsSurface from '../surfaces/TripsSurface';
import TasksSurface from '../surfaces/TasksSurface';

const mocks = vi.hoisted(() => ({
  secrets: {
    list: vi.fn().mockResolvedValue({ secrets: [] }),
    reveal: vi.fn(),
    save: vi.fn(),
  },
  projects: { projects: [] },
  settings: {
    settings: { deepgramApiKey: '', elevenLabsApiKey: '', goalTags: [] },
  },
  sync: { readOnly: false },
  shell: {
    assistantNavigationRequest: null,
    dismissAssistantNavigationRequest: vi.fn(),
    navigate: vi.fn(),
  },
  trips: {
    trips: [],
    tripLegs: [],
    tripItineraryItems: [],
    tripBookings: [],
    tripBudgetEntries: [],
    loaded: true,
    addTrip: vi.fn().mockReturnValue('trip-1'),
    updateTrip: vi.fn(),
    removeTrip: vi.fn(),
    addTripLeg: vi.fn().mockReturnValue('leg-1'),
    updateTripLeg: vi.fn(),
    removeTripLeg: vi.fn(),
    addTripItineraryItem: vi.fn().mockReturnValue('item-1'),
    updateTripItineraryItem: vi.fn(),
    removeTripItineraryItem: vi.fn(),
    addTripBooking: vi.fn().mockReturnValue('booking-1'),
    updateTripBooking: vi.fn(),
    removeTripBooking: vi.fn(),
    addTripBudgetEntry: vi.fn().mockReturnValue('budget-1'),
    updateTripBudgetEntry: vi.fn(),
    removeTripBudgetEntry: vi.fn(),
  },
  calendar: {
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    loaded: true,
    addCalendarEvent: vi.fn(),
  },
  tasks: {
    tasks: [],
    loaded: true,
    addTask: vi.fn().mockReturnValue('task-1'),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
  },
  gamification: {
    gamification: {
      totalXp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      totalTasksCompleted: 0,
      badges: [],
      habitTallies: {},
      dailyLog: {},
    },
    updateGamification: vi.fn(),
  },
  knowledge: { knowledgeEntries: [], knowledgeTopics: [], lifestyleItems: [] },
  prayer: { getOutcome: vi.fn(), requestPrayerCompletion: vi.fn() },
}));

vi.mock('../store/supabase', () => ({
  listHelmSecrets: mocks.secrets.list,
  revealHelmSecret: mocks.secrets.reveal,
  saveHelmSecret: mocks.secrets.save,
  setHelmSecretArchived: vi.fn(),
}));
vi.mock('../store/persistence', () => ({
  subscribeHelmSecretChanges: vi.fn(() => () => undefined),
  subscribeSyncSession: vi.fn(() => () => undefined),
}));
vi.mock('../store/contexts/ProjectContext', () => ({ useProjectContext: () => mocks.projects }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => mocks.settings }));
vi.mock('../store/SyncAvailabilityContext', () => ({ useSyncAvailability: () => mocks.sync }));
vi.mock('../store/ShellContext', () => ({ useShell: () => mocks.shell }));
vi.mock('../store/contexts/TripContext', () => ({ useTripContext: () => mocks.trips }));
vi.mock('../store/contexts/CalendarContext', () => ({ useCalendar: () => mocks.calendar }));
vi.mock('../store/contexts/TaskContext', () => ({ useTaskContext: () => mocks.tasks }));
vi.mock('../store/contexts/GamificationContext', () => ({ useGamificationContext: () => mocks.gamification }));
vi.mock('../store/contexts/KnowledgeContext', () => ({ useKnowledgeContext: () => mocks.knowledge }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => mocks.prayer }));
vi.mock('../components/HabitCards', () => ({ default: () => null }));

function expectDraftToStayOpen(dialogName: string, field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const dialog = screen.getByRole('dialog', { name: dialogName });

  fireEvent.click(dialog.parentElement as HTMLElement);
  expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
  expect(field).toHaveValue(value);

  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
  expect(field).toHaveValue(value);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument();
  expect(field).toHaveValue(value);
  expect(confirm).toHaveBeenCalledTimes(3);

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument();
}

describe('editor draft recovery', () => {
  beforeEach(() => {
    mocks.secrets.list.mockResolvedValue({ secrets: [] });
    mocks.secrets.reveal.mockReset();
    mocks.secrets.save.mockReset();
    mocks.trips.addTrip.mockClear();
    mocks.tasks.tasks = [];
    mocks.tasks.addTask.mockClear();
    mocks.gamification.updateGamification.mockClear();
    mocks.shell.navigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a dirty Secret draft through backdrop, Escape, and Cancel until discard', async () => {
    render(<SecretsSurface />);
    await waitFor(() => expect(mocks.secrets.list).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add Secret' })[0]);

    expectDraftToStayOpen('Add secret', screen.getByRole('textbox', { name: 'Label' }), 'Production key');
  });

  it('keeps a dirty Trip wizard draft through backdrop, Escape, and Cancel until discard', () => {
    render(<TripsSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Plan Trip' }));

    expectDraftToStayOpen('Plan trip', screen.getByRole('textbox', { name: 'Trip Name' }), 'Summer route');
  });

  it('keeps a dirty Task draft through backdrop, Escape, and Cancel until discard', () => {
    render(<TasksSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Task' }));

    expectDraftToStayOpen('Add Task', screen.getByRole('textbox', { name: 'Title' }), 'Write report');
  });

  it('allows clean dismissal and preserves task save behavior', () => {
    render(<TasksSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Task' }));
    const confirm = vi.spyOn(window, 'confirm');

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add Task' })).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '+ Add Task' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Write report' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mocks.tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write report' }));
    expect(screen.queryByRole('dialog', { name: 'Add Task' })).not.toBeInTheDocument();
  });

  it('preserves Secret save semantics and blocks dismissal while saving', async () => {
    let resolveSave!: (value: unknown) => void;
    mocks.secrets.save.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    render(<SecretsSurface />);
    await waitFor(() => expect(mocks.secrets.list).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add Secret' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Production key' } });
    fireEvent.change(screen.getByLabelText('Secret value'), { target: { value: 'secret-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Secret' }));

    const dialog = screen.getByRole('dialog', { name: 'Add secret' });
    const label = screen.getByRole('textbox', { name: 'Label' });
    fireEvent.click(dialog.parentElement as HTMLElement);
    fireEvent.keyDown(label, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Add secret' })).toBeInTheDocument();

    resolveSave({ secretId: 'secret-1', label: 'Production key', kind: 'api_key', environment: '', projectCatalogKeys: [], archivedAt: null, sourceRef: null });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add secret' })).not.toBeInTheDocument());
  });

  it('does not mark an unchanged prefilled Task edit dirty', () => {
    mocks.tasks.tasks = [{
      id: 'task-1',
      title: 'Existing task',
      description: '',
      completed: false,
      priority: 'medium',
      category: 'task',
      dueDate: '2026-09-08',
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }];
    render(<TasksSurface />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Existing task"' }));
    const confirm = vi.spyOn(window, 'confirm');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Edit Task' })).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('preserves Trip wizard save behavior', () => {
    render(<TripsSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Plan Trip' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Trip Name' }), { target: { value: 'Summer route' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Spain' } });
    fireEvent.change(screen.getByPlaceholderText('City'), { target: { value: 'Madrid' } });
    const dates = screen.getByRole('dialog', { name: 'Plan trip' }).querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: '2026-10-01' } });
    fireEvent.change(dates[1], { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Trip' }));

    expect(mocks.trips.addTrip).toHaveBeenCalledWith(expect.objectContaining({ name: 'Summer route' }));
    expect(screen.queryByRole('dialog', { name: 'Plan trip' })).not.toBeInTheDocument();
  });

  it('preserves Secret save semantics after a successful save', async () => {
    mocks.secrets.save.mockResolvedValue({
      secretId: 'secret-1',
      label: 'Production key',
      kind: 'api_key',
      environment: '',
      projectCatalogKeys: [],
      archivedAt: null,
      sourceRef: null,
    });
    render(<SecretsSurface />);
    await waitFor(() => expect(mocks.secrets.list).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add Secret' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Production key' } });
    fireEvent.change(screen.getByLabelText('Secret value'), { target: { value: 'secret-value' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Secret' }));
    });

    expect(mocks.secrets.save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ label: 'Production key', value: 'secret-value' }));
    expect(screen.queryByRole('dialog', { name: 'Add secret' })).not.toBeInTheDocument();
  });
});
