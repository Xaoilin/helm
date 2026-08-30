import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivitySurface from '../surfaces/ActivitySurface';
import type { ProductUsageEvent } from '../types/domain';

const mocks = vi.hoisted(() => ({
  auth: {
    authUser: { id: 'user-1' } as { id: string } | null,
    bootstrapped: true,
    loading: false,
    supabaseReady: true,
  },
  events: [] as ProductUsageEvent[],
  getProductUsageEvents: vi.fn(),
  assistantActivity: { assistantActivityLog: [], loaded: true },
  assistantUndo: { undoAssistantActivity: vi.fn() },
}));

vi.mock('../store/AuthSessionContext', () => ({ useOptionalAuthSession: () => mocks.auth }));
vi.mock('../store/supabase', () => ({ getProductUsageEvents: mocks.getProductUsageEvents }));
vi.mock('../store/contexts/AssistantActivityContext', () => ({ useAssistantActivityContext: () => mocks.assistantActivity }));
vi.mock('../store/contexts/AssistantUndoContext', () => ({ useAssistantUndo: () => mocks.assistantUndo }));

function makeEvent(index: number, overrides: Partial<ProductUsageEvent> = {}): ProductUsageEvent {
  return {
    eventId: `event-${index}`,
    schemaVersion: 1,
    sessionId: `session-${index % 3}`,
    sequence: index + 1,
    kind: index < 3 ? 'session' : 'navigation',
    occurredAt: `2026-08-${28 + (index % 3)}T10:00:00.000Z`,
    surface: 'dashboard',
    feature: 'navigation',
    action: 'surface_viewed',
    releaseVersion: '0.2.129',
    deviceClass: 'desktop',
    inputKind: 'system',
    online: true,
    reducedMotion: false,
    ...overrides,
  };
}

describe('Activity surface', () => {
  beforeEach(() => {
    mocks.auth.authUser = { id: 'user-1' };
    mocks.auth.bootstrapped = true;
    mocks.auth.loading = false;
    mocks.auth.supabaseReady = true;
    mocks.events = Array.from({ length: 12 }, (_, index) => makeEvent(index));
    mocks.getProductUsageEvents.mockReset();
    mocks.getProductUsageEvents.mockResolvedValue(mocks.events);
  });

  it('keeps analytics private when signed out', () => {
    mocks.auth.authUser = null;
    render(<ActivitySurface />);

    expect(screen.getByText('Sign in to view private usage activity.')).toBeInTheDocument();
    expect(mocks.getProductUsageEvents).not.toHaveBeenCalled();
  });

  it('shows filtered content-free usage states and keeps Life Hero progression separate', async () => {
    render(<ActivitySurface />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Usage overview' })).toBeInTheDocument());

    expect(screen.getByText('Most-used paths')).toBeInTheDocument();
    expect(screen.getByText('Session progression')).toBeInTheDocument();
    expect(screen.getByText('Private to this signed-in account. Analytics is content-free and separate from Life Hero progression.')).toBeInTheDocument();
    expect(screen.queryByText(/XP/i)).not.toBeInTheDocument();

    const surface = screen.getByLabelText('Usage surface');
    expect(surface).toHaveValue('all');
  });

  it('surfaces read errors with a retry action', async () => {
    mocks.getProductUsageEvents.mockRejectedValueOnce(new Error('read failed'));
    render(<ActivitySurface />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Private usage activity could not be loaded.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
