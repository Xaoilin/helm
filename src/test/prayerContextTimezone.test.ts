// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { canonicalizeTimezone } from '../store/contexts/PrayerContext';

describe('PrayerContext timezone validation', () => {
  it('preserves an explicit valid schedule timezone when resolvedOptions is spoofed', () => {
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function DateTimeFormatMock() {
      return {
        format: () => '',
        resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }),
      } as Intl.DateTimeFormat;
    });

    try {
      expect(canonicalizeTimezone('Europe/London')).toBe('Europe/London');
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

  it('fails closed for an invalid explicit timezone', () => {
    expect(canonicalizeTimezone('Not/An-IANA-Zone')).toBe('');
  });
});
