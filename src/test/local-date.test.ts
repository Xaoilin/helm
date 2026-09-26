import { describe, expect, it } from 'vitest';
import { addLocalDays, fromLocalDateStr, toLocalDateStr } from '../services/localDate';
import { toLocalDateStr as financeToLocalDateStr } from '../services/financeHelpers';

describe('local date keys', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toLocalDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('parses a valid key as local midnight', () => {
    const parsed = fromLocalDateStr('2026-02-28');
    expect(parsed && toLocalDateStr(parsed)).toBe('2026-02-28');
    expect(parsed?.getHours()).toBe(0);
  });

  it('rejects malformed and impossible keys', () => {
    expect(fromLocalDateStr('2026-2-28')).toBeNull();
    expect(fromLocalDateStr('2026-02-30')).toBeNull();
    expect(fromLocalDateStr('')).toBeNull();
  });

  it('adds whole days across month and year boundaries', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('not-a-date', 1)).toBeNull();
  });

  it('keeps the finance helper export pointing at the shared implementation', () => {
    expect(financeToLocalDateStr).toBe(toLocalDateStr);
  });
});
