import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateCapabilityCompositionSources,
  readCapabilityCompositionSources,
} from '../../scripts/lib/capabilityCompositionPolicy.mjs';

const root = resolve(__dirname, '../..');

describe('capability-shaped application composition', () => {
  it('accepts the current production graph and rejects a representative all-domain bag', () => {
    expect(evaluateCapabilityCompositionSources(
      readCapabilityCompositionSources(root),
    )).toEqual({ failures: [], ok: true });

    const forbidden = evaluateCapabilityCompositionSources({
      'src/store/CapabilityBundle.ts': `
        interface CapabilityBundle {
          calendarEvents: unknown[];
          tasks: unknown[];
          projects: unknown[];
          inventoryItems: unknown[];
          financeAccounts: unknown[];
          settings: unknown;
        }
      `,
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.failures).toContain(
      'src/store/CapabilityBundle.ts declares broad CapabilityBundle across 6 domains without a workflow-shaped boundary.',
    );

    expect(evaluateCapabilityCompositionSources({
      'src/store/services.ts': 'export const useServices = () => ({});',
    }).failures).toContain(
      'src/store/services.ts uses forbidden application service-locator identifier useServices.',
    );
  });

  it('keeps provider order and readiness ownership explicit', () => {
    const providers = readFileSync(resolve(root, 'src/store/AppProviders.tsx'), 'utf8');
    const shell = readFileSync(resolve(root, 'src/store/ShellContext.tsx'), 'utf8');
    const pageGate = readFileSync(resolve(root, 'src/store/PageReadinessGate.tsx'), 'utf8');
    const providerOrder = [
      '<ShellProvider>',
      '<SettingsProvider>',
      '<GamificationProvider>',
      '<CalendarProvider>',
      '<ProjectProvider>',
      '<TaskProvider>',
      '<PrayerProvider>',
      '<DailyTaskRollover />',
      '<ClockProvider>',
      '<MilestoneCelebrationProvider>',
    ].map(marker => providers.indexOf(marker));

    expect(providerOrder.every(index => index >= 0)).toBe(true);
    expect(providerOrder).toEqual([...providerOrder].sort((left, right) => left - right));
    expect(pageGate).toContain('function PageReadinessGate');
    expect(shell).not.toContain('ReadinessGate');
    expect(providers).not.toContain('DashboardFocus');
    expect(shell).not.toContain('DashboardFocus');
    // The Lina assistant was removed: no Chat, assistant or undo providers remain.
    expect(providers).not.toMatch(/Chat|Assistant|Undo/u);
    // Google Calendar sync runs in the calendar service, not in the browser.
    expect(providers).not.toContain('GoogleSync');
    expect(existsSync(resolve(root, 'src/store/AppContext.tsx'))).toBe(false);
  });
});

