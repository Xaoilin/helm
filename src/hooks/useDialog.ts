import { useCallback, useEffect, useRef } from 'react';

interface DialogOptions {
  open: boolean;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
  /**
   * Called on close when the element focused before opening has left the
   * page, for example because the card that opened the dialog moved sections.
   */
  restoreFocusFallback?: () => void;
}

/** Focus and dismissal behavior shared by the More sheet, drawers, and draft editors. */
export function useDialog<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  dirty = false,
  busy = false,
  restoreFocusFallback,
}: DialogOptions) {
  const dialogRef = useRef<T>(null);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm('Discard unsaved changes? Your draft will be lost.')) return;
    onClose();
  }, [busy, dirty, onClose]);
  const closeRef = useRef(requestClose);
  const fallbackRef = useRef(restoreFocusFallback);

  useEffect(() => { closeRef.current = requestClose; }, [requestClose]);
  useEffect(() => { fallbackRef.current = restoreFocusFallback; }, [restoreFocusFallback]);

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
      else fallbackRef.current?.();
    };
  }, [open]);

  return { dialogRef, requestClose };
}
