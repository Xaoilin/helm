/**
 * The job tracker, owned by the life admin service. Every change is confirmed by the service before it
 * shows: the page waits for the saved application. A retried add reuses its ID, so the service reports
 * the first save instead of adding the application twice.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import {
  addJobApplication,
  addJobHistory,
  getJobApplications,
  isLifeServiceEnabled,
  removeJobApplication,
  updateJobApplication,
  type ApplicationFields,
} from '../../services/backend/lifeServiceApi';
import {
  normalizeEmploymentApplicationDraft,
  type EmploymentApplicationDraft,
} from '../../services/employmentTracker';
import { observeOperationalOperation } from '../../services/operationalTelemetry';
import type { EmploymentApplication, EmploymentHistoryEntry } from '../../types/domain';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { errorMessage, useServiceLoad } from './useServiceLoad';

export interface EmploymentContextValue {
  applications: EmploymentApplication[];
  loaded: boolean;
  saving: boolean;
  error: string | null;
  retryLoad: () => Promise<void>;
  addApplication: (draft: EmploymentApplicationDraft) => Promise<string>;
  updateApplication: (id: string, updates: Partial<EmploymentApplicationDraft>, expectedUpdatedAt?: string) => Promise<void>;
  addHistoryEntry: (applicationId: string, entry: Omit<EmploymentHistoryEntry, 'id'>) => Promise<void>;
  removeApplication: (id: string, expectedUpdatedAt?: string) => Promise<void>;
}

/** Optional fields the service clears when an edit empties them. */
const CLEARABLE_FIELDS = ['url', 'remoteCaveat', 'compensation', 'applicationDate', 'nextActionDate'] as const;

export const EmploymentContext = createContext<EmploymentContextValue | null>(null);

export function useEmploymentContext(): EmploymentContextValue {
  const context = useContext(EmploymentContext);
  if (!context) throw new Error('useEmploymentContext must be used within EmploymentProvider');
  return context;
}

/** The fields an edit sets, and the optional ones it empties. */
export function applicationPatch(updates: Partial<EmploymentApplicationDraft>, normalized: EmploymentApplicationDraft) {
  const fields: Partial<ApplicationFields> = {};
  const clear: string[] = [];
  for (const key of Object.keys(updates) as Array<keyof EmploymentApplicationDraft>) {
    if (key === 'history') continue;
    const value = normalized[key];
    if (value === undefined || value === '') {
      if ((CLEARABLE_FIELDS as readonly string[]).includes(key)) clear.push(key);
    } else {
      Object.assign(fields, { [key]: value });
    }
  }
  return { fields, clear };
}

export function EmploymentProvider({ children }: { children: ReactNode }) {
  const [applications, setApplications] = useState<EmploymentApplication[]>([]);
  const applicationsRef = useRef<EmploymentApplication[]>([]);
  const [pending, setPending] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null);
  const addAttempts = useRef(new Map<string, string>());

  const publish = useCallback((next: EmploymentApplication[]) => {
    applicationsRef.current = next;
    setApplications(next);
  }, []);
  const load = useCallback(async () => publish(await getJobApplications()), [publish]);
  const { loaded, error: loadError, reload } = useServiceLoad('Employment', isLifeServiceEnabled(), load, LIVE_DOMAINS.employment);

  const confirm = useCallback((saved: EmploymentApplication | null, id: string) => {
    const current = applicationsRef.current;
    if (!saved) publish(current.filter(application => application.id !== id));
    else if (current.some(application => application.id === id)) {
      publish(current.map(application => (application.id === id ? saved : application)));
    } else publish([...current, saved]);
  }, [publish]);

  /** Runs one write, counting it as saving and keeping its error for the page. */
  const run = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    setPending(count => count + 1);
    setWriteError(null);
    try {
      return await observeOperationalOperation('employment', 'write', write);
    } catch (failure) {
      setWriteError(errorMessage(failure));
      throw failure;
    } finally {
      setPending(count => count - 1);
    }
  }, []);

  const addApplication = useCallback(async (draft: EmploymentApplicationDraft) => {
    const normalized = normalizeEmploymentApplicationDraft(draft);
    const attemptKey = JSON.stringify(normalized);
    const id = addAttempts.current.get(attemptKey) ?? uuid();
    addAttempts.current.set(attemptKey, id);
    const change = await run(() => addJobApplication({ ...normalized, id }));
    addAttempts.current.delete(attemptKey);
    confirm(change.application, change.applicationId);
    return change.applicationId;
  }, [confirm, run]);

  const updateApplication = useCallback(async (id: string, updates: Partial<EmploymentApplicationDraft>,
    expectedUpdatedAt?: string) => {
    const existing = applicationsRef.current.find(application => application.id === id);
    if (!existing) throw new Error('Employment application not found.');
    const normalized = normalizeEmploymentApplicationDraft({ ...existing, ...updates });
    const { fields, clear } = applicationPatch(updates, normalized);
    const known = new Set(existing.history.map(entry => entry.id));
    const newHistory = normalized.history.filter(entry => !known.has(entry.id));
    await run(async () => {
      let change = await updateJobApplication(id, fields, clear, expectedUpdatedAt ?? existing.updatedAt);
      for (const entry of newHistory) change = await addJobHistory(id, entry);
      confirm(change.application, id);
    });
  }, [confirm, run]);

  const addHistoryEntry = useCallback(async (applicationId: string, entry: Omit<EmploymentHistoryEntry, 'id'>) => {
    const existing = applicationsRef.current.find(application => application.id === applicationId);
    if (!existing) throw new Error('Employment application not found.');
    const withId = { ...entry, id: uuid() };
    const normalized = normalizeEmploymentApplicationDraft({ ...existing, history: [withId] }).history[0];
    const change = await run(() => addJobHistory(applicationId, normalized));
    confirm(change.application, applicationId);
  }, [confirm, run]);

  const removeApplication = useCallback(async (id: string, expectedUpdatedAt?: string) => {
    const existing = applicationsRef.current.find(application => application.id === id);
    if (!existing) throw new Error('Employment application not found.');
    await run(() => removeJobApplication(id, expectedUpdatedAt ?? existing.updatedAt));
    confirm(null, id);
  }, [confirm, run]);

  const value = useMemo<EmploymentContextValue>(() => ({
    applications,
    loaded,
    saving: pending > 0,
    error: writeError ?? loadError,
    retryLoad: reload,
    addApplication,
    updateApplication,
    addHistoryEntry,
    removeApplication,
  }), [applications, loaded, pending, writeError, loadError, reload, addApplication, updateApplication,
    addHistoryEntry, removeApplication]);

  return <EmploymentContext.Provider value={value}>{children}</EmploymentContext.Provider>;
}
