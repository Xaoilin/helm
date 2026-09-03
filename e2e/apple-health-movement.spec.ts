import { expect, openApp, test } from './support/helm-fixture';

const EXPORT = `<?xml version="1.0"?>
<HealthData>
  <ExportDate value="2026-08-31 12:00:00 +0000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-08-30 12:00:00 +0000" endDate="2026-08-30 12:05:00 +0000" value="12"/>
</HealthData>`;

const SNAPSHOT = {
  rulesetVersion: 'life-hero-v1',
  totalXp: 20,
  overallLevel: 1,
  updatedAt: '2026-08-31T12:00:00.000Z',
  recomputedAt: '2026-08-31T12:00:00.000Z',
  stats: ['faith', 'vitality', 'knowledge', 'discipline', 'finances', 'craft', 'community']
    .map(stat => ({ stat, totalXp: stat === 'vitality' ? 20 : 0, level: 1, lastEvidenceLocalDate: stat === 'vitality' ? '2026-08-30' : null, condition: stat === 'vitality' ? 'steady' : 'awaiting_first_step', attentionAfterDays: 2 })),
  recentActivity: [],
};

test('imports iPhone Health movement through the visible export bridge', async ({ page, scenario }) => {
  await scenario({ now: '2026-09-01T12:00:00.000Z' });
  await page.route('**/rest/v1/rpc/accept_life_hero_evidence*', async route => {
    const input = (route.request().postDataJSON() as { p_metadata?: Record<string, unknown> }).p_metadata;
    expect(input).toMatchObject({
      provider: 'apple_health',
      source: 'iPhone',
      dateRangeStart: '2026-08-30',
      dateRangeEnd: '2026-08-30',
      movementTypes: 'stepCount',
    });
    expect(JSON.stringify(input)).not.toContain(EXPORT);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        duplicate: false,
        evidence: {
          id: '44444444-4444-4444-8444-444444444444',
          rulesetVersion: 'life-hero-v1',
          stat: 'vitality',
          evidenceType: 'vitality_activity',
          sourceTier: 'self_reported',
          sourceReference: 'apple-health:e2e',
          idempotencyKey: 'apple-health:e2e',
          occurredAt: '2026-08-31T12:00:00.000Z',
          localDate: '2026-08-30',
          metadata: input,
          createdAt: '2026-08-31T12:00:00.000Z',
        },
        award: {
          id: '55555555-5555-4555-8555-555555555555',
          evidenceId: '44444444-4444-4444-8444-444444444444',
          rulesetVersion: 'life-hero-v1',
          stat: 'vitality',
          baseXp: 20,
          sourceMultiplier: 0.75,
          momentumDays: 1,
          momentumMultiplier: 1,
          awardedXp: 15,
          awardedAt: '2026-08-31T12:00:00.000Z',
        },
        snapshot: SNAPSHOT,
      }),
    });
  });

  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Health' }).click();
  await expect(page.getByRole('heading', { name: 'Import from iPhone Health' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel('Select Apple Health XML').setInputFiles({
    name: 'export.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(EXPORT),
  });

  await expect(page.getByRole('status')).toContainText('Imported 1 movement day safely.');
  await expect(page.getByText('2026-08-30 to 2026-08-30')).toBeVisible();
  await expect(page.getByText('1 new · 0 already recorded')).toBeVisible();
});
