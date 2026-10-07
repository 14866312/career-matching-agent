import { useEffect, useRef } from 'react';

interface LocalDraftSettingsPanelProps {
  enabled: boolean;
  available: boolean;
  status: string;
  savedAt: string | null;
  onToggle: (enabled: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function LocalDraftSettingsPanel({
  enabled,
  available,
  status,
  savedAt,
  onToggle,
  onClear,
  onClose
}: LocalDraftSettingsPanelProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
    getFocusable()[0]?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      className="local-draft-settings-backdrop"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        ref={dialogRef}
        className="local-draft-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-draft-settings-title"
      >
        <button
          className="local-draft-settings-close"
          type="button"
          aria-label="关闭本机数据设置"
          onClick={onClose}
        >
          ×
        </button>
        <p className="local-draft-settings-kicker">PRIVATE ON THIS BROWSER</p>
        <h2 id="local-draft-settings-title">本机数据设置</h2>
        <p className="local-draft-settings-lead">草稿仅存于当前浏览器，不上传服务端。</p>

        <div className="local-draft-setting-card">
          <div>
            <strong>自动保存到本机浏览器</strong>
            <p>刷新后继续上次规划。</p>
          </div>
          <label className="local-draft-switch">
            <span className="sr-only">自动保存到本机浏览器</span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!available}
              onChange={event => onToggle(event.target.checked)}
            />
            <span aria-hidden="true" />
          </label>
        </div>

        <p className={'local-draft-settings-state' + (enabled && available ? ' is-enabled' : '')} role="status">
          <i aria-hidden="true" />
          {available ? (enabled ? '自动保存已开启' : '自动保存已关闭') : '浏览器本机存储不可用'}
        </p>
        <p className="local-draft-settings-status" role="status">
          {status}
          {savedAt ? ' · 最近保存：' + new Date(savedAt).toLocaleString() : ''}
        </p>

        <div className="local-draft-privacy">
          <strong>保存范围</strong>
          <ul>
            <li>保存整理后的资料、目标岗位、页面和成长路径。</li>
            <li>不保存姓名、原文件、AI 报告和密钥。</li>
            <li>关闭自动保存不会删除已有草稿。</li>
          </ul>
        </div>

        <div className="local-draft-settings-actions">
          <button className="ghost-button" type="button" onClick={onClear}>清除草稿并重置</button>
          <button className="primary-button" type="button" onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  );
}
