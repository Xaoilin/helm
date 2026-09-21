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
    retryLoad: vi.fn().mockResolvedValue(undefined),
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
    mocks.employment.retryLoad.mockClear();
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

  it('offers an explicit load retry alongside the backend error', () => {
    mocks.employment.error = 'Employment seed unavailable';
    render(<EmploymentSurface />);
    expect(screen.getByRole('alert')).toHaveTextContent('Employment seed unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(mocks.employment.retryLoad).toHaveBeenCalledOnce();
  });

  it('groups applications without losing roles and orders them by confirmed activity dates', () => {
    const { container } = render(<EmploymentSurface />);

    expect(screen.getByRole('heading', { name: 'Employment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add opportunity' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Employment applications' });
    expect(within(table).getByRole('columnheader', { name: 'Last updated' })).toBeInTheDocument();

    expect(container.querySelectorAll('tbody.employment-company-group')).toHaveLength(6);
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ACTIVE_APPLICATION_COUNT);
    expect(within(table).queryByRole('button', {
      name: 'Show details for MICRO1: Staff Platform Engineer — Cloud Evaluation Rubrics',
    })).not.toBeInTheDocument();

    const roleButtons = within(table).getAllByRole('button', { name: /^Show details for / });
    expect(roleButtons[0]).toHaveAccessibleName(
      'Show details for micro1: Senior Backend Engineer — AI Evaluation Platform',
    );
    expect(roleButtons[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Details & history' })).not.toBeInTheDocument();
    expect(within(table).getByTitle('Last recorded recruiting activity: 14 Sept 2026')).toHaveTextContent('14 Sept 2026');
    expect(within(table).getByTitle('No recorded recruiting activity date')).toHaveTextContent('—');

    fireEvent.click(screen.getByRole('button', { name: 'All applications' }));
    expect(container.querySelectorAll('tr.employment-application-row')).toHaveLength(ALL_APPLICATION_COUNT);
    expect(container.querySelectorAll('tbody.employment-company-group')).toHaveLength(6);
    const micro1Group = [...container.querySelectorAll('tbody.employment-company-group')]
      .find(group => /micro1/iu.test(group.textContent ?? ''));
    expect(micro1Group?.querySelectorAll('tr.employment-application-row')).toHaveLength(4);
  });

  it('expands one role inline and keeps its existing Opportunity details and editor', () => {
    const { container } = render(<EmploymentSurface />);
    const selectedRole = 'Senior Backend Engineer — Distributed Payments Infrastructure';

    const roleButton = screen.getByRole('button', {
      name: `Show details for Mercor: ${selectedRole}`,
    });
    roleButton.focus();
    fireEvent.click(roleButton);

    expect(roleButton).toHaveAttribute('aria-expanded', 'true');
    expect(roleButton).toHaveFocus();
    const detailsId = roleButton.getAttribute('aria-controls')!;
    const details = container.querySelector<HTMLElement>(`#${detailsId}`);
    expect(details).not.toBeNull();
    expect(details!.closest('tr')?.previousElementSibling).toBe(roleButton.closest('tr'));
    expect(details!.closest('tbody')?.querySelector('th[scope="rowgroup"]')).toHaveAttribute('rowspan', '2');
    expect(within(details!).getByRole('heading', { name: 'Details & history' })).toBeInTheDocument();
    expect(within(details!).getByRole('heading', { name: selectedRole })).toBeInTheDocument();
    expect(within(details!).getByText('Compensation')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', {
      name: 'Show details for micro1: Senior Backend Engineer — AI Evaluation Platform',
    }));
    expect(container.querySelectorAll('.employment-inline-details')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: selectedRole })).not.toBeInTheDocument();
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

  it('retains the history identity and editor draft after an uncertain save', async () => {
    render(<EmploymentSurface />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add opportunity' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Company' }), { target: { value: 'Example Ltd' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Role' }), { target: { value: 'Platform Engineer' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Next action' }), { target: { value: 'Apply' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fully remote evidence' }), { target: { value: 'Advert confirms remote work.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Initial contact' } });
    mocks.employment.addApplication.mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByRole('textbox', { name: 'Company' })).toHaveValue('Example Ltd');
    const originalPayload = mocks.employment.addApplication.mock.calls[0][0];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' })); });
    expect(mocks.employment.addApplication.mock.calls[1][0]).toEqual(originalPayload);
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
