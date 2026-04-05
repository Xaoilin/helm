declare module 'openwakeword-wasm-browser' {
  interface WakeWordEngineConfig {
    keywords?: string[];
    modelFiles?: Record<string, string>;
    baseAssetUrl?: string;
    ortWasmPath?: string;
    detectionThreshold?: number;
    cooldownMs?: number;
    debug?: boolean;
  }

  interface DetectionEvent {
    keyword: string;
    score: number;
    at?: number;
  }

  class WakeWordEngine {
    constructor(config?: WakeWordEngineConfig);
    on(event: 'detect', handler: (e: DetectionEvent) => void): () => void;
    on(event: 'ready' | 'speech-start' | 'speech-end', handler: () => void): () => void;
    on(event: 'error', handler: (e: Error) => void): () => void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    load(): Promise<void>;
    start(options?: { deviceId?: string; gain?: number }): Promise<void>;
    stop(): Promise<void>;
  }

  export { WakeWordEngine };
  export default WakeWordEngine;
}
