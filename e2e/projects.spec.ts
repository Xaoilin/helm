import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const NOW = '2026-09-26T09:00:00.000Z';
const SEEDED_PROJECT = {
  id: 'project-atlas',
  catalogKey: 'custom:project-atlas',
  name: 'Atlas',
  summary: 'Household paperwork map.',
  kind: 'web_app',
  status: 'active',
  tags: ['home'],
  isPinned: false,
  links: [],
  setupSteps: [],
  runRecipes: [],
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
};

test('creates, edits, and manages a project from the Projects catalogue', async ({ page, scenario }) => {
  await scenario({ now: NOW, stores: { projects: [SEEDED_PROJECT], projectPages: [] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Projects' }).click();

  await expect(page.getByRole('heading', { name: 'Projects', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atlas' })).toBeVisible();
  await expect(page.getByText('1 project in your reference catalogue')).toBeVisible();

  // Escape dismisses the editor without saving.
  await page.getByRole('button', { name: '+ Add Project' }).click();
  const addDialog = page.getByRole('dialog', { name: 'Add Project' });
  await expect(addDialog.getByLabel('Name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(addDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Add Project' })).toBeFocused();

  await page.getByRole('button', { name: '+ Add Project' }).click();
  await expect(addDialog.getByRole('button', { name: 'Create Project' })).toBeDisabled();
  await addDialog.getByLabel('Name').fill('Desk lamp');
  await addDialog.getByLabel('Tags').fill('hardware, home');
  await addDialog.getByLabel('Live URL').fill('https://lamp.example');
  const createWrite = waitForMutation(page, 'projects');
  await addDialog.getByRole('button', { name: 'Create Project' }).click();
  await createWrite;
  await expect(addDialog).toHaveCount(0);

  const lampCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Desk lamp' }) });
  await expect(lampCard).toBeVisible();
  await expect(page.getByText('2 projects in your reference catalogue')).toBeVisible();

  await lampCard.getByRole('button', { name: 'View details' }).click();
  const drawer = page.getByRole('dialog', { name: 'Desk lamp' });
  await expect(drawer.getByRole('link', { name: /Live project/ })).toHaveAttribute('href', 'https://lamp.example/');
  await drawer.getByRole('button', { name: 'Edit project' }).click();

  const editDialog = page.getByRole('dialog', { name: 'Edit Project' });
  await expect(editDialog.getByLabel('Name')).toHaveValue('Desk lamp');
  await editDialog.getByLabel('Name').fill('Bench lamp');
  await editDialog.getByLabel('Status').selectOption('planning');
  const editWrite = waitForMutation(page, 'projects');
  await editDialog.getByRole('button', { name: 'Save Project' }).click();
  await editWrite;
  await expect(editDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Bench lamp' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desk lamp' })).toHaveCount(0);

  const benchCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Bench lamp' }) });
  await expect(benchCard.getByRole('button', { name: 'View details' })).toBeFocused();
  await benchCard.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('dialog', { name: 'Bench lamp' }).getByRole('button', { name: 'Manage project' }).click();
  await expect(page.getByRole('button', { name: '← Back to all projects' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Bench lamp', level: 2 })).toBeVisible();

  await page.getByRole('tab', { name: 'Board' }).click();
  await page.getByPlaceholder('Quick add task').fill('Wire the switch');
  const taskWrite = waitForMutation(page, 'tasks');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await taskWrite;
  await expect(page.getByRole('article').filter({ hasText: 'Wire the switch' })).toBeVisible();

  await page.getByRole('button', { name: '← Back to all projects' }).click();
  await expect(page.getByRole('heading', { name: 'Your work, easy to find again.' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bench lamp' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atlas' })).toBeVisible();
});
