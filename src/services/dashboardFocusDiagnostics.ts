import type { DashboardFocusState, FocusCandidate, FocusRecommendation } from '../types/domain';

export interface DashboardFocusDiagnostics {
  recordedAt: string;
  status: 'ready' | 'fallback' | 'error';
  source: 'local' | 'openai';
  providerMode: 'auto' | 'hosted' | 'ollama';
  inputHash: string;
  selectedCandidateId?: string;
  queueCandidateIds: string[];
  candidateCount: number;
  stats: DashboardFocusState['stats'];
  model?: string;
  fallbackReason?: string;
  errorMessage?: string;
  latencyMs?: number;
  rawModelResponse?: string;
  recommendation?: FocusRecommendation | null;
  topCandidates: Array<Pick<FocusCandidate, 'id' | 'kind' | 'title' | 'score'>>;
}

type DashboardFocusDiagnosticsListener = (diagnostics: DashboardFocusDiagnostics | null) => void;

let latestDashboardFocusDiagnostics: DashboardFocusDiagnostics | null = null;
const listeners = new Set<DashboardFocusDiagnosticsListener>();

export function getDashboardFocusDiagnostics(): DashboardFocusDiagnostics | null {
  return latestDashboardFocusDiagnostics;
}

export function recordDashboardFocusDiagnostics(diagnostics: DashboardFocusDiagnostics): void {
  latestDashboardFocusDiagnostics = diagnostics;
  listeners.forEach(listener => listener(latestDashboardFocusDiagnostics));
}

export function clearDashboardFocusDiagnostics(): void {
  latestDashboardFocusDiagnostics = null;
  listeners.forEach(listener => listener(latestDashboardFocusDiagnostics));
}

export function subscribeDashboardFocusDiagnostics(
  listener: DashboardFocusDiagnosticsListener,
): () => void {
  listeners.add(listener);
  listener(latestDashboardFocusDiagnostics);
  return () => {
    listeners.delete(listener);
  };
}
