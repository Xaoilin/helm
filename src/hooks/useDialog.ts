import { useCallback, useEffect, useRef } from 'react';

interface DialogOptions {
  open: boolean;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
}

/** Focus and dismissal behavior shared by the More sheet and draft editors. */
export function useDialog({ open, onClose, dirty = false, busy = false }: DialogOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved changes? Your draft will be lost.')) return;
    onClose();
  }, [busy, dirty, onClose]);
  const closeRef = useRef(requestClose);

  useEffect(() => { closeRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] ?? dialog).focus();
    focusFirst();

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = controls();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', containFocus);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open]);

  return { dialogRef, requestClose };
}
