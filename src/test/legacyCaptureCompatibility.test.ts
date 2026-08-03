import { describe, expect, it } from 'vitest';
import { normaliseDialogState } from '../assistant/dialogState';
import type { AssistantDialogState } from '../assistant/shared';
import { normalizeAssistantActivityEntry } from '../store/contexts/AssistantActivityContext';
import type { AssistantActivityEntry } from '../types/domain';

describe('retired Capture compatibility', () => {
  it('drops stale Inbox, Capture entities, plans, and confirmations from Lina state', () => {
    const stale = {
      currentSurface: 'inbox',
      recentEntities: [{
        kind: 'capture_item',
        id: 'capture-1',
        label: 'Old note',
        surface: 'inbox',
        lastUsedAt: '2026-08-03T00:00:00.000Z',
      }],
      recentPlans: [{
        mode: 'tool_calls',
        capabilityIds: ['capture.add_item'],
        response: 'Saved',
        createdAt: '2026-08-03T00:00:00.000Z',
      }],
      pendingConfirmation: {
        assistantMessage: 'Save this?',
        toolCalls: [{
          callId: 'call-1',
          capability: 'capture.add_item',
          args: { content: 'Old note' },
        }],
        referencedEntities: [],
        createdAt: '2026-08-03T00:00:00.000Z',
        source: 'openai',
      },
    } as unknown as AssistantDialogState;

    expect(normaliseDialogState(stale)).toEqual({
      currentSurface: undefined,
      recentEntities: [],
      recentPlans: [],
      pendingConfirmation: undefined,
      pendingPrayerCompletion: undefined,
    });
  });

  it('keeps historical activity visible but removes the retired Capture undo', () => {
    const stale = {
      id: 'activity-1',
      actor: 'chat',
      domain: 'capture',
      action: 'created',
      summary: 'Saved to Inbox',
      details: [],
      entityRefs: [],
      status: 'applied',
      createdAt: '2026-08-03T00:00:00.000Z',
      undoOperation: { type: 'capture.delete', id: 'capture-1' },
    } as unknown as AssistantActivityEntry;

    expect(normalizeAssistantActivityEntry(stale)).toMatchObject({
      id: 'activity-1',
      summary: 'Saved to Inbox',
      undoOperation: undefined,
    });
  });
});
