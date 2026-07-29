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
    const cards = document.querySelectorAll('.project-catalog-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByRole('heading', { name: 'Orbit Console' })).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('Live + local')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Reference')).toBeInTheDocument();
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
});
