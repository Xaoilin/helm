import { expect, openApp, test } from './support/helm-fixture';

const NOW = '2026-08-30T12:00:00.000Z';

function usageEvent(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sessionId = `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index % 3}`;
  return {
    event_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa${String(index).padStart(3, '0')}`,
    schema_version: 1,
    session_id: sessionId,
    sequence: index + 1,
    event_kind: index < 3 ? 'session' : 'navigation',
    occurred_at: `2026-08-${28 + (index % 3)}T10:00:00.000Z`,
    surface: 'dashboard',
    feature: index < 3 ? 'application' : 'navigation',
    action: index < 3 ? 'session_started' : 'surface_viewed',
    outcome: index < 3 ? 'success' : null,
    duration_ms: null,
    error_code: null,
    target: 'dashboard',
    release_version: '0.2.129',
    device_class: 'desktop',
    input_kind: 'system',
    online: true,
    reduced_motion: false,
    metadata: {},
    ...overrides,
  };
}

const EVENTS = Array.from({ length: 12 }, (_, index) => usageEvent(index));

test.describe('private Activity usage viewer', () => {
  test('renders trends, filters, funnel, privacy boundary, and keyboard labels', async ({ page, scenario }) => {
    await scenario({ now: NOW, analytics: { events: EVENTS } });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Activity' }).click();

    await expect(page.getByRole('heading', { name: 'Usage overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Most-used paths' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Session progression' })).toBeVisible();
    await expect(page.getByText('Private to this signed-in account. Analytics is content-free and separate from Life Hero progression.')).toBeVisible();
    await expect(page.getByLabel('Usage event type')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();

    await page.getByLabel('Usage surface').selectOption('calendar');
    await expect(page.getByText('No activity matches these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('heading', { name: 'Most-used paths' })).toBeVisible();
  });

  test('shows the read error and an explicit retry action', async ({ page, scenario }) => {
    await scenario({ now: NOW, analytics: { failureStatus: 400 } });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Activity' }).click();

    await expect(page.getByRole('alert')).toContainText('Private usage activity could not be loaded.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('does not expose usage records when signed out', async ({ page, scenario }) => {
    await scenario({ authenticated: false, now: NOW, analytics: { events: EVENTS } });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Usage overview')).not.toBeVisible();
  });

  test.describe('mobile layout', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps the filters and evidence panels usable at mobile width', async ({ page, scenario }) => {
      await scenario({ now: NOW, analytics: { events: EVENTS } });
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
