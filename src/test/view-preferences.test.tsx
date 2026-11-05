import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewPreferencesProvider, useViewPreference } from '../store/ViewPreferencesContext';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../services/backend/viewPreferencesApi', () => ({ getViewPreferences: api.get, saveViewPreference: api.save }));
vi.mock('../services/backend/profileServiceApi', () => ({ isProfileServiceEnabled: () => true }));
vi.mock('../services/backend/liveEvents', () => ({ subscribeLiveEvents: () => () => undefined }));

function Controls() {
  const [period, setPeriod] = useViewPreference<'day' | 'week' | 'month'>('prayerChallenge.period', 'month');
  const [steps, setSteps] = useViewPreference<boolean>('dashboard.learnIndividualSteps', false);
  return <><output aria-label="Period">{period}</output><output aria-label="Steps">{String(steps)}</output>
    <button onClick={() => setPeriod('day')}>Day</button><button onClick={() => setPeriod('week')}>Week</button>
    <button onClick={() => setSteps(value => !value)}>Toggle steps</button></>;
}
function App() { return <ViewPreferencesProvider><Controls /></ViewPreferencesProvider>; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('account-owned display preferences', () => {
  let server: Record<string, string>;
  beforeEach(() => {
    vi.clearAllMocks();
    server = { 'prayerChallenge.period': 'week' };
    api.get.mockImplementation(async () => ({ values: { ...server } }));
    api.save.mockImplementation(async (key: string, value: string) => {
      server[key] = value;
      return { key, value, updatedAt: '2026-11-05T12:00:00Z' };
    });
  });

  it('hydrates without saving defaults, then restores an explicit choice on a new mount', async () => {
    const first = render(<StrictMode><App /></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Day'));
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('day'));
    first.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('day'));
    expect(api.save).toHaveBeenCalledExactlyOnceWith('prayerChallenge.period', 'day');
  });

  it('confirms a save before showing it and coalesces duplicate clicks', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    const reply = deferred<{ key: string; value: string; updatedAt: string }>();
    api.save.mockReturnValueOnce(reply.promise);
    fireEvent.click(screen.getByText('Day')); fireEvent.click(screen.getByText('Day'));
    expect(screen.getByLabelText('Period')).toHaveTextContent('week');
    await act(async () => reply.resolve({ key: 'prayerChallenge.period', value: 'day', updatedAt: '2026-11-05T12:00:00Z' }));
    expect(screen.getByLabelText('Period')).toHaveTextContent('day');
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('preserves confirmed state on failure and retries only the explicit choice', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    api.save.mockRejectedValueOnce(new Error('Connection interrupted'));
    fireEvent.click(screen.getByText('Day'));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Period')).toHaveTextContent('week');
    fireEvent.click(screen.getByText('Retry preferences'));
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('day'));
    expect(api.save.mock.calls).toEqual([['prayerChallenge.period', 'day'], ['prayerChallenge.period', 'day']]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps different choices and the latest rapid toggle intent', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    const reply = deferred<{ key: string; value: string; updatedAt: string }>();
    api.save.mockReturnValueOnce(reply.promise);
    fireEvent.click(screen.getByText('Day'));
    fireEvent.click(screen.getByText('Toggle steps')); fireEvent.click(screen.getByText('Toggle steps'));
    fireEvent.click(screen.getByText('Toggle steps'));
    await act(async () => reply.resolve({ key: 'prayerChallenge.period', value: 'day', updatedAt: '2026-11-05T12:00:00Z' }));
    await waitFor(() => expect(screen.getByLabelText('Steps')).toHaveTextContent('true'));
    expect(api.save.mock.calls).toEqual([['prayerChallenge.period', 'day'], ['dashboard.learnIndividualSteps', 'true']]);
  });

  it('ignores a stale read that finishes after a confirmed save', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    const reply = deferred<{ values: Record<string, string> }>();
    api.get.mockReturnValueOnce(reply.promise);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.click(screen.getByText('Day'));
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('day'));
    await act(async () => reply.resolve({ values: { 'prayerChallenge.period': 'week' } }));
    expect(screen.getByLabelText('Period')).toHaveTextContent('day');
  });

  it('discards the old account response when the account shell is replaced', async () => {
    const old = deferred<{ values: Record<string, string> }>();
    api.get.mockReturnValueOnce(old.promise);
    const first = render(<App />); first.unmount();
    server = { 'prayerChallenge.period': 'day' };
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('day'));
    await act(async () => old.resolve({ values: { 'prayerChallenge.period': 'week' } }));
    expect(screen.getByLabelText('Period')).toHaveTextContent('day');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('refreshes another device’s change that arrives during a slow save', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveTextContent('week'));
    const reply = deferred<{ key: string; value: string; updatedAt: string }>();
    api.save.mockReturnValueOnce(reply.promise);
    fireEvent.click(screen.getByText('Day'));
    server['dashboard.learnIndividualSteps'] = 'true';
    fireEvent(document, new Event('visibilitychange'));
    server['prayerChallenge.period'] = 'day';
    await act(async () => reply.resolve({ key: 'prayerChallenge.period', value: 'day', updatedAt: '2026-11-05T12:00:00Z' }));
    await waitFor(() => expect(screen.getByLabelText('Steps')).toHaveTextContent('true'));
    expect(screen.getByLabelText('Period')).toHaveTextContent('day');
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('retries failed hydration without saving defaults and ignores unsupported values', async () => {
    api.get.mockRejectedValueOnce(new Error('Settings unavailable'));
    render(<App />);
    await screen.findByRole('alert');
    server = { 'prayerChallenge.period': 'year', 'arbitrary.token': 'never-use' };
    fireEvent.click(screen.getByText('Retry preferences'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Period')).toHaveTextContent('month');
    expect(api.save).not.toHaveBeenCalled();
  });
});
