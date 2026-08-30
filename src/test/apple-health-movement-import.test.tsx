import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppleHealthMovementImport from '../components/AppleHealthMovementImport';

const mocks = vi.hoisted(() => ({ accept: vi.fn() }));

vi.mock('../store/supabase', () => ({
  acceptLifeHeroEvidence: mocks.accept,
}));

const EXPORT = `<?xml version="1.0"?>
<HealthData>
  <ExportDate value="2026-08-31 12:00:00 +0000"/>
  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-08-30 23:30:00 -0400" endDate="2026-08-30 23:45:00 -0400" value="12"/>
</HealthData>`;

beforeEach(() => {
  mocks.accept.mockReset().mockResolvedValue({ duplicate: false });
});

describe('Apple Health movement import surface', () => {
  it('visibly degrades from unavailable HealthKit automation to the explicit export bridge', () => {
    render(<AppleHealthMovementImport timeZone="America/New_York" now={new Date('2026-09-01T12:00:00.000Z')} />);

    expect(screen.getByRole('heading', { name: 'Import from iPhone Health' })).toBeInTheDocument();
    expect(screen.getByText(/Automatic HealthKit sync is unavailable/u)).toBeInTheDocument();
    expect(screen.getByText(/No watch, native app, credentials, routes, or location data/u)).toBeInTheDocument();
  });

  it('submits a selected export and renders source, range, freshness, and duplicate evidence', async () => {
    render(<AppleHealthMovementImport timeZone="America/New_York" now={new Date('2026-09-01T12:00:00.000Z')} />);
    const input = screen.getByLabelText('Select Apple Health XML');
    fireEvent.change(input, {
      target: { files: [new File([EXPORT], 'export.xml', { type: 'text/xml' })] },
    });

    await waitFor(() => expect(screen.getByText('Imported 1 movement day safely.')).toBeInTheDocument());
    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('2026-08-30 to 2026-08-30')).toBeInTheDocument();
    expect(screen.getByText(/exported 1 day ago/u)).toBeInTheDocument();
    expect(screen.getByText('1 new · 0 already recorded')).toBeInTheDocument();
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.accept.mock.calls)).not.toContain(EXPORT);
  });
});
