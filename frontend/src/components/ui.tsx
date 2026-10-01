import { useEffect, useRef } from 'react';
import { ApiError, errCode } from '../api';

export function ErrorBox({ error, onRetry, retryLabel }: { error: unknown; onRetry?: () => void; retryLabel?: string }) {
  const retryable = !!(error instanceof ApiError && error.retryable && onRetry);
  return (
    <div className="error-box" role="alert">
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {retryable && (
        <button type="button" className="ghost-button" onClick={onRetry}>
          {retryLabel ?? '重试'}
        </button>
      )}
      <span className="mono">错误码 {errCode(error)}</span>
    </div>
  );
}

export function EmptyState({ symbol, title, children }: { symbol: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="big-symbol">{symbol}</span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return <div className="loading" role="status">{text}</div>;
}

export function JobModal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyStyle = document.body.style;
    const documentStyle = document.documentElement.style;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousDocumentOverflow = documentStyle.overflow;
    const previousBodyPaddingRight = bodyStyle.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const activePanel = closeRef.current?.closest<HTMLElement>('.panel');
    const previousPanelAnimation = activePanel?.style.animation ?? '';
    const previousPanelTransform = activePanel?.style.transform ?? '';
    documentStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    if (scrollbarWidth > 0) bodyStyle.paddingRight = scrollbarWidth + 'px';
    // The page panels use an entrance transform. A fixed modal inside a
    // transformed ancestor is positioned against that long panel instead of
    // the viewport, which can place the dialog outside the visible screen.
    if (activePanel) {
      activePanel.style.animation = 'none';
      activePanel.style.transform = 'none';
    }
    closeRef.current?.focus();
    const dialog = dialogRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        e.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog?.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      documentStyle.overflow = previousDocumentOverflow;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.paddingRight = previousBodyPaddingRight;
      if (activePanel) {
        activePanel.style.animation = previousPanelAnimation;
        activePanel.style.transform = previousPanelTransform;
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label="关闭岗位详情">×</button>
        {children}
      </div>
    </div>
  );
}

