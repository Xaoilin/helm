import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EquityEditor } from '../components/finance/EquityEditor';

function fillHoldings() {
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Example company' } });
  fireEvent.change(screen.getByLabelText('Holdings as of'), { target: { value: '2026-09-01' } });
}

describe('EquityEditor', () => {
  it('saves editable scenario assumptions without adding any assumed holdings', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { container } = render(<EquityEditor saving={false} onSave={onSave} onClose={onClose} />);
    fillHoldings();
    fireEvent.change(screen.getByLabelText('Scenario prices (USD, separated by commas)'), { target: { value: '25, 75' } });
    fireEvent.change(screen.getByLabelText('Modeled withholding (%)'), { target: { value: '30' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      company: 'Example company', ownedShares: 0, grants: [],
      scenario: expect.objectContaining({ pricesUsd: [25, 75], withholdingRate: 0.3, usdToGbp: 1 }),
    }));
  });

  it('rejects malformed scenario prices without losing the draft', () => {
    const onSave = vi.fn();
    const { container } = render(<EquityEditor saving={false} onSave={onSave} onClose={vi.fn()} />);
    fillHoldings();
    fireEvent.change(screen.getByLabelText('Scenario prices (USD, separated by commas)'), { target: { value: '25, invalid' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('positive USD amounts');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Company')).toHaveValue('Example company');
  });

  it('prevents dismissal while saving and retains the draft after a save failure', async () => {
    let rejectSave!: (cause: Error) => void;
    const onSave = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
    const onClose = vi.fn();
    const { container } = render(<EquityEditor saving={false} onSave={onSave} onClose={onClose} />);
    fillHoldings();
    fireEvent.submit(container.querySelector('form')!);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectSave(new Error('Reconnect to save your changes.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect to save your changes.');
    expect(screen.getByLabelText('Company')).toHaveValue('Example company');
    expect(screen.getByRole('button', { name: 'Save equity' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
