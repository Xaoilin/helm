import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateCapabilityCompositionSources,
  readCapabilityCompositionSources,
} from '../../scripts/lib/capabilityCompositionPolicy.mjs';
import {
  executeAssistantActivityUndo,
  type AssistantUndoDependencies,
} from '../store/contexts/AssistantUndoContext';
import type { AssistantActivityEntry } from '../types/domain';

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

  it('keeps provider order, readiness, Chat, Google Sync, and undo ownership explicit', () => {
    const providers = readFileSync(resolve(root, 'src/store/AppProviders.tsx'), 'utf8');
    const shell = readFileSync(resolve(root, 'src/store/ShellContext.tsx'), 'utf8');
    const sources = readCapabilityCompositionSources(root);
    const providerOrder = [
      '<SettingsProvider>',
      '<GamificationProvider>',
      '<CalendarProvider>',
      '<ProjectProvider>',
      '<TaskProvider>',
      '<PrayerProvider>',
      '<AssistantProvider>',
      '<AssistantActivityProvider>',
      '<ChatBridge>',
      '<ShellProvider>',
      '<AssistantUndoProvider>',
      '<GoogleSyncBridge>',
    ].map(marker => providers.indexOf(marker));

    expect(providerOrder.every(index => index >= 0)).toBe(true);
    expect(providerOrder).toEqual([...providerOrder].sort((left, right) => left - right));
    expect(shell).toContain('function AppReadinessGate');
    expect(providers).toContain('<ChatProvider crossDomain={crossDomain}>');
    expect(providers).toContain('<GoogleSyncProvider app={app}>');
    expect(existsSync(resolve(root, 'src/store/AppContext.tsx'))).toBe(false);

    const undoOwners = Object.entries(sources)
      .filter(([, source]) => source.includes('switch (operation.type)'))
      .map(([path]) => path);
    expect(undoOwners).toEqual(['src/store/contexts/AssistantUndoContext.tsx']);
  });
});

describe('assistant undo workflow coordinator', () => {
  it('applies one domain inverse and records one successful undo', () => {
    const removeTask = vi.fn();
    const markAssistantActivityUndone = vi.fn();
    const entry: AssistantActivityEntry = {
      id: 'activity-1',
      actor: 'chat',
      domain: 'tasks',
      action: 'created',
      summary: 'Created task',
      details: [],
      entityRefs: [],
      status: 'applied',
      createdAt: '2026-08-29T10:00:00.000Z',
      undoOperation: { type: 'task.delete', id: 'task-1' },
    };
    const dependencies = {
      activity: {
        markAssistantActivityUndone,
        markAssistantActivityUndoFailed: vi.fn(),
      },
      calendar: {
        calendarEvents: [],
        removeCalendarEvent: vi.fn(),
        updateCalendarEvent: vi.fn(),
      },
      finance: { transactions: [], removeTransaction: vi.fn() },
      gamification: { updateGamification: vi.fn() },
      knowledge: { removeKnowledgeEntry: vi.fn() },
      prayer: { undoPrayerCompletion: vi.fn() },
      tasks: { tasks: [], removeTask, setTasks: vi.fn() },
    } as unknown as AssistantUndoDependencies;

    expect(executeAssistantActivityUndo(entry, dependencies)).toEqual({
      ok: true,
      message: 'Undid: Created task',
    });
    expect(removeTask).toHaveBeenCalledOnce();
    expect(removeTask).toHaveBeenCalledWith('task-1');
    expect(markAssistantActivityUndone).toHaveBeenCalledOnce();
    expect(markAssistantActivityUndone).toHaveBeenCalledWith('activity-1');
  });
});
