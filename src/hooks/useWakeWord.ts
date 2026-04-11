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

interface UseWakeWordOptions {
  enabled: boolean;
  wakeWordEnabled: boolean;
  /** Wait for app data to be loaded before initializing. */
  loaded: boolean;
  /** Whether the detector should currently be armed. */
  wakeWordArmed: boolean;
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
  onWakeWordDetected,
}: UseWakeWordOptions): UseWakeWordReturn {
  const wakeEngineRef = useRef<InstanceType<typeof WakeWordEngine> | null>(null);
  const [wakeWordReady, setWakeWordReady] = useState(false);
  const handleWakeWordDetected = useEffectEvent(() => onWakeWordDetected());

  // ── Initialize / tear down OpenWakeWord engine ──
  useEffect(() => {
    if (!enabled || !wakeWordEnabled || !loaded || wakeEngineRef.current) return;

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

    engine.load()
      .then(() => engine.start())
      .then(() => {
        wakeEngineRef.current = engine;
        setWakeWordReady(true);
      })
      .catch((e) => {
        logError('useWakeWord', e);
      });

    return () => {
      if (wakeEngineRef.current) {
        wakeEngineRef.current.stop().catch(() => {});
        wakeEngineRef.current = null;
        setWakeWordReady(false);
      }
    };
  }, [enabled, wakeWordEnabled, loaded]);

  // ── Pause / resume wake word when Lina is in an active voice phase ──
  useEffect(() => {
    const engine = wakeEngineRef.current;
    if (!engine || !wakeWordReady) return;

    if (wakeWordArmed) {
      engine.start().catch(() => {});
    } else {
      engine.stop().catch(() => {});
    }
  }, [wakeWordArmed, wakeWordReady]);

  return { wakeWordReady };
}
