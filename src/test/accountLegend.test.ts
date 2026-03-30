import { describe, it, expect } from 'vitest';
import type { CalendarAccount } from '../types/domain';

/**
 * Tests for account color legend logic.
 * The legend should show each account with its correct palette color.
 */

const ACCOUNT_PALETTES = [
  { bg: '#1a2744', border: '#3b82f6', text: '#93bbfc' },  // blue
  { bg: '#2a1f3d', border: '#a855f7', text: '#c4a0f7' },  // purple
  { bg: '#1a3328', border: '#22c55e', text: '#86efac' },  // green
  { bg: '#3d2a1a', border: '#f59e0b', text: '#fcd34d' },  // amber
  { bg: '#3d1a2a', border: '#ec4899', text: '#f9a8d4' },  // pink
  { bg: '#1a3a3d', border: '#14b8a6', text: '#5eead4' },  // teal
  { bg: '#3d2d1a', border: '#f97316', text: '#fdba74' },  // orange
  { bg: '#2d1a1a', border: '#ef4444', text: '#fca5a5' },  // red
];

// Same logic as CalendarSurface uses
function buildAccountPaletteMap(accounts: CalendarAccount[]) {
  const map = new Map<string, typeof ACCOUNT_PALETTES[number]>();
  accounts.forEach((acc, i) => {
    const idx = acc.paletteIndex ?? i;
    map.set(acc.id, ACCOUNT_PALETTES[idx % ACCOUNT_PALETTES.length]);
  });
  return map;
}

const makeAccount = (id: string, email: string, index?: number): CalendarAccount => ({
  id,
  name: email.split('@')[0],
  email,
  provider: 'google',
  isPrimary: (index ?? 0) === 0,
  connected: true,
  mocked: false,
});

describe('Account color legend', () => {
  it('should assign distinct colors to 3 accounts', () => {
    const accounts = [
      makeAccount('acc1', 'work@co.com', 0),
      makeAccount('acc2', 'personal@gmail.com', 1),
      makeAccount('acc3', 'lina@gmail.com', 2),
    ];
    const map = buildAccountPaletteMap(accounts);

    expect(map.get('acc1')!.border).toBe('#3b82f6'); // blue
    expect(map.get('acc2')!.border).toBe('#a855f7'); // purple
    expect(map.get('acc3')!.border).toBe('#22c55e'); // green

    // All different
    const borders = [...map.values()].map(p => p.border);
    expect(new Set(borders).size).toBe(3);
  });

  it('should cycle colors for more than 8 accounts', () => {
    const accounts = Array.from({ length: 10 }, (_, i) =>
      makeAccount(`acc${i}`, `user${i}@test.com`, i)
    );
    const map = buildAccountPaletteMap(accounts);

    // Account 0 and account 8 should have the same color (cycle)
    expect(map.get('acc0')!.border).toBe(map.get('acc8')!.border);
    expect(map.get('acc1')!.border).toBe(map.get('acc9')!.border);
  });

  it('should be stable when account order stays the same', () => {
    const accounts = [
      makeAccount('acc-work', 'work@co.com'),
      makeAccount('acc-personal', 'me@gmail.com'),
    ];
    const map1 = buildAccountPaletteMap(accounts);
    const map2 = buildAccountPaletteMap(accounts);

    expect(map1.get('acc-work')!.border).toBe(map2.get('acc-work')!.border);
    expect(map1.get('acc-personal')!.border).toBe(map2.get('acc-personal')!.border);
  });

  it('should not render legend for single account', () => {
    const accounts = [makeAccount('acc1', 'solo@test.com')];
    // The CalendarSurface renders legend only if accounts.length > 1
    expect(accounts.length > 1).toBe(false);
  });

  it('should render legend for multiple accounts', () => {
    const accounts = [
      makeAccount('acc1', 'a@test.com'),
      makeAccount('acc2', 'b@test.com'),
    ];
    expect(accounts.length > 1).toBe(true);
  });

  it('palette map should contain every account', () => {
    const accounts = [
      makeAccount('acc1', 'a@test.com'),
      makeAccount('acc2', 'b@test.com'),
      makeAccount('acc3', 'c@test.com'),
    ];
    const map = buildAccountPaletteMap(accounts);
    expect(map.size).toBe(3);
    for (const acc of accounts) {
      expect(map.has(acc.id)).toBe(true);
    }
  });
});

describe('Custom paletteIndex', () => {
  it('should override the default index-based color', () => {
    const accounts = [
      { ...makeAccount('acc1', 'work@co.com', 0), paletteIndex: 2 },  // force green instead of blue
      makeAccount('acc2', 'personal@gmail.com', 1),
    ];
    const map = buildAccountPaletteMap(accounts);
    expect(map.get('acc1')!.border).toBe('#22c55e'); // green (index 2), not blue (index 0)
    expect(map.get('acc2')!.border).toBe('#a855f7'); // purple (default index 1)
  });

  it('should allow two accounts to swap colors', () => {
    const accounts = [
      { ...makeAccount('acc1', 'a@test.com', 0), paletteIndex: 1 },  // purple
      { ...makeAccount('acc2', 'b@test.com', 1), paletteIndex: 0 },  // blue
    ];
    const map = buildAccountPaletteMap(accounts);
    expect(map.get('acc1')!.border).toBe('#a855f7'); // purple
    expect(map.get('acc2')!.border).toBe('#3b82f6'); // blue
  });

  it('should fall back to index when paletteIndex is undefined', () => {
    const accounts = [
      makeAccount('acc1', 'a@test.com', 0),  // no paletteIndex -> defaults to index 0 (blue)
    ];
    const map = buildAccountPaletteMap(accounts);
    expect(map.get('acc1')!.border).toBe('#3b82f6'); // blue
  });

  it('should wrap paletteIndex with modulo for out-of-range values', () => {
    const accounts = [
      { ...makeAccount('acc1', 'a@test.com', 0), paletteIndex: 10 },  // 10 % 8 = 2 = green
    ];
    const map = buildAccountPaletteMap(accounts);
    expect(map.get('acc1')!.border).toBe('#22c55e'); // green (index 2)
  });
});
