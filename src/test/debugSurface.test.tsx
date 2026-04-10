import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DebugSurface from '../surfaces/DebugSurface';
import { getAssistantProviderSetting, getAssistantRuntimeStatus } from '../services/assistantAvailability';
import {
  chatWithHostedAssistant,
  getHostedAssistantDiagnostics,
  resetHostedAssistantDiagnostics,
  testHostedAssistantConnection,
} from '../services/hostedAssistantApi';
import { listOllamaModels, testOllamaConnection } from '../services/ollamaApi';
import { ollamaBreaker } from '../services/serviceBreakers';

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
  getAuthSessionSnapshot: vi.fn(() => ({
    userId: 'user-1',
    email: 'alisa@example.com',
    accessTokenPresent: true,
    providerToken: 'provider-token-present',
    providerRefreshToken: 'refresh-token-present',
    provider: 'google',
    expiresAt: 1_900_000_000,
  })),
  getCurrentUserId: vi.fn(() => 'user-1'),
  isAuthenticated: vi.fn(() => true),
  isSupabaseReady: vi.fn(() => true),
}));

describe('DebugSurface AI diagnostics', () => {
  beforeEach(() => {
    ollamaBreaker.reset();
    vi.clearAllMocks();
    vi.mocked(getAssistantProviderSetting).mockReturnValue('hosted');
    vi.mocked(getAssistantRuntimeStatus).mockResolvedValue({
      activeProvider: 'hosted',
      state: 'ready',
      headline: 'Hosted AI ready',
      detail: 'Open-ended help is powered by OpenAI GPT-5.4-mini through your signed-in HELM session.',
    });
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'available' });
    vi.mocked(chatWithHostedAssistant).mockResolvedValue('READY');
    vi.mocked(getHostedAssistantDiagnostics).mockReturnValue({
      circuitAllowingRequests: true,
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
    expect((await screen.findAllByText('gpt-5.4-mini')).length).toBeGreaterThan(0);
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
});
