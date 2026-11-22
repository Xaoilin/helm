import type { Locator, Page } from '@playwright/test';
import { DETAILED_BUDGET_REVIEW } from '../src/test/budget-forecast-fixture';
import { OVERPAYMENT_REVIEW } from '../src/test/loan-overpayment-fixture';
import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource, makeTask, TEST_NOW_ISO } from '../src/test/fixtures';
import type { Surface } from '../src/types/domain';
import { createRepresentativeEmploymentState } from './support/employment-scenario';
import { expect, test } from './support/helm-fixture';

const dates = { createdAt: TEST_NOW_ISO, updatedAt: TEST_NOW_ISO };
const equityPlan = { summary: 'Review the next tender', status: 'undecided', waitingFor: '', nextAction: '', reviewMonth: '2026-10' };
const stores = {
  healthFastFoodEntries: [{ id: 'lunch', venue: 'Exhibition restaurant', date: '2026-08-29', rating: 'mixed',
    symptoms: ['sluggish'], notes: 'Lunch during the workshop', ...dates }],
  clock: { nextStopwatchNumber: 2, nextTimerNumber: 2, stopwatches: [{ id: 'workshop', label: 'Workshop preparation', accumulatedMs: 60000, startedAt: null, laps: [60000] }],
    timers: [{ id: 'break', label: 'Equipment warm-up', durationMs: 600000, remainingMs: 600000,
      endsAt: null, status: 'idle', sound: 'chime', alerting: false }] },
  transactions: [{ id: 'parts', type: 'expense', amount: 500, category: 'other-expense', accountId: 'bank',
    description: 'Replacement workbench parts', date: '2026-08-29', ...dates }],
  financeBudgets: [{ id: 'parts-budget', category: 'other-expense', monthlyLimit: 15000, ...dates }],
  savingsGoals: [{ id: 'holiday', name: 'Next family holiday', targetAmount: 60000, currentAmount: 30000, icon: '🏖', completed: false, ...dates }],
  equityPositions: [{ id: 'sample-equity', company: 'Example Engineering', asOf: '2026-08-29', ownedShares: 20,
    stockPlan: equityPlan, optionPlan: equityPlan, employmentNote: '', grants: [], actions: [], details: [], sources: [],
    scenario: { pricesUsd: [50, 100], withholdingRate: 0.4, usdToGbp: 0.8, asOf: '2026-08-29', notes: 'Illustrative' }, ...dates }],
  tasks: [makeTask({ title: 'Review the international travel arrangements', dueDate: '2026-08-29' })],
  calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()],
  calendarEvents: [makeCalendarEvent({ title: 'Review the international travel arrangements' })],
  employment: createRepresentativeEmploymentState(),
  financeReviews: [{ ...DETAILED_BUDGET_REVIEW, loans: OVERPAYMENT_REVIEW.loans }],
  financeAccounts: [{ id: 'bank', name: 'Household Current Account', type: 'current', balance: 200_000, currency: 'GBP',
    color: '#4f5bff', icon: '£', includeInNetWorth: true, sortOrder: 0, ...dates }],
  projects: [{ id: 'workshop', catalogKey: 'custom:workshop', name: 'Workshop reference catalogue', kind: 'web_app',
    status: 'active', summary: 'Tools and materials for the workbench.', tags: ['workbench'], isPinned: false,
    links: [], setupSteps: [], runRecipes: [], ...dates }],
  inventoryItems: [{ id: 'multimeter', name: 'Multimeter and test lead set', category: 'tool', trackingMode: 'counted',
    unit: 'sets', quantity: 2, specifications: {}, condition: 'good', location: 'Workshop',
    tags: [], notes: '', projectCatalogKeys: ['custom:workshop'], lastVerifiedAt: TEST_NOW_ISO, ...dates }],
  inventoryNeeds: [{ id: 'probes', name: 'Replacement insulated probes', category: 'tool', requiredQuantity: 2,
    unit: 'sets', specifications: {}, priority: 'normal', status: 'needed', notes: '', ...dates }],
  trips: [{ id: 'weekend', name: 'Weekend workshop visit', summary: 'Visit the exhibition', notes: '', status: 'booked',
    startDate: '2026-08-29', endDate: '2026-08-30', budgetCurrency: 'GBP', budgetTotal: 20000, ...dates }],
  tripLegs: [{ id: 'leg', tripId: 'weekend', country: 'United Kingdom', city: 'Cambridge',
    startDate: '2026-08-29', endDate: '2026-08-30', sortOrder: 0, ...dates }],
  knowledgeTopics: [{ id: 'workshop', name: 'Workshop notes', description: '', icon: '📓', color: '#8491aa', sortOrder: 0, ...dates }],
  knowledgeEntries: [{ id: 'checklist', topicId: 'workshop', title: 'The workshop checklist',
    content: 'Bring the catalogue and multimeter.', sources: [], tags: ['workshop'], ...dates }],
};

const viewports = [
  { width: 320, height: 568 }, { width: 393, height: 852 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1440, height: 900 },
];

// Choose eligible surfaces exhaustively so a newly shipped page cannot silently escape this check.
const views: Record<Exclude<Surface, 'secrets'>, string | null> = {
  dashboard: '.home-tabs button', calendar: '.calendar-view-tabs button', tasks: '.tabs > button',
  clock: null, trips: '.tabs > button', projects: null, software: null, inventory: '.inventory-view-tabs button',
  employment: null, finance: '.tabs > button', health: null, knowledge: '.tabs > button', profile: null,
  integrations: null, activity: null, settings: null, debug: '.debug-tab-row button',
};

async function checkLayout(page: Page, container: Locator, name: string) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const escaped = await container.evaluate(async root => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const viewport = document.documentElement.clientWidth;
      const bounds = root.getBoundingClientRect();
      const left = Math.max(0, bounds.left);
      const right = Math.min(viewport, bounds.right);
      const problems: string[] = [];
      if (bounds.left < -1 || bounds.right > viewport + 1) problems.push('Panel exceeds the viewport');
      const scrollers = new Set<HTMLElement>();
      const candidates = root.querySelectorAll<HTMLElement>(
        'section,article,form,.card,.surface-header,.surface-body,[role="dialog"],h1,h2,h3,h4,p,button,a[href],input,textarea,select,table',
      );
      for (const element of candidates) {
        if (element.closest('[hidden],[inert],[aria-hidden="true"],.sr-only')) continue;
        const closed = element.closest('details:not([open])');
        if (closed && !closed.querySelector(':scope > summary')?.contains(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        // Intentional table and tab scrollers may contain wider content. Check the scroller's own
        // bounds separately; overflow:hidden on the app shell cannot excuse a clipped card.
        const owner = element.parentElement?.closest<HTMLElement>(
          '.tabs,.prayer-history-scroll,.projects-catalog-stats,.projects-filter-chips,.equity-table-wrap,.banking-table-wrap,' +
          '.dash-achievements-row,.account-legend,.health-quick-dates,.finance-type-toggle,.clock-toolbar-metrics,.clock-toolbar-actions',
        );
        const scrollable = owner && root.contains(owner) && /^(auto|scroll)$/.test(getComputedStyle(owner).overflowX)
          && owner.scrollWidth > owner.clientWidth + 1;
        const target = scrollable ? owner : element;
        if (scrollable) scrollers.add(owner);

        let visibleLeft = left;
        let visibleRight = right;
        for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
          if (/^(hidden|clip)$/.test(getComputedStyle(parent).overflowX)) {
            const clip = parent.getBoundingClientRect();
            visibleLeft = Math.max(visibleLeft, clip.left);
            visibleRight = Math.min(visibleRight, clip.right);
          }
        }
        const box = target.getBoundingClientRect();
        if (box.left < visibleLeft - 1 || box.right > visibleRight + 1) {
          const label = (target.getAttribute('aria-label') || target.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45);
          const problem = `${target.tagName}.${target.className} "${label}" [${Math.round(box.left)}, ${Math.round(box.right)}]`;
          if (!problems.includes(problem)) problems.push(problem);
        }
      }
      for (const scroller of scrollers) {
        const start = scroller.scrollLeft;
        scroller.scrollLeft = scroller.scrollWidth;
        if (scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1) {
          problems.push(`Cannot reach the right edge of ${scroller.className}`);
        }
        const actions = scroller.querySelectorAll<HTMLElement>('button, a[href], th, td');
        const last = Array.from(actions).filter(action => action.getBoundingClientRect().width > 1).at(-1);
        if (last && last.getBoundingClientRect().right > scroller.getBoundingClientRect().right + 1) {
          problems.push(`Last control or table cell remains clipped in ${scroller.className}`);
        }
        scroller.scrollLeft = start;
      }
      if (root instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(root).overflowY)) {
        const start = root.scrollTop;
        root.scrollTop = root.scrollHeight;
        if (root.scrollTop + root.clientHeight < root.scrollHeight - 1) problems.push('Cannot reach bottom of page');
        root.scrollTop = start;
      }
      return problems.slice(0, 12);
    });
    expect.soft(escaped, `${name} at ${viewport.width}px`).toEqual([]);
  }
}

for (const surface of Object.keys(views) as (keyof typeof views)[]) {
  test(`responsive content on the ${surface} page`, async ({ page, scenario }) => {
    await scenario({ initialSurface: surface, now: TEST_NOW_ISO, settings: { prayerEnabled: true }, stores });
    await page.goto('/');
    const main = page.getByRole('main', { name: `${surface} surface` });
    await expect(main.locator('h1').first()).toBeVisible();
    if (surface === 'dashboard') {
      const published = await page.getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: /^Navigate to / }).evaluateAll(buttons =>
          buttons.map(button => button.getAttribute('aria-label')!.slice('Navigate to '.length).toLowerCase()).sort(),
        );
      expect(published).toEqual(Object.keys(views).sort());
    }
    if (surface === 'employment') {
      await main.getByRole('button', { name: 'Filters' }).click();
      await main.locator('.employment-role-button').first().click();
    }
    if (surface === 'projects') {
      await checkLayout(page, main, 'Project catalogue');
      await main.getByRole('button', { name: 'View details' }).first().click();
      const details = page.getByRole('dialog');
      // The entering drawer slides in from beyond the viewport.
      await details.evaluate(async panel => {
        await Promise.all(panel.getAnimations().map(animation => animation.finished));
      });
      await checkLayout(page, details, 'Project details');
      await details.getByRole('button', { name: 'Manage project' }).click();
    }
    const tabSelector = surface === 'projects' ? '[role="tablist"] [role="tab"]' : views[surface];
    if (!tabSelector) {
      await checkLayout(page, main, surface);
      return;
    }
    const tabs = main.locator(tabSelector);
    await expect(tabs.first()).toBeVisible();
    for (const tab of await tabs.all()) {
      const label = await tab.innerText();
      await tab.click();
      if (surface === 'finance' && label === 'Overview') {
        await main.locator('summary').filter({ hasText: 'What needs to change' }).first().click();
      }
      await checkLayout(page, main, `${surface} / ${label}`);
    }
  });
}

const editors: Partial<Record<Surface, string[]>> = {
  tasks: ['+ Add Task'], calendar: ['+ Event', '+ Account'], employment: ['+ Add opportunity'],
  inventory: ['+ Add owned item', '+ Add need', 'Paste and review'], finance: ['+ Account', '+ Add Budget', '+ Add Goal'], projects: ['+ Add Project'], trips: ['+ Plan Trip'],
};
for (const [surface, triggers] of Object.entries(editors)) {
  test(`responsive forms on the ${surface} page`, async ({ page, scenario }) => {
    await scenario({ initialSurface: surface as Surface, stores, now: TEST_NOW_ISO });
    await page.goto('/');
    for (const trigger of triggers) {
      await page.setViewportSize({ width: 393, height: 852 });
      if (surface === 'finance' && trigger !== '+ Account') await page.getByRole('button', { name: 'Budgets & Goals' }).click();
      if (trigger === '+ Add Budget') await page.getByText('Category spending limits', { exact: true }).click();
      await page.getByRole('button', { name: trigger, exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await checkLayout(page, dialog, trigger);
      await dialog.getByRole('button', { name: /^(cancel|close)( .*)?$/i }).last().click();
      await expect(dialog).toBeHidden();
    }
  });
}

test('public entry, product and privacy pages fit their browsers', async ({ page, scenario }) => {
  await scenario({ authenticated: false });
  for (const [path, label] of [['/', 'Sign-in'], ['about.html', 'About'], ['privacy.html', 'Privacy']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await checkLayout(page, page.locator('body'), label);
  }
});

test('client consent and its approval controls fit portrait', async ({ page, scenario }) => {
  await scenario();
  await page.route('**/api/access/consent/review', route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': new URL(page.url()).origin, 'Access-Control-Allow-Credentials': 'true' },
    json: { authorization_id: 'review', redirect_uri: 'https://client.example.test/callback', scope: 'mcp',
      client: { id: '11111111-1111-4111-8111-111111111111', name: 'Scheduled reporting client', uri: '', logo_uri: '' },
      user: { id: '22222222-2222-4222-8222-222222222222', email: 'portrait@example.test' } },
  }));
  await page.goto('/helm/oauth/consent?authorization_id=review');
  const consent = page.getByRole('main', { name: 'Client access approval' });
  await expect(consent.getByRole('radio').first()).toBeVisible();
  await checkLayout(page, consent, 'Consent');
});
