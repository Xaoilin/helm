import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialog } from '../hooks/useDialog';

function Dialog({ onClose, restoreFocusFallback }: { onClose: () => void; restoreFocusFallback?: () => void }) {
  const { dialogRef } = useDialog({ open: true, onClose, restoreFocusFallback });
  return (
    <div ref={dialogRef} role="dialog" aria-label="Example" tabIndex={-1}>
      <button type="button">First</button>
      <button type="button" disabled>Disabled</button>
      <button type="button">Last</button>
    </div>
  );
}

function Harness({ restoreFocusFallback, removeOpenerOnClose = false }: { restoreFocusFallback?: () => void; removeOpenerOnClose?: boolean }) {
  const [open, setOpen] = useState(false);
  const [openerShown, setOpenerShown] = useState(true);
  return (
    <>
      {openerShown && <button type="button" onClick={() => setOpen(true)}>Open</button>}
      <button type="button">Outside</button>
      {open && (
        <Dialog
          restoreFocusFallback={restoreFocusFallback}
          onClose={() => {
            setOpen(false);
            if (removeOpenerOnClose) setOpenerShown(false);
          }}
        />
      )}
    </>
  );
}

describe('useDialog', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give every element a box so it counts as visible.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as unknown as DOMRectList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('focuses the first enabled control when it opens', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog, skipping disabled controls', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('pulls focus back when something outside the dialog is focused', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the control that opened it', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('uses the fallback when the opener has left the page', () => {
    const restoreFocusFallback = vi.fn();
    render(<Harness removeOpenerOnClose restoreFocusFallback={restoreFocusFallback} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(restoreFocusFallback).toHaveBeenCalledTimes(1);
  });

  it('does not use the fallback when the opener is still there', () => {
    const restoreFocusFallback = vi.fn();
    render(<Harness restoreFocusFallback={restoreFocusFallback} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(restoreFocusFallback).not.toHaveBeenCalled();
  });
});
