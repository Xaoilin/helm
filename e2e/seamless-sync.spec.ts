import { expect, test } from './support/helm-fixture';

test.describe('Seamless database sync', () => {
  test('preserves the current screen while rapid second-client writes converge', async ({ page, scenario }) => {
    await scenario('projects');
    await page.goto('/');

    await page.getByRole('button', { name: 'Navigate to Projects' }).click();
    const orbitCard = page.locator('.project-catalog-card').filter({ hasText: 'Orbit Console' });
    await orbitCard.getByRole('button', { name: 'View details' }).click();
    const projectDetails = page.getByRole('dialog', { name: 'Orbit Console' });
    await expect(projectDetails).toBeVisible();

    await page.evaluate(async () => {
      const write = (index: number) => fetch('/__helm_e2e_remote_write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            op: 'create',
            collection: 'tasks',
            recordId: `remote-task-${index}`,
            position: index,
            payload: {
              id: `remote-task-${index}`,
              title: `Remote task ${index}`,
              description: 'Written from the simulated second client.',
              completed: false,
              priority: 'medium',
              category: 'task',
              createdAt: '2026-08-01T18:00:00.000Z',
              updatedAt: '2026-08-01T18:00:00.000Z',
            },
          }],
        }),
      });
      await Promise.all(Array.from({ length: 12 }, (_, index) => write(index)));

      let visibility: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(projectDetails).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HELM is reconnecting' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Close Orbit Console details' }).click();
    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.getByText('12 active tasks', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All Tasks' }).click();
    await expect(page.getByText('Remote task 11', { exact: true })).toBeVisible();
    await expect(page.getByText('Remote task 0', { exact: true })).toBeVisible();
  });
});
