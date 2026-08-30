import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureProductUsageAnalytics,
  flushProductUsageEvents,
  getProductUsageDiagnostics,
  resetProductUsageAnalyticsRuntime,
  sanitizeProductUsageMetadata,
  trackProductUsageEvent,
} from '../services/productUsageAnalytics';
import type { ProductUsageEvent } from '../types/domain';

describe('private product usage analytics', () => {
  beforeEach(() => {
    resetProductUsageAnalyticsRuntime();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    resetProductUsageAnalyticsRuntime();
    vi.unstubAllGlobals();
  });

  it('keeps only allow-listed scalar metadata', () => {
    expect(sanitizeProductUsageMetadata({
      previousSurface: 'dashboard',
      retryCount: 2,
      accessToken: 'forbidden',
      content: 'private text',
      nested: { amount: 50 },
    })).toEqual({ previousSurface: 'dashboard', retryCount: 2 });
  });

  it('batches a content-free session and action through the configured sink', async () => {
    const batches: ProductUsageEvent[][] = [];
    configureProductUsageAnalytics({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: '0.2.125',
      sink: async events => {
        batches.push(events);
        return { accepted: events.length, duplicates: 0 };
      },
    });

    const eventId = trackProductUsageEvent({
      kind: 'action',
      feature: 'navigation',
      action: 'surface_selected',
      surface: 'dashboard',
      target: 'tasks',
      inputKind: 'pointer',
      metadata: {
        previousSurface: 'dashboard',
        description: 'must not survive',
      },
    });
    await flushProductUsageEvents();

    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0]).toMatchObject({
      kind: 'session',
      feature: 'application',
      action: 'session_started',
      schemaVersion: 1,
      releaseVersion: '0.2.125',
    });
    expect(batches[0][1]).toMatchObject({
      kind: 'action',
      feature: 'navigation',
      action: 'surface_selected',
      target: 'tasks',
      metadata: { previousSurface: 'dashboard' },
    });
    expect(getProductUsageDiagnostics()).toMatchObject({
      accepted: 2,
      duplicates: 0,
      queued: 0,
      failedBatches: 0,
    });
  });

  it('emits a database-compatible release version from the app display version', async () => {
    const batches: ProductUsageEvent[][] = [];
    configureProductUsageAnalytics({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: 'v0.2.132',
      sink: async events => {
        batches.push(events);
        return { accepted: events.length, duplicates: 0 };
      },
    });

    await flushProductUsageEvents();

    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0].releaseVersion).toBe('0.2.132');
    expect(batches[0][0].releaseVersion).toMatch(
      /^\d+\.\d+\.\d+(?:[+-][A-Za-z0-9.-]+)?$/u,
    );
  });

  it('rejects unbounded taxonomy before it reaches the database', async () => {
    const sink = vi.fn(async (events: ProductUsageEvent[]) => ({
      accepted: events.length,
      duplicates: 0,
    }));
    configureProductUsageAnalytics({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: '0.2.125',
      sink,
    });
    await flushProductUsageEvents();

    expect(trackProductUsageEvent({
      kind: 'action',
      feature: 'private user label',
      action: 'clicked',
    })).toBeNull();
    await flushProductUsageEvents();

    expect(sink).toHaveBeenCalledTimes(1);
    expect(getProductUsageDiagnostics().rejected).toBe(1);
  });

  it('isolates ingest failures and retains the batch for a later retry', async () => {
    configureProductUsageAnalytics({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: '0.2.125',
      sink: async () => { throw new Error('offline'); },
    });
    trackProductUsageEvent({
      kind: 'navigation',
      feature: 'surface',
      action: 'viewed',
      surface: 'dashboard',
      target: 'dashboard',
    });

    await expect(flushProductUsageEvents()).resolves.toBeUndefined();
    expect(getProductUsageDiagnostics()).toMatchObject({
      queued: 2,
      failedBatches: 1,
      lastFailureCode: 'ingest_failed',
    });
  });

  it('does nothing while no signed-in analytics session is configured', () => {
    expect(trackProductUsageEvent({
      kind: 'navigation',
      feature: 'surface',
      action: 'viewed',
      surface: 'dashboard',
    })).toBeNull();
    expect(getProductUsageDiagnostics()).toMatchObject({ enabled: false, queued: 0 });
  });

  it('drops pending events instead of attributing them to another account', () => {
    const sink = vi.fn(async (events: ProductUsageEvent[]) => ({
      accepted: events.length,
      duplicates: 0,
    }));
    configureProductUsageAnalytics({
      enabled: true,
      accountId: '11111111-1111-4111-8111-111111111111',
      releaseVersion: '0.2.125',
      sink,
    });
    trackProductUsageEvent({
      kind: 'navigation',
      feature: 'surface',
      action: 'viewed',
      surface: 'dashboard',
    });

    configureProductUsageAnalytics({
      enabled: true,
      accountId: '22222222-2222-4222-8222-222222222222',
      releaseVersion: '0.2.125',
      sink,
    });

    expect(getProductUsageDiagnostics()).toMatchObject({ queued: 1, dropped: 2 });
  });
});
