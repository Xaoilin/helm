import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmploymentTrackerState } from '../services/employmentTracker';
import {
  EmploymentProvider,
  useEmploymentContext,
  type EmploymentContextValue,
} from '../store/contexts/EmploymentContext';
import type { EmploymentApplication } from '../types/domain';

const api = vi.hoisted(() => ({
  getJobApplications: vi.fn(),
  addJobApplication: vi.fn(),
  updateJobApplication: vi.fn(),
  addJobHistory: vi.fn(),
  removeJobApplication: vi.fn(),
}));

vi.mock('../services/backend/lifeServiceApi', () => ({ ...api, isLifeServiceEnabled: () => true }));

let context: EmploymentContextValue;

function EmploymentProbe() {
  const current = useEmploymentContext();
  useEffect(() => { context = current; }, [current]);
  const { applications, error, loaded } = current;
  return <output>{`${loaded ? 'loaded' : 'loading'}|${applications.length}|${error ?? ''}`}</output>;
}

function change(application: EmploymentApplication | null, applicationId = application?.id ?? '', duplicate = false) {
  return { applicationId, application, duplicate };
}

async function renderLoaded(applications: EmploymentApplication[]) {
  api.getJobApplications.mockResolvedValue(applications);
  render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
  await screen.findByText(`loaded|${applications.length}|`);
}

describe('EmploymentContext', () => {
  const seeded = createDefaultEmploymentTrackerState().applications;
  const existing = seeded[0];

  beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset());
  });

  it('loads the applications the service holds', async () => {
    await renderLoaded(seeded);
    expect(context.applications).toEqual(seeded);
    expect(context.error).toBeNull();
    expect(api.getJobApplications).toHaveBeenCalledOnce();
  });

  it('shows a load failure and clears it when a retry succeeds', async () => {
    api.getJobApplications.mockRejectedValueOnce(new Error('Employment backend temporarily unavailable.'))
      .mockResolvedValueOnce(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|0|Employment backend temporarily unavailable.');

    await act(async () => { await context.retryLoad(); });

    expect(screen.getByText(`loaded|${seeded.length}|`)).toBeInTheDocument();
    expect(context.applications).toEqual(seeded);
  });

  it('adds an application with an ID it reuses when the first attempt fails, and shows the saved copy', async () => {
    await renderLoaded([]);
    const saved = { ...existing, id: 'will-be-replaced', updatedAt: '2026-09-20T10:00:00.000Z' };
    api.addJobApplication.mockRejectedValueOnce(new Error('Connection lost'))
      .mockImplementationOnce(async (input: EmploymentApplication) => change({ ...saved, id: input.id }));

    await act(async () => { await expect(context.addApplication(existing)).rejects.toThrow('Connection lost'); });
    expect(context.error).toBe('Connection lost');
    let addedId = '';
    await act(async () => { addedId = await context.addApplication(existing); });

    const [first, retry] = api.addJobApplication.mock.calls.map(call => call[0]);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ id: expect.any(String), company: existing.company, role: existing.role });
    expect(addedId).toBe(first.id);
    expect(context.applications).toEqual([{ ...saved, id: first.id }]);
    expect(context.error).toBeNull();
  });

  it('shows the first save when the service reports a retried add as a duplicate', async () => {
    await renderLoaded([]);
    api.addJobApplication.mockResolvedValue(change(existing, existing.id, true));

    let addedId = '';
    await act(async () => { addedId = await context.addApplication(existing); });

    expect(addedId).toBe(existing.id);
    expect(context.applications).toEqual([existing]);
  });

  it('sends only the changed fields, clears emptied ones and posts new history entries after the update', async () => {
    await renderLoaded(seeded);
    const newEntry = { id: 'history-new', kind: 'note' as const, date: '2026-09-21', summary: ' Chased recruiter ', details: '' };
    const patched = { ...existing, notes: 'Updated note', url: undefined, updatedAt: '2026-09-21T10:00:00.000Z' };
    const withHistory = { ...patched, history: [...existing.history, { ...newEntry, summary: 'Chased recruiter' }] };
    api.updateJobApplication.mockResolvedValue(change(patched));
    api.addJobHistory.mockResolvedValue(change(withHistory));

    await act(async () => {
      await context.updateApplication(existing.id, {
        notes: ' Updated note ', url: undefined, history: [...existing.history, newEntry],
      });
    });

    expect(api.updateJobApplication).toHaveBeenCalledWith(existing.id, { notes: 'Updated note' }, ['url'], existing.updatedAt);
    expect(api.addJobHistory).toHaveBeenCalledTimes(1);
    expect(api.addJobHistory).toHaveBeenCalledWith(existing.id, expect.objectContaining({ id: 'history-new', summary: 'Chased recruiter' }));
    expect(api.updateJobApplication.mock.invocationCallOrder[0]).toBeLessThan(api.addJobHistory.mock.invocationCallOrder[0]);
    expect(context.applications[0]).toEqual(withHistory);
    expect(context.applications.slice(1)).toEqual(seeded.slice(1));
  });

  it('sends the editor original version and keeps the application when the service refuses a stale edit', async () => {
    await renderLoaded(seeded);
    api.updateJobApplication.mockRejectedValue(new Error('Employment application changed; reload before saving.'));

    await act(async () => {
      await expect(context.updateApplication(existing.id, { notes: 'Old editor note' }, '2026-09-01T00:00:00.000Z'))
        .rejects.toThrow('Employment application changed; reload before saving.');
    });

    expect(api.updateJobApplication).toHaveBeenCalledWith(existing.id, { notes: 'Old editor note' }, [], '2026-09-01T00:00:00.000Z');
    expect(api.addJobHistory).not.toHaveBeenCalled();
    expect(context.error).toBe('Employment application changed; reload before saving.');
    expect(context.applications).toEqual(seeded);
  });

  it('adds a history entry with a new ID and shows the saved application', async () => {
    await renderLoaded(seeded);
    const saved = { ...existing, history: [...existing.history, { id: 'x', kind: 'note' as const, summary: 'Follow up', details: '' }] };
    api.addJobHistory.mockResolvedValue(change(saved));

    await act(async () => {
      await context.addHistoryEntry(existing.id, { date: '2026-09-21', kind: 'note', summary: ' Follow up ', details: '' });
    });

    expect(api.addJobHistory).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      id: expect.any(String), date: '2026-09-21', kind: 'note', summary: 'Follow up',
    }));
    expect(context.applications[0]).toEqual(saved);
  });

  it('removes an application only after the service confirms it', async () => {
    await renderLoaded(seeded);
    api.removeJobApplication.mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce(change(null, existing.id));

    await act(async () => { await expect(context.removeApplication(existing.id)).rejects.toThrow('Service unavailable'); });
    expect(context.applications).toEqual(seeded);
    await act(async () => { await context.removeApplication(existing.id); });

    expect(api.removeJobApplication).toHaveBeenLastCalledWith(existing.id, existing.updatedAt);
    expect(context.applications).toEqual(seeded.slice(1));
  });

  it('refuses to change an application it does not hold without contacting the service', async () => {
    await renderLoaded(seeded);

    await act(async () => {
      await expect(context.updateApplication('missing', { notes: 'x' })).rejects.toThrow('not found');
      await expect(context.removeApplication('missing')).rejects.toThrow('not found');
    });

    expect(api.updateJobApplication).not.toHaveBeenCalled();
    expect(api.removeJobApplication).not.toHaveBeenCalled();
  });
});
