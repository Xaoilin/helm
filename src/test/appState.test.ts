import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from '../store/AppContext';
import { createElement, type ReactNode } from 'react';

const { processAssistantCommandMock } = vi.hoisted(() => ({
  processAssistantCommandMock: vi.fn(),
}));

vi.mock('../services/assistantRuntime', () => ({
  isOllamaAvailable: vi.fn(),
  resetOllamaCache: vi.fn(),
  processAssistantCommand: processAssistantCommandMock,
}));

beforeEach(() => {
  processAssistantCommandMock.mockReset();
  processAssistantCommandMock.mockResolvedValue({
    assistantMessage: 'Opening calendar for you.',
    message: 'Opening calendar for you.',
    plan: { mode: 'act', response: 'Opening calendar for you.', confidence: 1, steps: [] },
    dialogState: {
      currentSurface: 'chat',
      recentEntities: [],
      recentPlans: [],
    },
    source: 'openai',
    planningSource: 'openai',
    planningStatus: 'planned',
  });
});

async function renderWithApp() {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AppProvider, null, children);
  const hook = renderHook(() => useApp(), { wrapper });

  await waitFor(() => {
    expect(hook.result.current.loaded).toBe(true);
  });

  return {
    get api() {
      return hook.result.current;
    },
  };
}

describe('AppContext - Calendar Accounts', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add a calendar account', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.addCalendarAccount({ name: 'Work', email: 'w@co.com', provider: 'google', isPrimary: false, connected: true, mocked: false }); });
    expect(r.api!.calendarAccounts).toHaveLength(1);
    expect(r.api!.calendarAccounts[0].name).toBe('Work');
  });

  it('should auto-set first account as primary', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.addCalendarAccount({ name: 'First', email: 'f@co.com', provider: 'google', isPrimary: false, connected: true, mocked: false }); });
    expect(r.api!.calendarAccounts[0].isPrimary).toBe(true);
  });

  it('should remove account and cascade to sources and events', async () => {
    const r = await renderWithApp();
    let accId: string = '';
    let srcId: string = '';
    act(() => {
      accId = r.api!.addCalendarAccount({ name: 'Test', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
    });
    act(() => {
      srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Default', color: '#f00', visible: true });
    });
    act(() => {
      r.api!.addCalendarEvent({ sourceId: srcId, title: 'Event', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false });
    });
    expect(r.api!.calendarSources).toHaveLength(1);
    expect(r.api!.calendarEvents).toHaveLength(1);

    act(() => { r.api!.removeCalendarAccount(accId); });
    expect(r.api!.calendarAccounts).toHaveLength(0);
    expect(r.api!.calendarSources).toHaveLength(0);
    expect(r.api!.calendarEvents).toHaveLength(0);
  });

  it('should promote next account to primary when primary is removed', async () => {
    const r = await renderWithApp();
    let acc1 = '', acc2 = '';
    act(() => { acc1 = r.api!.addCalendarAccount({ name: 'A', email: 'a@a.com', provider: 'local', isPrimary: false, connected: false, mocked: true }); });
    act(() => { acc2 = r.api!.addCalendarAccount({ name: 'B', email: 'b@b.com', provider: 'local', isPrimary: false, connected: false, mocked: true }); });
    expect(r.api!.calendarAccounts.find(a => a.id === acc1)?.isPrimary).toBe(true);
    act(() => { r.api!.removeCalendarAccount(acc1); });
    expect(r.api!.calendarAccounts[0].isPrimary).toBe(true);
    expect(r.api!.calendarAccounts[0].id).toBe(acc2);
  });
});

describe('AppContext - Calendar Sources', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add and toggle source visibility', async () => {
    const r = await renderWithApp();
    let srcId = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      srcId = r.api!.addCalendarSource({ accountId: accId, name: 'My Cal', color: '#00f', visible: true });
    });
    expect(r.api!.calendarSources[0].visible).toBe(true);
    act(() => { r.api!.updateCalendarSource(srcId, { visible: false }); });
    expect(r.api!.calendarSources[0].visible).toBe(false);
  });

  it('should cascade remove source events', async () => {
    const r = await renderWithApp();
    let srcId = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Cal', color: '#f00', visible: true });
    });
    act(() => {
      r.api!.addCalendarEvent({ sourceId: srcId, title: 'Ev1', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false });
      r.api!.addCalendarEvent({ sourceId: srcId, title: 'Ev2', description: '', start: '2026-03-31T10:00:00Z', end: '2026-03-31T11:00:00Z', allDay: false });
    });
    expect(r.api!.calendarEvents).toHaveLength(2);
    act(() => { r.api!.removeCalendarSource(srcId); });
    expect(r.api!.calendarSources).toHaveLength(0);
    expect(r.api!.calendarEvents).toHaveLength(0);
  });
});

describe('AppContext - Bulk Operations', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should bulk upsert calendar events (add new)', async () => {
    const r = await renderWithApp();
    let srcId = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Cal', color: '#f00', visible: true });
    });
    act(() => {
      r.api!.bulkUpsertCalendarEvents([
        { sourceId: srcId, title: 'E1', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false },
        { sourceId: srcId, title: 'E2', description: '', start: '2026-03-31T10:00:00Z', end: '2026-03-31T11:00:00Z', allDay: false },
      ]);
    });
    expect(r.api!.calendarEvents).toHaveLength(2);
  });

  it('should bulk upsert calendar events (update existing)', async () => {
    const r = await renderWithApp();
    let srcId = '', evtId = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Cal', color: '#f00', visible: true });
    });
    act(() => { evtId = r.api!.addCalendarEvent({ sourceId: srcId, title: 'Original', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false }); });
    act(() => {
      r.api!.bulkUpsertCalendarEvents([
        { id: evtId, sourceId: srcId, title: 'Updated', description: 'new desc', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false },
      ]);
    });
    expect(r.api!.calendarEvents).toHaveLength(1);
    expect(r.api!.calendarEvents[0].title).toBe('Updated');
  });

  it('should bulk remove calendar events', async () => {
    const r = await renderWithApp();
    let ev1 = '', ev3 = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      const srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Cal', color: '#f00', visible: true });
      ev1 = r.api!.addCalendarEvent({ sourceId: srcId, title: 'E1', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false });
      r.api!.addCalendarEvent({ sourceId: srcId, title: 'E2', description: '', start: '2026-03-31T10:00:00Z', end: '2026-03-31T11:00:00Z', allDay: false });
      ev3 = r.api!.addCalendarEvent({ sourceId: srcId, title: 'E3', description: '', start: '2026-04-01T10:00:00Z', end: '2026-04-01T11:00:00Z', allDay: false });
    });
    act(() => { r.api!.bulkRemoveCalendarEvents([ev1, ev3]); });
    expect(r.api!.calendarEvents).toHaveLength(1);
    expect(r.api!.calendarEvents[0].title).toBe('E2');
  });
});

describe('AppContext - Settings', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should update settings partially', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.updateSettings({ googleOAuthClientId: 'test-client-id' }); });
    expect(r.api!.settings.googleOAuthClientId).toBe('test-client-id');
    expect(r.api!.settings.theme).toBe('dark'); // other settings remain default
  });

  it('should update default calendar tab', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.updateSettings({ defaultCalendarTab: 'month' }); });
    expect(r.api!.settings.defaultCalendarTab).toBe('month');
  });

  it('should persist the selected hosted model in settings', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.updateSettings({ hostedModel: 'gpt-5.4-mini' }); });
    expect(r.api!.settings.hostedModel).toBe('gpt-5.4-mini');
  });
});

describe('AppContext - Projects', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add, update, and remove projects', async () => {
    const r = await renderWithApp();
    let projectId = '';
    act(() => {
      projectId = r.api!.addProject({
        name: 'Project',
        localPath: '/code/proj',
        summary: 'Main project',
        status: 'active',
        tags: ['frontend'],
        isPinned: true,
      });
    });
    expect(r.api!.projects).toHaveLength(1);
    expect(r.api!.projects[0].isPinned).toBe(true);
    expect(r.api!.projectPages.some(page => page.projectId === projectId && page.isOverview)).toBe(true);

    act(() => { r.api!.updateProject(projectId, { summary: 'Updated' }); });
    expect(r.api!.projects[0].summary).toBe('Updated');

    act(() => { r.api!.removeProject(projectId); });
    expect(r.api!.projects).toHaveLength(0);
    expect(r.api!.projectPages).toHaveLength(0);
  });

  it('should unlink tasks when a project is removed', async () => {
    const r = await renderWithApp();
    let projectId = '';
    let taskId = '';

    act(() => {
      projectId = r.api!.addProject({
        name: 'Project',
        localPath: '/code/proj',
        summary: '',
        status: 'active',
        tags: [],
        isPinned: false,
      });
      taskId = r.api!.addTask({
        title: 'Linked task',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        projectId,
        workflowState: 'backlog',
        boardOrder: 1,
      });
    });

    act(() => { r.api!.removeProject(projectId); });

    const task = r.api!.tasks.find(item => item.id === taskId);
    expect(task?.projectId).toBeUndefined();
    expect(task?.workflowState).toBeUndefined();
    expect(task?.boardOrder).toBeUndefined();
  });
});

describe('AppContext - Chat', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should create conversation and send messages', async () => {
    const r = await renderWithApp();
    let convId = '';
    act(() => { convId = r.api!.createConversation(); });
    expect(r.api!.conversations).toHaveLength(1);
    expect(r.api!.activeConversationId).toBe(convId);

    await act(async () => { await r.api!.sendMessage(convId, 'open calendar'); });
    const conv = r.api!.conversations.find(c => c.id === convId);
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[0].role).toBe('user');
    expect(conv!.messages[1].role).toBe('assistant');
    expect(conv!.messages[1].content.length).toBeGreaterThan(0); // Real LLM or mock reply
  });

  it('should handle sendMessage for non-existent conversation', async () => {
    const r = await renderWithApp();
    await act(async () => { await r.api!.sendMessage('new-conv-id', 'add task test message'); });
    expect(r.api!.conversations).toHaveLength(1);
    expect(r.api!.conversations[0].id).toBe('new-conv-id');
    expect(r.api!.activeConversationId).toBe('new-conv-id');
  });

  it('should delete conversation and clear active', async () => {
    const r = await renderWithApp();
    let convId = '';
    act(() => { convId = r.api!.createConversation(); });
    expect(r.api!.activeConversationId).toBe(convId);
    act(() => { r.api!.deleteConversation(convId); });
    expect(r.api!.conversations).toHaveLength(0);
    expect(r.api!.activeConversationId).toBeNull();
  });
});

describe('AppContext - Knowledge', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add, update, and remove topics', async () => {
    const r = await renderWithApp();
    let topicId = '';
    act(() => { topicId = r.api!.addKnowledgeTopic({ name: 'Pillars', description: 'Five pillars', icon: '\u{1F54C}', color: '#3b82f6', sortOrder: 0 }); });
    expect(r.api!.knowledgeTopics).toHaveLength(1);
    expect(r.api!.knowledgeTopics[0].name).toBe('Pillars');

    act(() => { r.api!.updateKnowledgeTopic(topicId, { name: 'Five Pillars' }); });
    expect(r.api!.knowledgeTopics[0].name).toBe('Five Pillars');

    act(() => { r.api!.removeKnowledgeTopic(topicId); });
    expect(r.api!.knowledgeTopics).toHaveLength(0);
  });

  it('should add, update, and remove entries', async () => {
    const r = await renderWithApp();
    let topicId = '';
    act(() => { topicId = r.api!.addKnowledgeTopic({ name: 'Test', description: '', icon: '\u{1F4D6}', color: '#3b82f6', sortOrder: 0 }); });

    let entryId = '';
    act(() => {
      entryId = r.api!.addKnowledgeEntry({
        topicId, title: 'Shahada', content: 'The declaration of faith',
        sources: [{ type: 'quran', surah: 3, ayahStart: 18 }], tags: ['pillar', 'faith'],
      });
    });
    expect(r.api!.knowledgeEntries).toHaveLength(1);
    expect(r.api!.knowledgeEntries[0].title).toBe('Shahada');
    expect(r.api!.knowledgeEntries[0].sources[0].type).toBe('quran');

    act(() => { r.api!.updateKnowledgeEntry(entryId, { content: 'Updated content' }); });
    expect(r.api!.knowledgeEntries[0].content).toBe('Updated content');

    act(() => { r.api!.removeKnowledgeEntry(entryId); });
    expect(r.api!.knowledgeEntries).toHaveLength(0);
  });

  it('should cascade delete entries when topic is removed', async () => {
    const r = await renderWithApp();
    let topicId = '';
    act(() => { topicId = r.api!.addKnowledgeTopic({ name: 'Topic', description: '', icon: '\u{1F4D6}', color: '#3b82f6', sortOrder: 0 }); });
    act(() => { r.api!.addKnowledgeEntry({ topicId, title: 'E1', content: '', sources: [], tags: [] }); });
    act(() => { r.api!.addKnowledgeEntry({ topicId, title: 'E2', content: '', sources: [], tags: [] }); });
    expect(r.api!.knowledgeEntries).toHaveLength(2);

    act(() => { r.api!.removeKnowledgeTopic(topicId); });
    expect(r.api!.knowledgeTopics).toHaveLength(0);
    expect(r.api!.knowledgeEntries).toHaveLength(0);
  });
});

describe('AppContext - Health', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add, update, and remove fast food entries', async () => {
    const r = await renderWithApp();
    let entryId = '';

    act(() => {
      entryId = r.api!.addFastFoodEntry({
        venue: 'McDonald\'s',
        date: '2026-04-20',
        order: 'Cheeseburger meal',
        rating: 'bad',
        symptoms: ['nauseous', 'sluggish'],
        notes: 'Felt nauseous for the rest of the day.',
      });
    });

    expect(r.api!.fastFoodEntries).toHaveLength(1);
    expect(r.api!.fastFoodEntries[0].venue).toBe('McDonald\'s');
    expect(r.api!.fastFoodEntries[0].rating).toBe('bad');

    act(() => {
      r.api!.updateFastFoodEntry(entryId, {
        rating: 'awful',
        notes: 'Still felt awful all afternoon.',
      });
    });

    expect(r.api!.fastFoodEntries[0].rating).toBe('awful');
    expect(r.api!.fastFoodEntries[0].notes).toBe('Still felt awful all afternoon.');

    act(() => { r.api!.removeFastFoodEntry(entryId); });
    expect(r.api!.fastFoodEntries).toHaveLength(0);
  });
});
