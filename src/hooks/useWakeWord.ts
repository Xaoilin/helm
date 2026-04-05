/**
 * useWakeWord — OpenWakeWord lifecycle management.
 *
 * Initializes the wake word engine, starts/stops/pauses based on
 * assistant state, and fires a callback when the wake word is detected.
 */

import { useState, useRef, useEffect } from 'react';
import WakeWordEngine from 'openwakeword-wasm-browser';
import { TIMING } from '../config/constants';
import { logError } from '../services/logger';

interface UseWakeWordOptions {
  enabled: boolean;
  wakeWordEnabled: boolean;
  /** Current assistant state — engine pauses when panel is open. */
  assistantIdle: boolean;
  onWakeWordDetected: () => void;
}

interface UseWakeWordReturn {
  wakeWordReady: boolean;
}

export function useWakeWord({
  enabled,
  wakeWordEnabled,
  assistantIdle,
  onWakeWordDetected,
}: UseWakeWordOptions): UseWakeWordReturn {
  const wakeEngineRef = useRef<InstanceType<typeof WakeWordEngine> | null>(null);
  const [wakeWordReady, setWakeWordReady] = useState(false);
  // Store callback in ref to avoid re-initializing engine when callback changes
  const callbackRef = useRef(onWakeWordDetected);
  callbackRef.current = onWakeWordDetected;

  // ── Initialize / tear down OpenWakeWord engine ──
  useEffect(() => {
    if (!enabled || !wakeWordEnabled || wakeEngineRef.current) return;

    const engine = new WakeWordEngine({
      keywords: ['hey_lina'],
      baseAssetUrl: `${import.meta.env.BASE_URL}openwakeword/models`,
      detectionThreshold: 0.5,
      cooldownMs: TIMING.WAKE_WORD_COOLDOWN,
    });

    engine.on('detect', ({ keyword }: { keyword: string; score: number }) => {
      if (keyword) {
        callbackRef.current();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wakeWordEnabled]);

  // ── Pause / resume wake word when assistant panel is open ──
  useEffect(() => {
    const engine = wakeEngineRef.current;
    if (!engine || !wakeWordReady) return;

    if (assistantIdle) {
      engine.start().catch(() => {});
    } else {
      engine.stop().catch(() => {});
    }
  }, [assistantIdle, wakeWordReady]);

  return { wakeWordReady };
}
