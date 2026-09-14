import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepresentativeEmploymentState } from '../../e2e/support/employment-scenario';
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

const ACTIVE_APPLICATION_COUNT = 9;
const ALL_APPLICATION_COUNT = 11;

describe('Employment surface', () => {
  beforeEach(() => {
    mocks.employment.applications = createRepresentativeEmploymentState().applications;
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

  it('groups applications without losing roles and orders them by confirmed activity dates', () => {
    const { container } = render(<EmploymentSurface />);

    expect(screen.getByRole('heading', { name: 'Employment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add opportunity' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Employment applications' });

    expect(container.querySelectorAll('tbody.employment-company-group')).toHaveLength(6);
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ACTIVE_APPLICATION_COUNT);
    expect(within(table).queryByRole('button', {
      name: 'Show details for MICRO1: Staff Platform Engineer — Cloud Evaluation Rubrics',
    })).not.toBeInTheDocument();

    const roleButtons = within(table).getAllByRole('button', { name: /^Show details for / });
    expect(roleButtons[0]).toHaveAccessibleName(
      'Show details for micro1: Senior Backend Engineer — AI Evaluation Platform',
    );

    const details = container.querySelector<HTMLElement>('#employment-details');
    expect(details).not.toBeNull();
    expect(within(details!).getByRole('heading', { name: 'Details & history' })).toBeInTheDocument();
    expect(within(details!).getByRole('heading', {
      name: 'Senior Backend Engineer — AI Evaluation Platform',
    })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All applications' }));
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ALL_APPLICATION_COUNT);
    expect(container.querySelectorAll('tbody.employment-company-group')).toHaveLength(6);
    const micro1Group = [...container.querySelectorAll('tbody.employment-company-group')]
      .find(group => /micro1/iu.test(group.textContent ?? ''));
    expect(micro1Group?.querySelectorAll('tr.employment-application-row')).toHaveLength(4);
  });

  it('selects one role at a time and keeps its existing Opportunity details and editor', () => {
    const { container } = render(<EmploymentSurface />);
    const selectedRole = 'Senior Backend Engineer — Distributed Payments Infrastructure';

    fireEvent.click(screen.getByRole('button', {
      name: `Show details for Mercor: ${selectedRole}`,
    }));

    const details = container.querySelector<HTMLElement>('#employment-details');
    expect(details).not.toBeNull();
    expect(within(details!).getByRole('heading', { name: 'Details & history' })).toHaveFocus();
    expect(within(details!).getByRole('heading', { name: selectedRole })).toBeInTheDocument();
    expect(within(details!).queryByRole('heading', {
      name: 'Senior Backend Engineer — AI Evaluation Platform',
    })).not.toBeInTheDocument();

    const edit = within(details!).getByRole('button', { name: 'Edit opportunity' });
    edit.focus();
    fireEvent.click(edit);
    expect(screen.getByRole('dialog', { name: 'Edit opportunity' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Company' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Edit opportunity' })).not.toBeInTheDocument();
    expect(edit).toHaveFocus();
  });

  it('keeps active-only as the default and exposes search plus the three existing filters', () => {
    const { container } = render(<EmploymentSurface />);

    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ACTIVE_APPLICATION_COUNT);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Filter Employment status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter Employment work type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter Employment remote proof')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All applications' }));
    fireEvent.change(screen.getByLabelText('Filter Employment status'), { target: { value: 'closed' } });
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('Search company, role, note, compensation…'), {
      target: { value: 'no matching role' },
    });
    const empty = container.querySelector<HTMLElement>('.employment-empty')!;
    expect(within(empty).getByRole('heading', { name: 'No opportunities match' })).toBeInTheDocument();
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ACTIVE_APPLICATION_COUNT);
    expect(screen.queryByRole('button', {
      name: 'Show details for MICRO1: Staff Platform Engineer — Cloud Evaluation Rubrics',
    })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search company, role, note, compensation…'), {
      target: { value: 'observability' },
    });
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(1);
    expect(screen.getByRole('button', {
      name: 'Show details for Grafana Labs: Staff AI Engineer — Observability Platform',
    })).toBeInTheDocument();
  });

  it('focuses the add editor, closes with Escape, and restores the trigger', () => {
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
