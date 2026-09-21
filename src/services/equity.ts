import type { EquityPosition } from '../types/domain';

export function equityTotals(position: EquityPosition) {
  return position.grants.reduce((total, grant) => ({
    vested: total.vested + grant.vested,
    unvested: total.unvested + grant.unvested,
    strikeCostUsd: total.strikeCostUsd + grant.vested * grant.strikeUsd,
  }), { vested: 0, unvested: 0, strikeCostUsd: 0 });
}

/** Illustrative exercise-and-sale of currently vested in-the-money options only. */
export function equityScenario(position: EquityPosition, priceUsd: number) {
  const eligible = position.grants.filter(grant => priceUsd > grant.strikeUsd);
  const quantity = eligible.reduce((sum, grant) => sum + grant.vested, 0);
  const strikeCostUsd = eligible.reduce((sum, grant) => sum + grant.vested * grant.strikeUsd, 0);
  const grossUsd = quantity * priceUsd;
  const spreadUsd = grossUsd - strikeCostUsd;
  return { quantity, strikeCostUsd, grossUsd, spreadUsd,
    netGbp: spreadUsd * (1 - position.scenario.withholdingRate) * position.scenario.usdToGbp };
}

/** Only confirmed grant-specific post-employment deadlines create a resolution date. */
export function equityResolutionDate(expiry: string): string {
  const [year, month, day] = expiry.split('-').map(Number);
  const target = new Date(year, month - 7, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function equityDate(date?: string): string {
  if (!date) return 'Not confirmed';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day || 1, 12).toLocaleDateString('en-GB', {
    ...(day ? { day: 'numeric' as const } : {}), month: 'short', year: 'numeric',
  });
}

export function equityMoney(amount: number, currency: 'USD' | 'GBP', decimals = 0) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency,
    minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount);
}
