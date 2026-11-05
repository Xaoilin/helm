import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isViewPreference, type ViewPreferenceKey } from '../config/viewPreferences';
import { getViewPreferences, saveViewPreference } from '../services/backend/viewPreferencesApi';
import { isProfileServiceEnabled } from '../services/backend/profileServiceApi';
import { ServiceError } from '../services/backend/serviceClient';
import { useLiveRefresh } from './contexts/useLiveRefresh';
import './view-preferences.css';

type Values = Partial<Record<ViewPreferenceKey, string>>;
type Update<T> = T | ((current: T) => T);
interface ViewPreferencesContextValue {
  values: Values;
  choose: (key: ViewPreferenceKey, update: (current: string | undefined) => string | undefined) => void;
}
const ViewPreferencesContext = createContext<ViewPreferencesContextValue | null>(null);

/** Mounted inside the account-keyed app shell. Only confirmed values become shared UI state. */
export function ViewPreferencesProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef<Values>({});
  const pending = useRef(new Map<ViewPreferenceKey, string>());
  const ready = useRef(false);
  const mounted = useRef(false);
  const saving = useRef(false);
  const epoch = useRef(0);
  const readSequence = useRef(0);
  const failedRead = useRef(false);
  const refreshPending = useRef(false);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);

  const publish = useCallback((next: Values) => {
    confirmed.current = next;
    setValues(next);
  }, []);

  const fail = useCallback((failure: unknown) => {
    if (failure instanceof ServiceError && (failure.status === 401 || failure.status === 403)) {
      ready.current = false;
      pending.current.clear();
      publish({});
    }
    setError(failure instanceof Error ? failure.message : 'Display preferences are unavailable.');
  }, [publish]);

  const drain = useCallback(async () => {
    if (saving.current || !ready.current || !mounted.current) return;
    saving.current = true;
    setError(null);
    try {
      while (pending.current.size > 0 && mounted.current) {
        const [key, value] = pending.current.entries().next().value!;
        epoch.current += 1;
        const saved = await saveViewPreference(key, value);
        if (!mounted.current) return;
        if (saved.key !== key || saved.value !== value || !isViewPreference(saved.key, saved.value)) {
          throw new Error('The saved display preference could not be confirmed. Please retry.');
        }
        publish({ ...confirmed.current, [key]: saved.value });
        if (pending.current.get(key) === value) pending.current.delete(key);
        epoch.current += 1;
      }
    } catch (failure) {
      if (mounted.current) { failedRead.current = false; fail(failure); }
    } finally {
      saving.current = false;
      if (refreshPending.current && mounted.current) {
        refreshPending.current = false;
        void reloadRef.current?.();
      }
    }
  }, [fail, publish]);

  const reload = useCallback(async () => {
    if (!isProfileServiceEnabled()) return;
    if (saving.current) { refreshPending.current = true; return; }
    const sequence = ++readSequence.current;
    const beforeWrite = epoch.current;
    try {
      const response = await getViewPreferences();
      if (!mounted.current || sequence !== readSequence.current || epoch.current !== beforeWrite) return;
      const next: Values = {};
      for (const [key, value] of Object.entries(response.values)) {
        if (isViewPreference(key, value)) next[key] = value;
      }
      publish(next);
      ready.current = true;
      failedRead.current = false;
      setError(null);
      await drain();
    } catch (failure) {
      if (mounted.current && sequence === readSequence.current && epoch.current === beforeWrite) {
        failedRead.current = true;
        fail(failure);
      }
    }
  }, [drain, fail, publish]);

  useEffect(() => { reloadRef.current = reload; }, [reload]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const whenShown = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', whenShown);
    return () => {
      mounted.current = false;
      readSequence.current += 1;
      document.removeEventListener('visibilitychange', whenShown);
    };
  }, [reload]);
  useLiveRefresh(['profile'], reload);

  const choose = useCallback((key: ViewPreferenceKey, update: (current: string | undefined) => string | undefined) => {
    const value = update(pending.current.get(key) ?? confirmed.current[key]);
    if (value === undefined || !isViewPreference(key, value)) return;
    if (value === confirmed.current[key] && !pending.current.has(key)) return;
    pending.current.set(key, value);
    if (!isProfileServiceEnabled()) {
      setError('Your display preferences are not connected. Please try again.');
      return;
    }
    void (ready.current ? drain() : reload());
  }, [drain, reload]);

  const retry = () => { void (ready.current && !failedRead.current ? drain() : reload()); };
  return <ViewPreferencesContext.Provider value={{ values, choose }}>
    {children}
    {error && <div className="view-preference-notice" role="alert">
      <span>Your display choice could not be saved or loaded. {error}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>Retry preferences</button>
    </div>}
  </ViewPreferencesContext.Provider>;
}

export function useViewPreference<T extends string | boolean>(key: ViewPreferenceKey, fallback: T): [T, (update: Update<T>) => void] {
  const context = useContext(ViewPreferencesContext);
  // Standalone components outside the signed-in shell (tests and previews) keep local display state.
  const [standalone, setStandalone] = useState<T>(fallback);
  const decode = useCallback((value: string | undefined): T => value === undefined ? fallback
    : (typeof fallback === 'boolean' ? value === 'true' : value) as T, [fallback]);
  const chooseShared = context?.choose;
  const value = context ? decode(context.values[key]) : standalone;
  const choose = useCallback((update: Update<T>) => {
    if (!chooseShared) { setStandalone(update); return; }
    chooseShared(key, current => {
      const previous = decode(current);
      const next = typeof update === 'function' ? update(previous) : update;
      return next === previous ? undefined : String(next);
    });
  }, [chooseShared, decode, key]);
  return [value, choose];
}
