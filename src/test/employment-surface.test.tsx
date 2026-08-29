import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmploymentTrackerState } from '../services/employmentTracker';
import EmploymentSurface from '../surfaces/EmploymentSurface';

const mocks = vi.hoisted(() => ({
  employment: {
    applications: [] as ReturnType<typeof createDefaultEmploymentTrackerState>['applications'],
    loaded: true,
    saving: false,
    error: null as string | null,
    addApplication: vi.fn().mockResolvedValue('new-id'),
    updateApplication: vi.fn().mockResolvedValue(undefined),
    addHistoryEntry: vi.fn().mockResolvedValue(undefined),
    removeApplication: vi.fn().mockResolvedValue(undefined),
  },
  settings: {
    appTimeZone: { effectiveTimeZone: 'Europe/London' },
  },
}));

vi.mock('../store/contexts/EmploymentContext', () => ({
  useEmploymentContext: () => mocks.employment,
}));
vi.mock('../store/contexts/SettingsContext', () => ({
  useSettingsContext: () => mocks.settings,
}));

describe('Employment surface', () => {
  beforeEach(() => {
    mocks.employment.applications = createDefaultEmploymentTrackerState().applications;
    mocks.employment.error = null;
    mocks.employment.saving = false;
    mocks.employment.addApplication.mockClear();
    mocks.employment.updateApplication.mockClear();
    mocks.employment.removeApplication.mockClear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the confirmed pipeline and a useful filter-empty state', () => {
    render(<EmploymentSurface />);

    expect(screen.getByRole('heading', { name: 'Keep every opportunity moving.' })).toBeInTheDocument();
    expect(screen.getByText(/Prayer, Learn, and Move remain Sabah One’s daily foundation\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Staff AI Engineer, 2nd Horizon, UK Remote' })).toBeInTheDocument();
    expect(screen.getByText('The advert also mentions in-person onboarding. Confirm the onboarding expectation before progressing.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search company, role, note, compensation…'), {
      target: { value: 'no matching role' },
    });
    expect(screen.getByRole('heading', { name: 'No opportunities match' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Senior Software Engineer, Protocols' })).toBeInTheDocument();
  });

  it('focuses the editor, closes with Escape, and restores the trigger', () => {
    render(<EmploymentSurface />);
    const trigger = screen.getByRole('button', { name: '+ Add opportunity' });

    fireEvent.click(trigger);
    const company = screen.getByRole('textbox', { name: 'Company' });
    expect(company).toHaveFocus();

    fireEvent.keyDown(company, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add opportunity' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('submits a validated opportunity through the Employment domain owner', async () => {
    render(<EmploymentSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add opportunity' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Company' }), { target: { value: 'Example Ltd' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Role' }), { target: { value: 'Platform Engineer' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fully remote evidence' }), { target: { value: 'Advert confirms remote work.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Next action' }), { target: { value: 'Apply' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }));
    });

    expect(mocks.employment.addApplication).toHaveBeenCalledWith(expect.objectContaining({
      company: 'Example Ltd',
      role: 'Platform Engineer',
      workType: 'contract',
      remoteStatus: 'needs_verification',
      remoteEvidence: 'Advert confirms remote work.',
      nextAction: 'Apply',
    }));
  });
});
