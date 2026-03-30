import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from '../store/AppContext';
import { createElement, useEffect, useRef } from 'react';

type AppAPI = ReturnType<typeof useApp>;

async function renderWithApp() {
  const results: { api: AppAPI | null } = { api: null };

  function TestComponent() {
    const api = useApp();
    results.api = api;
    return null;
  }

  await act(async () => {
    render(createElement(AppProvider, null, createElement(TestComponent)));
  });

  await waitFor(() => {
    expect(results.api).not.toBeNull();
    expect(results.api!.loaded).toBe(true);
  });

  return results;
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
    let ev1 = '', ev2 = '', ev3 = '';
    act(() => {
      const accId = r.api!.addCalendarAccount({ name: 'T', email: 't@t.com', provider: 'local', isPrimary: false, connected: false, mocked: true });
      const srcId = r.api!.addCalendarSource({ accountId: accId, name: 'Cal', color: '#f00', visible: true });
      ev1 = r.api!.addCalendarEvent({ sourceId: srcId, title: 'E1', description: '', start: '2026-03-30T10:00:00Z', end: '2026-03-30T11:00:00Z', allDay: false });
      ev2 = r.api!.addCalendarEvent({ sourceId: srcId, title: 'E2', description: '', start: '2026-03-31T10:00:00Z', end: '2026-03-31T11:00:00Z', allDay: false });
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
});

describe('AppContext - Workspaces', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add, update, and remove workspaces', async () => {
    const r = await renderWithApp();
    let wsId = '';
    act(() => { wsId = r.api!.addWorkspace({ name: 'Project', path: '/code/proj', description: 'Main project', isPrimary: false }); });
    expect(r.api!.workspaces).toHaveLength(1);
    expect(r.api!.workspaces[0].isPrimary).toBe(true);

    act(() => { r.api!.updateWorkspace(wsId, { description: 'Updated' }); });
    expect(r.api!.workspaces[0].description).toBe('Updated');

    act(() => { r.api!.removeWorkspace(wsId); });
    expect(r.api!.workspaces).toHaveLength(0);
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

    act(() => { r.api!.sendMessage(convId, 'Hello'); });
    const conv = r.api!.conversations.find(c => c.id === convId);
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[0].role).toBe('user');
    expect(conv!.messages[1].role).toBe('assistant');
    expect(conv!.messages[1].content).toContain('[Mocked]');
  });

  it('should handle sendMessage for non-existent conversation', async () => {
    const r = await renderWithApp();
    act(() => { r.api!.sendMessage('new-conv-id', 'Test message'); });
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
