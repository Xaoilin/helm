import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import VoiceAssistant from '../components/VoiceAssistant';
import { TIMING } from '../config/constants';

type VoiceInputOptions = Parameters<typeof import('../hooks/useVoiceInput').useVoiceInput>[0];
type WakeWordOptions = Parameters<typeof import('../hooks/useWakeWord').useWakeWord>[0];

let latestVoiceInputOptions: VoiceInputOptions | null = null;
let latestWakeWordOptions: WakeWordOptions | null = null;

const {
  startListeningMock,
  stopListeningMock,
  cancelListeningMock,
  speakMock,
  processAssistantCommandMock,
} = vi.hoisted(() => ({
  startListeningMock: vi.fn(),
  stopListeningMock: vi.fn(),
  cancelListeningMock: vi.fn(),
  speakMock: vi.fn().mockResolvedValue(undefined),
  processAssistantCommandMock: vi.fn(),
}));

vi.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: (options: VoiceInputOptions) => {
    latestVoiceInputOptions = options;
    startListeningMock.mockImplementation(() => {
      latestVoiceInputOptions?.onListeningStart?.();
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
    stopSpeaking: vi.fn(),
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

vi.mock('../services/assistantRuntime', () => ({
  processAssistantCommand: (...args: unknown[]) => processAssistantCommandMock(...args),
}));

function renderAssistant() {
  return render(
    <AppProvider>
      <VoiceAssistant />
    </AppProvider>,
  );
}

function createAssistantResult(message: string) {
  return {
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
  } as const;
}

describe('VoiceAssistant', () => {
  beforeEach(() => {
    latestVoiceInputOptions = null;
    latestWakeWordOptions = null;
    localStorage.clear();
    startListeningMock.mockReset();
    stopListeningMock.mockReset();
    cancelListeningMock.mockReset();
    speakMock.mockReset().mockResolvedValue(undefined);
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

  it('greets the user after the wake word and then opens the mic hands-free', async () => {
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
      await new Promise(resolve => window.setTimeout(resolve, TIMING.VOICE_SESSION_RESUME_DELAY + 20));
    });

    expect(startListeningMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Listening/i).length).toBeGreaterThan(0);
  });

  it('reopens listening after a spoken reply so the conversation can continue hands-free', async () => {
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
      await new Promise(resolve => window.setTimeout(resolve, TIMING.VOICE_SESSION_RESUME_DELAY + 20));
    });

    await act(async () => {
      latestVoiceInputOptions?.onTranscript?.('what do I have left today?');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(processAssistantCommandMock).toHaveBeenCalledTimes(1);
      expect(speakMock).toHaveBeenCalledWith('You have one task left today.');
    });

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, TIMING.VOICE_SESSION_RESUME_DELAY + 20));
    });

    expect(startListeningMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/Listening for follow-up/i).length).toBeGreaterThan(0);
  });

  it('ends the hands-free session when the user says a stop phrase', async () => {
    await act(async () => {
      renderAssistant();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(latestWakeWordOptions).not.toBeNull();
    });

    await act(async () => {
      latestWakeWordOptions?.onWakeWordDetected();
      await new Promise(resolve => window.setTimeout(resolve, TIMING.VOICE_SESSION_RESUME_DELAY + 20));
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
});
