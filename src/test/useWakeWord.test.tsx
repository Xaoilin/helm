import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWakeWord } from '../hooks/useWakeWord';

const {
  loadMock,
  startMock,
  stopMock,
  MockWakeWordEngine,
} = vi.hoisted(() => ({
  loadMock: vi.fn().mockResolvedValue(undefined),
  startMock: vi.fn().mockResolvedValue(undefined),
  stopMock: vi.fn().mockResolvedValue(undefined),
  MockWakeWordEngine: class MockWakeWordEngine {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_config?: Record<string, unknown>) {}

    on() {
      return () => {};
    }

    off() {
      return undefined;
    }

    load() {
      return loadMock();
    }

    start(options?: { deviceId?: string; gain?: number }) {
      return startMock(options);
    }

    stop() {
      return stopMock();
    }
  },
}));

vi.mock('openwakeword-wasm-browser', () => ({
  default: MockWakeWordEngine,
  WakeWordEngine: MockWakeWordEngine,
}));

describe('useWakeWord', () => {
  beforeEach(() => {
    loadMock.mockClear().mockResolvedValue(undefined);
    startMock.mockClear().mockResolvedValue(undefined);
    stopMock.mockClear().mockResolvedValue(undefined);
  });

  it('starts the wake-word engine with the configured microphone device', async () => {
    renderHook(() => useWakeWord({
      enabled: true,
      wakeWordEnabled: true,
      loaded: true,
      wakeWordArmed: true,
      micDeviceId: 'usb-mic-1',
      onWakeWordDetected: vi.fn(),
    }));

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith({ deviceId: 'usb-mic-1' });
    });
  });

  it('restarts the wake-word engine when the configured microphone changes while armed', async () => {
    const { rerender } = renderHook((props: {
      enabled: boolean;
      wakeWordEnabled: boolean;
      loaded: boolean;
      wakeWordArmed: boolean;
      micDeviceId?: string;
      onWakeWordDetected: () => void;
    }) => useWakeWord(props), {
      initialProps: {
        enabled: true,
        wakeWordEnabled: true,
        loaded: true,
        wakeWordArmed: true,
        micDeviceId: 'usb-mic-1',
        onWakeWordDetected: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledWith({ deviceId: 'usb-mic-1' });
    });

    startMock.mockClear();
    stopMock.mockClear();

    rerender({
      enabled: true,
      wakeWordEnabled: true,
      loaded: true,
      wakeWordArmed: true,
      micDeviceId: 'usb-mic-2',
      onWakeWordDetected: vi.fn(),
    });

    await waitFor(() => {
      expect(stopMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledWith({ deviceId: 'usb-mic-2' });
    });
  });
});
