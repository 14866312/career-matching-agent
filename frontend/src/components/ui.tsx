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
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label="关闭岗位详情">×</button>
        {children}
      </div>
    </div>
  );
}

