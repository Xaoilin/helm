import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import VoiceAssistant from '../components/VoiceAssistant';

type VoiceInputOptions = Parameters<typeof import('../hooks/useVoiceInput').useVoiceInput>[0];

let latestVoiceInputOptions: VoiceInputOptions | null = null;

vi.mock('../hooks/useVoiceInput', () => ({
  useVoiceInput: (options: VoiceInputOptions) => {
    latestVoiceInputOptions = options;
    return {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      isListening: false,
      voiceBackend: 'deepgram' as const,
    };
  },
}));

vi.mock('../hooks/useVoiceOutput', () => ({
  useVoiceOutput: () => ({
    speak: vi.fn().mockResolvedValue(undefined),
    stopSpeaking: vi.fn(),
    isSpeaking: false,
    audioRef: { current: null },
  }),
}));

vi.mock('../hooks/useWakeWord', () => ({
  useWakeWord: () => ({ wakeWordReady: false }),
}));

describe('VoiceAssistant', () => {
  beforeEach(() => {
    latestVoiceInputOptions = null;
    localStorage.clear();
  });

  it('keeps the live transcript visible when processing starts after recording stops', async () => {
    render(
      <AppProvider>
        <VoiceAssistant />
      </AppProvider>,
    );

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
});
