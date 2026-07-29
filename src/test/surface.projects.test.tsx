import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import ProjectsSurface from '../surfaces/ProjectsSurface';
import * as projectPaths from '../services/projectPaths';

describe('ProjectsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  function seedProjectCatalogue() {
    localStorage.setItem('helm:projects', JSON.stringify([
      {
        id: 'project-orbit',
        catalogKey: 'fixture-orbit',
        name: 'Orbit Console',
        kind: 'web_app',
        summary: 'A sample assistant and project hub.',
        status: 'active',
        tags: ['assistant', 'live'],
        isPinned: true,
        links: [
          { id: 'orbit-live', kind: 'deployment', label: 'Live project', url: 'https://example.com/orbit/' },
          { id: 'orbit-repo', kind: 'repository', label: 'GitHub repository', url: 'https://github.com/example/orbit' },
        ],
        setupSteps: [
          { id: 'orbit-install', title: 'Install dependencies', description: 'Install the locked packages.', displayCode: 'npm install' },
        ],
        runRecipes: [
          {
            id: 'orbit-dev',
            label: 'Development server',
            displayCommand: 'npm run dev',
            executable: 'npm',
            args: ['run', 'dev'],
            localUrl: 'http://localhost:5173',
            mode: 'service',
          },
        ],
        preview: { icon: 'HL', accentColor: '#777dff', backgroundColor: '#171b2e' },
        verifiedAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      {
        id: 'project-hardware',
        catalogKey: 'fixture-sensor-bench',
        name: 'Sensor Bench',
        kind: 'hardware',
        summary: 'A local hardware build reference.',
        status: 'planning',
        tags: ['hardware'],
        isPinned: false,
        links: [],
        setupSteps: [],
        runRecipes: [],
        preview: { icon: 'AS', accentColor: '#f59e0b', backgroundColor: '#241b13' },
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ]));
  }

  it('should render empty state', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    expect(screen.getByText('Turn HELM into your local project hub')).toBeInTheDocument();
  });

  it('should describe the reference-first project scope', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    expect(screen.getByText(/live link, repository, local folder/i)).toBeInTheDocument();
  });

  it('should have add project button', async () => {
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    const buttons = screen.getAllByText('+ Add Project');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders a pinned-first catalogue with live and reference badges', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });

    expect(await screen.findByText('Your work, easy to find again.')).toBeInTheDocument();
    const pinnedRegion = screen.getByRole('region', { name: 'Pinned' });
    const projectsRegion = screen.getByRole('region', { name: 'Projects' });
    expect(within(pinnedRegion).getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
    expect(within(projectsRegion).getByRole('heading', { name: 'Sensor Bench' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archived' })).toBeInTheDocument();
    const cards = document.querySelectorAll('.project-catalog-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('Live + local')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Reference')).toBeInTheDocument();
  });

  it('pins directly from a card and moves the project into the Pinned section', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    fireEvent.click(screen.getByRole('button', { name: 'Pin Sensor Bench' }));

    await waitFor(() => {
      const pinnedRegion = screen.getByRole('region', { name: 'Pinned' });
      expect(within(pinnedRegion).getByRole('heading', { name: 'Sensor Bench' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unpin Sensor Bench' })).toHaveFocus();
    });
  });

  it('archives from the action menu, expands Archived, and restores the project', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Orbit Console' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive project' }));

    const archivedRegion = await screen.findByRole('region', { name: 'Archived' });
    const unarchiveButton = await within(archivedRegion).findByRole('button', { name: 'Unarchive Orbit Console' });
    expect(screen.getByRole('button', { name: 'Hide archived' })).toHaveAttribute('aria-expanded', 'true');
    expect(unarchiveButton).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } });
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('archived'));
    fireEvent.click(unarchiveButton);
    await waitFor(() => {
      const projectsRegion = screen.getByRole('region', { name: 'Projects' });
      expect(within(projectsRegion).getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pin Orbit Console' })).toHaveFocus();
      expect(screen.getByLabelText('Status')).toHaveValue('all');
    });
  });

  it('offers move actions and persists manual ordering within a section', async () => {
    seedProjectCatalogue();
    const projects = JSON.parse(localStorage.getItem('helm:projects') || '[]') as Array<Record<string, unknown>>;
    localStorage.setItem('helm:projects', JSON.stringify(projects.map((project, index) => ({
      ...project,
      isPinned: false,
      sortOrder: index,
    }))));
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Orbit Console' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move later' }));

    await waitFor(() => {
      const projectCards = within(screen.getByRole('region', { name: 'Projects' }))
        .getAllByRole('listitem');
      expect(within(projectCards[0]).getByRole('heading', { name: 'Sensor Bench' })).toBeInTheDocument();
      expect(within(projectCards[1]).getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
    });
  });

  it('disables reordering while the catalogue is filtered', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    fireEvent.click(screen.getByRole('button', { name: 'Hardware' }));

    expect(screen.getByRole('button', { name: 'Clear filters to reorder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reorder Sensor Bench' })).toBeDisabled();
  });

  it('filters the catalogue by hardware and search text', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    fireEvent.click(screen.getByRole('button', { name: 'Hardware' }));
    expect(screen.getByRole('heading', { name: 'Sensor Bench' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Orbit Console' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'assistant' } });
    expect(screen.getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sensor Bench' })).not.toBeInTheDocument();
  });

  it('opens an accessible reference drawer and returns focus on Escape', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    const orbitCard = screen.getByRole('heading', { name: 'Orbit Console' }).closest('.project-catalog-card') as HTMLElement;
    const detailsButton = within(orbitCard).getByRole('button', { name: 'View details' });
    detailsButton.focus();
    fireEvent.click(detailsButton);

    const drawer = await screen.findByRole('dialog', { name: 'Orbit Console' });
    expect(within(drawer).getByText('How to run')).toBeInTheDocument();
    expect(within(drawer).getByText('npm run dev')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Desktop only' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Orbit Console' })).not.toBeInTheDocument();
    expect(detailsButton).toHaveFocus();
  });

  it('keeps Board, Milestones, and Wiki in the secondary management workspace', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');
    fireEvent.click(within(screen.getByRole('heading', { name: 'Orbit Console' }).closest('.project-catalog-card') as HTMLElement).getByRole('button', { name: 'View details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage project' }));

    expect(screen.getByRole('button', { name: '← Back to all projects' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Milestones' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Wiki' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '← Back to all projects' }));
    const returnedCard = screen.getByRole('heading', { name: 'Orbit Console' }).closest('.project-catalog-card') as HTMLElement;
    expect(within(returnedCard).getByRole('button', { name: 'View details' })).toHaveFocus();
  });

  it('preserves an unavailable device binding and its approvals when other project fields are edited', async () => {
    seedProjectCatalogue();
    const projectRoot = '/Volumes/Offline/Orbit Console';
    localStorage.setItem('helm:device:projectDeviceBindings', JSON.stringify([{
      catalogKey: 'fixture-orbit',
      projectRoot,
      source: 'user',
      adoptedAt: '2026-07-29T12:00:00.000Z',
      updatedAt: '2026-07-29T12:00:00.000Z',
      runProfiles: [{
        profileId: 'profile-orbit',
        projectId: 'project-orbit',
        recipeId: 'orbit-dev',
        projectRoot,
        workingDirectory: projectRoot,
        executable: '/usr/local/bin/npm',
        args: ['run', 'dev'],
        environment: {},
        fingerprint: 'a'.repeat(64),
        approvedAt: '2026-07-29T12:00:00.000Z',
      }],
    }]));
    vi.spyOn(projectPaths, 'canUseDesktopProjectPaths').mockResolvedValue(true);
    const canonicalizeSpy = vi.spyOn(projectPaths, 'canonicalizeProjectPath').mockResolvedValue(null);

    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await waitFor(() => expect(canonicalizeSpy).toHaveBeenCalledWith(projectRoot));

    const orbitCard = screen.getByRole('heading', { name: 'Orbit Console' }).closest('.project-catalog-card') as HTMLElement;
    fireEvent.click(within(orbitCard).getByRole('button', { name: 'View details' }));
    const drawer = await screen.findByRole('dialog', { name: 'Orbit Console' });
    expect(within(drawer).getByText(/Not linked on this device/)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit project' }));

    const pathInput = screen.getByLabelText('Folder on this device');
    expect(pathInput).toHaveValue(projectRoot);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orbit Console Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Project' }));

    await waitFor(() => {
      const bindings = JSON.parse(
        localStorage.getItem('helm:device:projectDeviceBindings') || '[]',
      ) as Array<{ projectRoot: string; runProfiles: unknown[] }>;
      expect(bindings).toHaveLength(1);
      expect(bindings[0].projectRoot).toBe(projectRoot);
      expect(bindings[0].runProfiles).toHaveLength(1);
    });
  });

  it('routes Edit Project pinning and archiving through catalogue transitions', async () => {
    seedProjectCatalogue();
    await act(async () => { renderWithProvider(<ProjectsSurface />); });
    await screen.findByText('Your work, easy to find again.');

    const orbitCard = screen.getByRole('heading', { name: 'Orbit Console' })
      .closest('.project-catalog-card') as HTMLElement;
    fireEvent.click(within(orbitCard).getByRole('button', { name: 'View details' }));
    let drawer = await screen.findByRole('dialog', { name: 'Orbit Console' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit project' }));
    let editDialog = screen.getByRole('dialog', { name: 'Edit Project' });
    fireEvent.change(within(editDialog).getByLabelText('Status'), { target: { value: 'archived' } });
    expect(within(editDialog).getByRole('checkbox')).toBeDisabled();
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Project' }));

    const archivedRegion = await screen.findByRole('region', { name: 'Archived' });
    expect(await within(archivedRegion).findByRole('button', { name: 'Unarchive Orbit Console' }))
      .toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide archived' })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => {
      const projects = JSON.parse(localStorage.getItem('helm:projects') || '[]') as Array<{
        id: string;
        status: string;
        statusBeforeArchive?: string;
        isPinned: boolean;
      }>;
      expect(projects.find(project => project.id === 'project-orbit')).toMatchObject({
        status: 'archived',
        statusBeforeArchive: 'active',
        isPinned: false,
      });
    });

    const archivedCard = within(archivedRegion).getByRole('heading', { name: 'Orbit Console' })
      .closest('.project-catalog-card') as HTMLElement;
    fireEvent.click(within(archivedCard).getByRole('button', { name: 'View details' }));
    drawer = await screen.findByRole('dialog', { name: 'Orbit Console' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit project' }));
    editDialog = screen.getByRole('dialog', { name: 'Edit Project' });
    fireEvent.change(within(editDialog).getByLabelText('Status'), { target: { value: 'blocked' } });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Project' }));

    await waitFor(() => {
      const projectsRegion = screen.getByRole('region', { name: 'Projects' });
      const restoredCard = within(projectsRegion).getByRole('heading', { name: 'Orbit Console' })
        .closest('.project-catalog-card') as HTMLElement;
      expect(within(restoredCard).getByText('blocked')).toBeInTheDocument();
    });
  });
});
