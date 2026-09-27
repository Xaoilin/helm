import { expect, openApp, test } from './support/helm-fixture';

// The fake profile service answers insights with contracts/profile-service/activity-insights.json.

const NOW = '2026-08-30T12:00:00.000Z';

test.describe('private Activity usage viewer', () => {
  test('renders trends, filters, funnel, privacy boundary, and keyboard labels', async ({ page, scenario }) => {
    await scenario({ now: NOW });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Activity' }).click();

    await expect(page.getByRole('heading', { name: 'Usage overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Most-used paths' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Session progression' })).toBeVisible();
    await expect(page.getByText('Private to this signed-in account. Analytics is content-free.')).toBeVisible();
    await expect(page.getByLabel('Usage event type')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    await page.getByLabel('Usage surface').selectOption('calendar');
    await expect(page.getByText('No activity matches these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Most-used paths' })).toBeVisible();
  });

  test('sends content-free usage events to the profile service', async ({ page, scenario }) => {
    const control = await scenario({});
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Activity' }).click();

    await expect.poll(() => control.services.activityEvents.size, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(control.services.calls).toContain('POST /api/profile/v1/activity/events');
  });

  test('shows the read error and an explicit retry action', async ({ page, scenario }) => {
    await scenario({ now: NOW, services: { activity: { failureStatus: 400 } } });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Activity' }).click();

    await expect(page.getByRole('alert')).toContainText('Private usage activity could not be loaded.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('does not expose usage records when signed out', async ({ page, scenario }) => {
    await scenario({ authenticated: false, now: NOW });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Usage overview')).not.toBeVisible();
  });

  test.describe('mobile layout', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps the filters and evidence panels usable at mobile width', async ({ page, scenario }) => {
      await scenario({ now: NOW });
      await openApp(page);
      await page.getByRole('button', { name: 'Open more navigation' }).click();
      await page.getByRole('button', { name: 'Activity', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Usage overview' })).toBeVisible();
      await expect(page.getByLabel('Usage time window')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Most-used paths' })).toBeVisible();
      const dimensions = await page.locator('.main-content').evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    });
  });
});
