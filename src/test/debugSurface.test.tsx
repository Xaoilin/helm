import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DebugSurface from '../surfaces/DebugSurface';
import { clearAssistantDebugTrace, recordAssistantDebugTrace } from '../services/assistantDebug';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';
import {
  chatWithHostedAssistant,
  getHostedAssistantDiagnostics,
  resetHostedAssistantDiagnostics,
  testHostedAssistantConnection,
} from '../services/hostedAssistantApi';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaApi';
import { ollamaBreaker } from '../services/serviceBreakers';

const {
  getAuthSessionSnapshotMock,
  getCurrentUserIdMock,
  isAuthenticatedMock,
  isSupabaseReadyMock,
} = vi.hoisted(() => ({
  getAuthSessionSnapshotMock: vi.fn(),
  getCurrentUserIdMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
}));

vi.mock('../components/debug/WakeWordDebug', () => ({
  default: () => <div>Wake word debug stub</div>,
}));

vi.mock('../store/AppContext', () => ({
  useApp: () => ({
    settings: {
      assistantProvider: 'hosted',
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'qwen3:latest',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    },
  }),
}));

vi.mock('../services/assistantAvailability', () => ({
  getAssistantProviderSetting: vi.fn(),
  getAssistantRuntimeStatus: vi.fn(),
}));

vi.mock('../services/hostedAssistantApi', () => ({
  chatWithHostedAssistant: vi.fn(),
  getHostedAssistantDiagnostics: vi.fn(),
  resetHostedAssistantDiagnostics: vi.fn(),
  testHostedAssistantConnection: vi.fn(),
}));

vi.mock('../services/ollamaApi', () => ({
  listOllamaModels: vi.fn(),
  testOllamaConnection: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  getAuthSessionSnapshot: getAuthSessionSnapshotMock,
  getCurrentUserId: getCurrentUserIdMock,
  isAuthenticated: isAuthenticatedMock,
  isSupabaseReady: isSupabaseReadyMock,
}));

describe('DebugSurface AI diagnostics', () => {
  beforeEach(() => {
    clearAssistantDebugTrace();
    ollamaBreaker.reset();
    vi.clearAllMocks();
    getAuthSessionSnapshotMock.mockReturnValue({
      userId: 'user-1',
      email: 'alisa@example.com',
      accessTokenPresent: true,
      providerToken: 'provider-token-present',
      providerRefreshToken: 'refresh-token-present',
      provider: 'google',
      expiresAt: 1_900_000_000,
    });
    getCurrentUserIdMock.mockReturnValue('user-1');
    isAuthenticatedMock.mockReturnValue(true);
    isSupabaseReadyMock.mockReturnValue(true);
    vi.mocked(getAssistantProviderSetting).mockReturnValue('hosted');
    vi.mocked(getAssistantRuntimeStatus).mockResolvedValue({
      activeProvider: 'hosted',
      state: 'ready',
      headline: 'Hosted AI ready',
      detail: 'Intent planning is powered by OpenAI GPT-5.4 through HELM\'s hosted assistant.',
    });
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'available', model: 'gpt-5.4' });
    vi.mocked(chatWithHostedAssistant).mockResolvedValue('READY');
    vi.mocked(getHostedAssistantDiagnostics).mockReturnValue({
      circuitAllowingRequests: true,
      lastAccessMode: 'project_key',
      lastModel: 'gpt-5.4',
      projectAccessAvailable: true,
      lastFailureSource: null,
      lastFailureMessage: null,
      lastFailureAt: null,
    });
    vi.mocked(testOllamaConnection).mockResolvedValue(true);
    vi.mocked(listOllamaModels).mockResolvedValue(['qwen3:latest', 'llama3.2:latest']);
  });

  it('shows an AI Assistant tab with live runtime diagnostics', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));

    expect(screen.getByText('AI Assistant Diagnostics')).toBeInTheDocument();
    expect(await screen.findByText('Hosted AI ready')).toBeInTheDocument();
    expect(screen.getByText('Supabase ready and signed in')).toBeInTheDocument();
    expect((await screen.findAllByText('gpt-5.4')).length).toBeGreaterThan(0);
    expect(screen.getByText('Assistant Actions')).toBeInTheDocument();
    expect(screen.getByText('tasks.open_view')).toBeInTheDocument();
  });

  it('runs hosted health and smoke checks from the debug panel', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));
    await screen.findByText('Hosted AI ready');

    fireEvent.click(screen.getByRole('button', { name: 'Test Hosted AI' }));
    expect((await screen.findAllByText('Hosted assistant reachable')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Run Hosted Smoke Test' }));

    await waitFor(() => {
      expect(chatWithHostedAssistant).toHaveBeenCalledTimes(1);
    });

    expect(chatWithHostedAssistant).toHaveBeenCalledWith([
      {
        role: 'system',
        content: 'You are a HELM hosted assistant smoke test. Always return JSON with reply set to READY.',
      },
      {
        role: 'user',
        content: 'Return JSON with reply set to READY.',
      },
      {
        role: 'assistant',
        content: '{"reply":"READY"}',
      },
      {
        role: 'user',
        content: 'Good. Now return JSON with reply set to READY again.',
      },
    ], expect.objectContaining({
      type: 'object',
      required: ['reply'],
    }), expect.objectContaining({
      model: 'gpt-5.4',
    }));

    expect(await screen.findByText('Hosted smoke test passed')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
  });

  it('shows Ollama models after a successful local connectivity check', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));
    await screen.findByText('Hosted AI ready');

    fireEvent.click(screen.getByRole('button', { name: 'Test Ollama' }));

    expect((await screen.findAllByText('Ollama reachable')).length).toBeGreaterThan(0);
    expect(screen.getByText('qwen3:latest, llama3.2:latest')).toBeInTheDocument();
  });

  it('shows the last real hosted failure details and resets hosted diagnostics', async () => {
    vi.mocked(getHostedAssistantDiagnostics).mockReturnValue({
      circuitAllowingRequests: false,
      lastAccessMode: 'project_key',
      lastModel: 'gpt-5.4',
      projectAccessAvailable: true,
      lastFailureSource: 'chat',
      lastFailureMessage: 'OpenAI error 400: Invalid schema for response_format helm_action_plan.',
      lastFailureAt: '2026-04-10T01:20:00.000Z',
    });

    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));
    await screen.findByText('Hosted AI ready');

    expect(screen.getByText('chat request')).toBeInTheDocument();
    expect(screen.getByText(/Invalid schema for response_format helm_action_plan/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Hosted Breaker' }));
    expect(resetHostedAssistantDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('shows hosted project access even when no user is signed in', async () => {
    getAuthSessionSnapshotMock.mockReturnValue(null);
    getCurrentUserIdMock.mockReturnValue(null);
    isAuthenticatedMock.mockReturnValue(false);
    isSupabaseReadyMock.mockReturnValue(true);
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'available', accessMode: 'project_key', model: 'gpt-5.4' });
    vi.mocked(getHostedAssistantDiagnostics).mockReturnValue({
      circuitAllowingRequests: true,
      lastAccessMode: 'project_key',
      lastModel: 'gpt-5.4',
      projectAccessAvailable: true,
      lastFailureSource: null,
      lastFailureMessage: null,
      lastFailureAt: null,
    });

    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));

    expect(await screen.findByText('Supabase ready with hosted project access')).toBeInTheDocument();
    expect(screen.getAllByText('project access key').length).toBeGreaterThan(0);
  });

  it('shows the latest assistant trace including navigation payloads', async () => {
    recordAssistantDebugTrace({
      recordedAt: '2026-04-10T21:45:00.000Z',
      transcript: 'show me all my tasks',
      effectiveTranscript: 'show me all my tasks',
      assistantMessage: "I've opened your full task list.",
      source: 'openai',
      planningSource: 'openai',
      planningStatus: 'planned',
      planningModel: 'gpt-5.4',
      planningBundle: {
        transcript: 'show me all my tasks',
        normalizedTranscript: 'show me all my tasks',
        currentSurface: 'chat',
        nowIso: '2026-04-10T21:45:00.000Z',
        timezone: 'Europe/London',
        recentEntities: [],
        recentPlans: [],
        capabilities: [{
          id: 'tasks.open_view',
          title: 'Open Tasks View',
          domain: 'tasks',
          description: 'Open the Tasks surface to a specific tab.',
          confirmationRule: 'never',
          score: 1,
          examples: ['Show me all my tasks'],
          aliases: ['all tasks'],
        }],
        entityCandidates: {
          surfaces: [],
          tasks: [],
          calendarEvents: [],
          calendarSources: [],
          financeAccounts: [],
          knowledgeTopics: [],
        },
        benchmarkExamples: [{
          id: 'task-view-1',
          transcript: 'Show me all my tasks',
          expectedMode: 'act',
          expectedCapabilities: ['tasks.open_view'],
        }],
      },
      rawPlannerResponse: '{"mode":"act"}',
      parsedPlan: {
        mode: 'act',
        response: 'Showing all your tasks.',
        confidence: 0.95,
        steps: [{
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: true,
          },
        }],
      },
      validatedPlan: {
        mode: 'act',
        response: 'Showing all your tasks.',
        confidence: 0.95,
        steps: [{
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: true,
          },
        }],
      },
      plannerValidation: {
        status: 'accepted',
      },
      plan: {
        mode: 'act',
        response: '',
        confidence: 0.95,
        steps: [{
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: true,
          },
        }],
      },
      execution: {
        status: 'executed',
        toolResults: [{
          callId: 'call_open_tasks',
          capability: 'tasks.open_view',
          status: 'completed',
          summary: 'Opened the All Tasks task view.',
          facts: ['Opened the Tasks surface on the All Tasks tab.'],
          navigationRequest: {
            id: 'assistant-nav-test',
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
              },
            },
          },
        }],
        steps: [{
          callId: 'call_open_tasks',
          capability: 'tasks.open_view',
          status: 'completed',
          summary: 'Opened the All Tasks task view.',
        }],
        navigationRequests: [{
          id: 'assistant-nav-test',
          surface: 'tasks',
          surfaceState: {
            tasks: {
              tab: 'all',
              resetFilters: true,
            },
          },
        }],
      },
    });

    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /AI Assistant/i }));

    expect(await screen.findByText('Latest Assistant Trace')).toBeInTheDocument();
    expect(screen.getAllByText('show me all my tasks').length).toBeGreaterThan(0);
    expect(screen.getByText('Planning Bundle')).toBeInTheDocument();
    expect(screen.getByText('Raw Planner Response')).toBeInTheDocument();
    expect(screen.getByText('Validated Plan')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getAllByText(/tasks\.open_view/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Navigation Payload/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/assistant-nav-test/i).length).toBeGreaterThan(0);
  });
});
