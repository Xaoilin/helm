import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductUsageEvent } from '../types/domain';
import { activityInsightsSchema, activityReceiptSchema } from '../services/backend/activityContracts';
import { activityBatchKey } from '../services/backend/idempotencyKeys';
import { getActivityInsights, ingestProductUsageEvents } from '../services/backend/profileServiceApi';
import { DEFAULT_PRODUCT_USAGE_FILTERS } from '../services/productUsageInsights';

const service = vi.hoisted(() => ({ callService: vi.fn() }));
vi.mock('../services/backend/serviceClient', () => ({ callService: service.callService }));

function usageEvent(index: number): ProductUsageEvent {
  return {
    eventId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`, schemaVersion: 1,
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sequence: index + 1, kind: 'navigation',
    occurredAt: '2026-09-27T10:00:00.000Z', surface: 'calendar', feature: 'navigation', action: 'viewed',
    releaseVersion: '0.2.203', deviceClass: 'desktop', inputKind: 'pointer', online: true, reducedMotion: false,
  };
}

beforeEach(() => service.callService.mockReset());

describe('product usage through the profile service', () => {
  it('posts each batch with a key named by its events and returns the receipt', async () => {
    const events = [usageEvent(0), usageEvent(1)];
    service.callService.mockResolvedValue({ accepted: 1, duplicates: 1 });

    await expect(ingestProductUsageEvents(events)).resolves.toEqual({ accepted: 1, duplicates: 1 });
    expect(service.callService).toHaveBeenCalledWith(expect.any(String), 'POST', '/api/profile/v1/activity/events',
      activityReceiptSchema, { events }, { idempotencyKey: activityBatchKey(events) });
  });

  it('refuses batches the service would refuse and receipts that do not add up', async () => {
    await expect(ingestProductUsageEvents([])).rejects.toThrow('between 1 and 25');
    await expect(ingestProductUsageEvents(Array.from({ length: 26 }, (_, index) => usageEvent(index))))
      .rejects.toThrow('between 1 and 25');
    service.callService.mockResolvedValue({ accepted: 1, duplicates: 0 });
    await expect(ingestProductUsageEvents([usageEvent(0), usageEvent(1)])).rejects.toThrow('receipt was invalid');
  });

  it('asks the service for the insights of the chosen filters', async () => {
    service.callService.mockResolvedValue({});

    await getActivityInsights({ ...DEFAULT_PRODUCT_USAGE_FILTERS, rangeDays: 7, surface: 'calendar' });

    expect(service.callService).toHaveBeenCalledWith(expect.any(String), 'GET',
      '/api/profile/v1/activity/insights?rangeDays=7&kind=all&surface=calendar&outcome=all&feature=all',
      activityInsightsSchema);
  });
});
