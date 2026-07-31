import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider } from '../store/AppContext';
import VoiceAssistant from '../components/VoiceAssistant';
import { TIMING } from '../config/constants';
import { useApp } from '../store/AppContext';
import type { ChatConversation, Settings } from '../types/domain';

type VoiceInputOptions = Parameters<typeof import('../hooks/useVoiceInput').useVoiceInput>[0];
type WakeWordOptions = Parameters<typeof import('../hooks/useWakeWord').useWakeWord>[0];

let latestVoiceInputOptions: VoiceInputOptions | null = null;
let latestWakeWordOptions: WakeWordOptions | null = null;
let latestConversations: ChatConversation[] = [];
let autoReadyOnStart = true;

const {
  startListeningMock,
  stopListeningMock,
  cancelListeningMock,
  speakMock,
  stopSpeakingMock,
  playReadyToneMock,
  processAssistantCommandMock,
} = vi.hoisted(() => ({
  startListeningMock: vi.fn(),
  stopListeningMock: vi.fn(),
  cancelListeningMock: vi.fn(),
  speakMock: vi.fn().mockResolvedValue(undefined),
  stopSpeakingMock: vi.fn(),
  playReadyToneMock: vi.fn().mockResolvedValue(undefined),
  processAssistantCommandMock: vi.fn(),
}));

vi.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: (options: VoiceInputOptions) => {
    latestVoiceInputOptions = options;
    startListeningMock.mockImplementation(() => {
      latestVoiceInputOptions?.onListeningPreparing?.();
      if (autoReadyOnStart) {
        latestVoiceInputOptions?.onListeningStart?.();
      }
    });
    stopListeningMock.mockImplementation(() => {
      latestVoiceInputOptions?.onListeningEnd?.();
    });
    cancelListeningMock.mockImplementation(() => {
      latestVoiceInputOptions?.onListeningEnd?.();
    });

    return {
      startListening: startListeningMock,
      stopListening: stopListeningMock,
      cancelListening: cancelListeningMock,
      isListening: false,
      voiceBackend: 'deepgram' as const,
    };
  },
}));

vi.mock('../hooks/useVoiceOutput', () => ({
  useVoiceOutput: () => ({
    speak: speakMock,
    stopSpeaking: stopSpeakingMock,
    isSpeaking: false,
    audioRef: { current: null },
  }),
}));

vi.mock('../hooks/useWakeWord', () => ({
  useWakeWord: (options: WakeWordOptions) => {
    latestWakeWordOptions = options;
    return { wakeWordReady: true };
  },
}));

vi.mock('../services/voiceAssistant', () => ({
  playReadyTone: playReadyToneMock,
}));

vi.mock('../services/assistantRuntime', () => ({
  processAssistantCommand: (...args: unknown[]) => processAssistantCommandMock(...args),
}));

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  const { createLocalPersistenceMock } = await import('./localPersistenceMock');
  return createLocalPersistenceMock(actual);
});

function renderAssistant(options: { settings?: Partial<Settings>; children?: ReactNode } = {}) {
  if (options.settings) {
    localStorage.setItem('helm:settings', JSON.stringify(options.settings));
  }

  function ChatProbe() {
    const app = useApp();
    useEffect(() => {
      latestConversations = app.conversations.map(conversation => ({
        ...conversation,
        messages: [...conversation.messages],
      }));
    }, [app.conversations]);

    return null;
  }

  return render(
    <AppProvider>
      <ChatProbe />
      <VoiceAssistant />
      {options.children}
    </AppProvider>,
  );
}

function DisableLinaHarness() {
  const app = useApp();

  return (
    <button onClick={() => app.updateSettings({ assistantEnabled: false })}>
      Disable Lina
    </button>
  );
}

function createAssistantResult(message: string, overrides: Record<string, unknown> = {}) {
  return {
    assistantMessage: message,
    message,
    plan: {
      mode: 'answer',
      response: message,
      confidence: 1,
      steps: [],
    },
    dialogState: {
      currentSurface: 'dashboard',
      recentEntities: [],
      recentPlans: [],
    },
    source: 'local',
    ...overrides,
  } as const;
}

async function advanceVoiceSessionResumeDelay() {
  await vi.advanceTimersByTimeAsync(TIMING.VOICE_SESSION_RESUME_DELAY + 20);
}

describe('VoiceAssistant', () => {
  beforeEach(() => {
    latestVoiceInputOptions = null;
    latestWakeWordOptions = null;
    latestConversations = [];
    autoReadyOnStart = true;
    localStorage.clear();
    startListeningMock.mockReset();
    stopListeningMock.mockReset();
    cancelListeningMock.mockReset();
    speakMock.mockReset().mockResolvedValue(undefined);
    stopSpeakingMock.mockReset();
    playReadyToneMock.mockReset().mockResolvedValue(undefined);
    processAssistantCommandMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the live transcript visible when processing starts after recording stops', async () => {
    renderAssistant();

    await waitFor(() => {
      expect(latestVoiceInputOptions).not.toBeNull();
    });

    act(() => {
      latestVoiceInputOptions?.onListeningStart?.();
      latestVoiceInputOptions?.onTranscriptPreview?.('call Sam tomorrow morning');
    });

    expect(screen.getByText(/call Sam tomorrow morning/)).toBeInTheDocument();

    act(() => {
      latestVoiceInputOptions?.onProcessingStart?.();
    });

    expect(screen.getByText(/call Sam tomorrow morning/)).toBeInTheDocument();
    expect(screen.queryByText('Processing audio...')).not.toBeInTheDocument();
  });

  it('shows preparing before the wake-word session becomes visibly ready to speak', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    autoReadyOnStart = false;

    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledWith('Hey, how can I help?');
    });

    await act(async () => {
      await advanceVoiceSessionResumeDelay();
    });

    expect(startListeningMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Getting the microphone ready/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Listening\.\.\. speak now/i)).not.toBeInTheDocument();

    act(() => {
      latestVoiceInputOptions?.onListeningStart?.();
    });

    expect(screen.getAllByText(/Listening\.\.\. speak now/i).length).toBeGreaterThan(0);
    expect(playReadyToneMock).toHaveBeenCalledTimes(1);
  });

  it('reopens in preparing first and then listening for a spoken follow-up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    processAssistantCommandMock.mockResolvedValue(createAssistantResult('You have one task left today.'));

    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    autoReadyOnStart = false;

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('what do I have left today?');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(processAssistantCommandMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith('You have one task left today.');
    });
    expect(processAssistantCommandMock).toHaveBeenCalledWith(
      'what do I have left today?',
      expect.anything(),
      expect.objectContaining({
        handlers: expect.objectContaining({
          completePrayer: expect.any(Function),
        }),
      }),
    );

    await act(async () => {
      await advanceVoiceSessionResumeDelay();
    });

    expect(startListeningMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/Getting the microphone ready/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Listening for follow-up\.\.\. speak now/i)).not.toBeInTheDocument();

    act(() => {
      latestVoiceInputOptions?.onListeningStart?.();
    });

    expect(screen.getAllByText(/Listening for follow-up\.\.\. speak now/i).length).toBeGreaterThan(0);
  });

  it('passes shared dialog state between spoken turns so reveal-task follow-ups stay grounded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const firstDialogState = {
      currentSurface: 'dashboard',
      recentEntities: [{
        kind: 'task',
        id: 'task-1',
        label: 'Put the mirror up in the office',
        surface: 'tasks',
        score: 1,
        lastUsedAt: '2026-04-10T10:00:00.000Z',
      }],
      recentPlans: [],
    } as const;

    processAssistantCommandMock
      .mockResolvedValueOnce({
        ...createAssistantResult('Added "Put the mirror up in the office" to your tasks.'),
        dialogState: firstDialogState,
      })
      .mockResolvedValueOnce(createAssistantResult('Opening "Put the mirror up in the office" in your tasks.'));

    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('Can you add a task for me to put the mirror up in the office?');
      await Promise.resolve();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('show me that task');
      await Promise.resolve();
    });

    expect(processAssistantCommandMock).toHaveBeenNthCalledWith(
      2,
      'show me that task',
      expect.anything(),
      expect.objectContaining({
        dialogState: firstDialogState,
      }),
    );
  });

  it('uses the same preparing-to-ready contract for manual mic input', async () => {
    autoReadyOnStart = false;
    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Talk to Lina' }));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use voice input' }));
      await Promise.resolve();
    });

    expect(startListeningMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Getting the microphone ready/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Listening\.\.\. speak now/i)).not.toBeInTheDocument();

    act(() => {
      latestVoiceInputOptions?.onListeningStart?.();
    });

    expect(screen.getAllByText(/Listening\.\.\. speak now/i).length).toBeGreaterThan(0);
    expect(playReadyToneMock).toHaveBeenCalledTimes(1);
  });

  it('stays closed when speech resolves after the user closes Lina', async () => {
    let resolveSpeech!: () => void;
    speakMock.mockImplementationOnce(() => new Promise<void>(resolve => {
      resolveSpeech = resolve;
    }));
    processAssistantCommandMock.mockResolvedValue(
      createAssistantResult('Deferred spoken answer.'),
    );

    renderAssistant();
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Lina' }));

    const input = await screen.findByPlaceholderText(/Type or talk to Lina/i);
    fireEvent.change(input, { target: { value: 'what is next?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send command' }));

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledWith('Deferred spoken answer.');
      expect(screen.getByRole('button', { name: 'Close Lina' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close Lina' }));
    expect(screen.getByRole('button', { name: 'Talk to Lina' })).toBeInTheDocument();
    expect(screen.queryByText('Deferred spoken answer.')).not.toBeInTheDocument();
    expect(stopSpeakingMock).toHaveBeenCalled();

    await act(async () => {
      resolveSpeech();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Talk to Lina' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Type or talk to Lina/i)).not.toBeInTheDocument();
      expect(latestWakeWordOptions?.wakeWordArmed).toBe(true);
    });
    expect(startListeningMock).not.toHaveBeenCalled();
  });

  it('keeps the wake word armed while the manual popup is open', async () => {
    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
      expect(latestWakeWordOptions?.wakeWordArmed).toBe(true);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Talk to Lina' }));
      await Promise.resolve();
    });

    expect(screen.getByPlaceholderText(/Type or talk to Lina/i)).toBeInTheDocument();
    expect(latestWakeWordOptions?.wakeWordArmed).toBe(true);

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledWith('Hey, how can I help?');
      expect(latestWakeWordOptions?.wakeWordArmed).toBe(false);
    });
  });

  it('uses the same configured microphone for wake word and voice input', async () => {
    await act(async () => {
      renderAssistant({
        settings: {
          microphoneDeviceId: 'usb-mic-1',
          wakeWordEnabled: true,
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestVoiceInputOptions).not.toBeNull();
      expect(latestWakeWordOptions).not.toBeNull();
    });

    expect(latestVoiceInputOptions?.micDeviceId).toBe('usb-mic-1');
    expect(latestWakeWordOptions?.micDeviceId).toBe('usb-mic-1');
  });

  it('ends the hands-free session when the user says a stop phrase', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('thanks Lina');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledWith("Okay, I'll stop listening.");
    });

    expect(screen.queryByText(/Hands-free voice session active/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Type or talk to Lina/i)).not.toBeInTheDocument();
  });

  it('re-arms the wake word after a hands-free session ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    expect(latestWakeWordOptions?.wakeWordArmed).toBe(false);

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('thanks Lina');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(speakMock).toHaveBeenCalledWith("Okay, I'll stop listening.");
      expect(latestWakeWordOptions?.wakeWordArmed).toBe(true);
    });
  });

  it('creates a fresh chat conversation for each wake-word session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    processAssistantCommandMock
      .mockResolvedValueOnce(createAssistantResult('First answer.'))
      .mockResolvedValueOnce(createAssistantResult('Second answer.'));

    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('first request');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestConversations).toHaveLength(1);
      expect(latestConversations[0].messages.map(message => message.content)).toEqual([
        'Hey, how can I help?',
        'first request',
        'First answer.',
      ]);
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('thanks Lina');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestConversations[0].messages.at(-2)?.content).toBe('thanks Lina');
      expect(latestConversations[0].messages.at(-1)?.content).toBe("Okay, I'll stop listening.");
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('second request');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestConversations).toHaveLength(2);
      expect(latestConversations[0].messages.map(message => message.content)).toEqual([
        'Hey, how can I help?',
        'second request',
        'Second answer.',
      ]);
      expect(latestConversations[1].messages.map(message => message.content)).toEqual([
        'Hey, how can I help?',
        'first request',
        'First answer.',
        'thanks Lina',
        "Okay, I'll stop listening.",
      ]);
    });
  });

  it('stores assistant billing metadata on voice-created conversation turns', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    processAssistantCommandMock.mockResolvedValue(createAssistantResult('Hosted answer.', {
      source: 'openai',
      planningSource: 'openai',
      planningStatus: 'planned',
      planningModel: 'gpt-5.4',
      assistantBilling: {
        provider: 'openai',
        model: 'gpt-5.4',
        requestCount: 2,
        requests: [
          {
            kind: 'planner',
            responseId: 'resp-plan',
            model: 'gpt-5.4',
            serviceTier: 'default',
            inputTokens: 1000,
            cachedTokens: 100,
            outputTokens: 200,
            reasoningTokens: 120,
            totalTokens: 1200,
            estimatedUsd: 0.005275,
          },
          {
            kind: 'narration',
            responseId: 'resp-narration',
            model: 'gpt-5.4',
            serviceTier: 'default',
            inputTokens: 600,
            cachedTokens: 50,
            outputTokens: 120,
            reasoningTokens: 70,
            totalTokens: 720,
            estimatedUsd: 0.003188,
          },
        ],
        totals: {
          inputTokens: 1600,
          cachedTokens: 150,
          outputTokens: 320,
          reasoningTokens: 190,
          totalTokens: 1920,
        },
        estimatedUsd: 0.008463,
        estimateStatus: 'estimated_from_openai_usage',
        estimateLabel: 'Estimated from OpenAI usage',
      },
    }));

    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await advanceVoiceSessionResumeDelay();
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('show me my tasks');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestConversations[0].messages.at(-1)?.assistantBilling).toEqual(expect.objectContaining({
        provider: 'openai',
        estimatedUsd: 0.008463,
        requestCount: 2,
      }));
    });
  });

  it('shuts Lina down immediately when disabled in settings', async () => {
    await act(async () => {
      renderAssistant({ children: <DisableLinaHarness /> });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Talk to Lina' }));
      await Promise.resolve();
    });

    expect(screen.getByPlaceholderText(/Type or talk to Lina/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Disable Lina'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Talk to Lina' })).not.toBeInTheDocument();
      expect(latestWakeWordOptions?.enabled).toBe(false);
      expect(cancelListeningMock).toHaveBeenCalled();
      expect(stopSpeakingMock).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, key: 'L' });
      await Promise.resolve();
    });

    expect(screen.queryByPlaceholderText(/Type or talk to Lina/i)).not.toBeInTheDocument();
  });
});
