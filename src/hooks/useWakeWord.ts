/**
 * useWakeWord — OpenWakeWord lifecycle management.
 *
 * Initializes the wake word engine, starts/stops/pauses based on
 * assistant state, and fires a callback when the wake word is detected.
 */

import { useState, useRef, useEffect, useEffectEvent } from 'react';
import WakeWordEngine from 'openwakeword-wasm-browser';
import { TIMING } from '../config/constants';
import { logError } from '../services/logger';

function getMicDeviceKey(deviceId?: string): string {
  return deviceId || '__default__';
}

interface UseWakeWordOptions {
  enabled: boolean;
  wakeWordEnabled: boolean;
  /** Wait for app data to be loaded before initializing. */
  loaded: boolean;
  /** Whether the detector should currently be armed. */
  wakeWordArmed: boolean;
  /** The configured microphone device shared with STT. */
  micDeviceId?: string;
  onWakeWordDetected: () => void;
}

interface UseWakeWordReturn {
  wakeWordReady: boolean;
}

export function useWakeWord({
  enabled,
  wakeWordEnabled,
  loaded,
  wakeWordArmed,
  micDeviceId,
  onWakeWordDetected,
}: UseWakeWordOptions): UseWakeWordReturn {
  const wakeEngineRef = useRef<InstanceType<typeof WakeWordEngine> | null>(null);
  const wakeEngineRunningRef = useRef(false);
  const activeMicDeviceKeyRef = useRef<string | null>(null);
  const [wakeWordReady, setWakeWordReady] = useState(false);
  const handleWakeWordDetected = useEffectEvent(() => onWakeWordDetected());
  const startWakeEngine = useEffectEvent(async () => {
    const engine = wakeEngineRef.current;
    if (!engine) return;

    const nextMicDeviceKey = getMicDeviceKey(micDeviceId);
    if (wakeEngineRunningRef.current && activeMicDeviceKeyRef.current === nextMicDeviceKey) {
      return;
    }

    await engine.start(micDeviceId ? { deviceId: micDeviceId } : undefined);
    wakeEngineRunningRef.current = true;
    activeMicDeviceKeyRef.current = nextMicDeviceKey;
  });
  const stopWakeEngine = useEffectEvent(async () => {
    const engine = wakeEngineRef.current;
    if (!engine || !wakeEngineRunningRef.current) return;

    await engine.stop();
    wakeEngineRunningRef.current = false;
    activeMicDeviceKeyRef.current = null;
  });

  // ── Initialize / tear down OpenWakeWord engine ──
  useEffect(() => {
    if (!enabled || !wakeWordEnabled || !loaded || wakeEngineRef.current) return;

    let cancelled = false;
    const engine = new WakeWordEngine({
      keywords: ['hey_lina'],
      modelFiles: {
        hey_lina: 'hey_lina.onnx',
      },
      baseAssetUrl: `${import.meta.env.BASE_URL}openwakeword/models`,
      detectionThreshold: 0.5,
      cooldownMs: TIMING.WAKE_WORD_COOLDOWN,
    });

    engine.on('detect', ({ keyword }: { keyword: string; score: number }) => {
      if (keyword) {
        handleWakeWordDetected();
      }
    });
    wakeEngineRef.current = engine;

    engine.load()
      .then(() => {
        if (cancelled || wakeEngineRef.current !== engine) return;
        wakeEngineRef.current = engine;
        setWakeWordReady(true);
      })
      .catch((e) => {
        if (wakeEngineRef.current === engine) {
          wakeEngineRef.current = null;
        }
        logError('useWakeWord', e);
      });

    return () => {
      cancelled = true;
      if (wakeEngineRef.current === engine) {
        wakeEngineRef.current = null;
      }
      wakeEngineRunningRef.current = false;
      activeMicDeviceKeyRef.current = null;
      setWakeWordReady(false);
      engine.stop().catch(() => {});
    };
  }, [enabled, wakeWordEnabled, loaded]);

  // ── Pause / resume wake word when Lina is in an active voice phase ──
  useEffect(() => {
    const engine = wakeEngineRef.current;
    if (!engine || !wakeWordReady) return;

    const desiredMicDeviceKey = getMicDeviceKey(micDeviceId);

    if (!wakeWordArmed) {
      stopWakeEngine().catch((error) => {
        logError('useWakeWord', error);
      });
      return;
    }

    if (
      wakeEngineRunningRef.current
      && activeMicDeviceKeyRef.current !== desiredMicDeviceKey
    ) {
      void (async () => {
        try {
          await stopWakeEngine();
          await startWakeEngine();
        } catch (error) {
          logError('useWakeWord', error);
        }
      })();
      return;
    }

    startWakeEngine().catch((error) => {
      logError('useWakeWord', error);
    });
  }, [micDeviceId, wakeWordArmed, wakeWordReady]);

  return { wakeWordReady };
}
