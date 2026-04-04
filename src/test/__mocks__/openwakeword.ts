// Mock OpenWakeWord for test environment (WASM can't run in jsdom)
export class WakeWordEngine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config?: Record<string, unknown>) {}
  on() { return () => {}; }
  off() {}
  async load() {}
  async start() {}
  async stop() {}
}

export default WakeWordEngine;
