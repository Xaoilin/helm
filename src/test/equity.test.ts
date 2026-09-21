import { describe, expect, it } from 'vitest';
import { equityResolutionDate, equityScenario, equityTotals } from '../services/equity';
import type { EquityPosition } from '../types/domain';

const position = {
  ownedShares: 999,
  grants: [
    { id: 'A', vested: 10, unvested: 20, strikeUsd: 10 },
    { id: 'B', vested: 5, unvested: 2, strikeUsd: 100 },
  ],
  scenario: { withholdingRate: 0.4, usdToGbp: 0.8 },
} as EquityPosition;

describe('equity planning calculations', () => {
  it('keeps already-owned shares and unvested options out of current exercise totals', () => {
    expect(equityTotals(position)).toEqual({ vested: 15, unvested: 22, strikeCostUsd: 600 });
    expect(equityScenario(position, 50)).toEqual({ quantity: 10, strikeCostUsd: 100, grossUsd: 500, spreadUsd: 400, netGbp: 192 });
    expect(equityScenario(position, 100).quantity).toBe(10);
    expect(equityScenario(position, 5).netGbp).toBe(0);
    expect(equityScenario(position, 150).quantity).toBe(15);
  });
  it('derives six-month preparation dates from confirmed expiry with month-end clamping', () => {
    expect(equityResolutionDate('2030-08-31')).toBe('2030-02-28');
    expect(equityResolutionDate('2032-08-31')).toBe('2032-02-29');
    expect(equityResolutionDate('2030-02-12')).toBe('2029-08-12');
  });
});
