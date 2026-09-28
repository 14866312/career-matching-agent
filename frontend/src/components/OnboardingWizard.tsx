import { useEffect, useRef, useState } from 'react';

export type OnboardingStart = 'resume' | 'manual' | 'jobs';
export type OnboardingOutcome = 'completed' | 'skipped';

interface OnboardingWizardProps {
  autosaveChoicePending: boolean;
  autosaveAvailable: boolean;
  onChooseAutosave: (enabled: boolean) => void;
  onFinish: (outcome: OnboardingOutcome, start?: OnboardingStart) => void;
}

const START_POINTS: Array<{
  id: OnboardingStart;
  eyebrow: string;
  title: string;
  description: string;
  action: string;
}> = [
  {
    id: 'resume',
    eyebrow: '已有材料',
    title: '我有简历',
    description: '先导入简历，系统只把识别结果列成候选，逐项接受后才会进入档案。',
    action: '从简历开始'
  },
  {
    id: 'manual',
    eyebrow: '从零开始',
    title: '我没有简历',
    description: '直接填写专业、经历和能力，适合边想边整理，目标岗位也可以稍后再选。',
    action: '手动建立档案'
  },
  {
    id: 'jobs',
    eyebrow: '先找方向',
    title: '我先看看岗位',
    description: '先浏览岗位和要求，再决定要不要建档，不需要先准备任何资料。',
    action: '先浏览岗位'
  }
];

const FLOW_STEPS = [
  { number: '1', title: '了解岗位', detail: '可以选一个目标，也可以跳过。' },
  { number: '2', title: '整理档案', detail: '核对能力，并补充可验证的证据。' },
  { number: '3', title: '看匹配结果', detail: '区分待补充、待确认和明确差距。' },
  { number: '4', title: '开始行动', detail: '查看建议，或保存一条成长路径。' }
];

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hidden && element.getClientRects().length > 0);
}

export default function OnboardingWizard({
  autosaveChoicePending,
  autosaveAvailable,
  onChooseAutosave,
  onFinish
}: OnboardingWizardProps) {
  const [selectedStart, setSelectedStart] = useState<OnboardingStart | null>(null);
  const [screen, setScreen] = useState<0 | 1>(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusFirst = () => focusableElements(dialog)[0]?.focus();
    focusFirst();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!autosaveChoicePending) onFinishRef.current('skipped');
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(dialog);
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
  }, [autosaveChoicePending]);

  const startPoint = START_POINTS.find(point => point.id === selectedStart);
  const canLeave = !autosaveChoicePending;

  return (
    <div
      className="onboarding-wizard-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && canLeave) onFinish('skipped');
      }}
    >
      <section
        ref={dialogRef}
        className="onboarding-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="新手教程与本机保存设置"
        aria-describedby="onboarding-wizard-description"
        tabIndex={-1}
      >
        <header className="onboarding-wizard-header">
          <div>
            <p className="onboarding-wizard-kicker">NEW HERE · 01—04</p>
            <p className="onboarding-wizard-progress" aria-live="polite">{screen + 1} / 2</p>
          </div>
          <button
            className="onboarding-wizard-close"
            type="button"
            aria-label="跳过新手教程"
            disabled={!canLeave}
            onClick={() => onFinish('skipped')}
          >
            ×
          </button>
        </header>

        {screen === 0 ? (
          <>
            <div className="onboarding-wizard-intro">
              <h2 id="onboarding-wizard-title">先选一种开始方式</h2>
              <p id="onboarding-wizard-description">不用一次准备完整。选一个最接近你现在状态的入口，接下来每一步都会告诉你该做什么；岗位目标随时可以跳过。</p>
            </div>
            <div className="onboarding-start-grid" aria-label="选择开始方式">
              {START_POINTS.map(point => (
                <button
                  key={point.id}
                  className={'onboarding-start-card' + (selectedStart === point.id ? ' is-selected' : '')}
                  type="button"
                  aria-pressed={selectedStart === point.id}
                  onClick={() => {
                    setSelectedStart(point.id);
                    setScreen(1);
                  }}
                >
                  <span className="onboarding-start-eyebrow">{point.eyebrow}</span>
                  <strong>{point.title}</strong>
                  <span>{point.description}</span>
                  <em>{point.action} <b aria-hidden="true">→</b></em>
                </button>
              ))}
            </div>

            {autosaveChoicePending && (
              <section className="onboarding-storage-choice" aria-labelledby="onboarding-storage-title">
                <div>
                  <strong id="onboarding-storage-title">要在这台浏览器自动保存吗？</strong>
                  <p>{autosaveAvailable
                    ? '会保存能力档案、目标岗位、当前页面和已选成长路径。简历姓名、未审核候选、原文件、AI 报告和模型密钥不会保存。'
                    : '当前浏览器不允许本机存储。你仍可继续使用，数据只保留在本次会话中。'}</p>
                </div>
                <div className="onboarding-storage-actions">
                  <button className="primary-button" type="button" onClick={() => onChooseAutosave(true)} disabled={!autosaveAvailable}>自动保存</button>
                  <button className="ghost-button" type="button" onClick={() => onChooseAutosave(false)}>本次不保存</button>
                </div>
              </section>
            )}

            <footer className="onboarding-wizard-footer">
              <span>你可以之后从顶部“新手教程”再次打开说明。</span>
              <button className="onboarding-skip-button" type="button" disabled={!canLeave} onClick={() => onFinish('skipped')}>先跳过教程</button>
            </footer>
          </>
        ) : (
          <>
            <div className="onboarding-wizard-intro">
              <button className="onboarding-back-button" type="button" onClick={() => setScreen(0)}>← 重新选择入口</button>
              <h2 id="onboarding-wizard-title">你会这样完成一次规划</h2>
              <p id="onboarding-wizard-description">{startPoint?.title}：{startPoint?.description}</p>
            </div>
            <ol className="onboarding-flow-list" aria-label="四步使用说明">
              {FLOW_STEPS.map(step => (
                <li key={step.number}>
                  <span className="onboarding-flow-number" aria-hidden="true">{step.number}</span>
                  <span><strong>{step.title}</strong><small>{step.detail}</small></span>
                </li>
              ))}
            </ol>
            <div className="onboarding-principles">
              <div><b>简历先审核</b><span>识别出的每项经历、能力和证据都要由你接受或跳过。</span></div>
              <div><b>能力要确认</b><span>补充证据后确认档案，才会参与匹配。</span></div>
              <div><b>差距有去处</b><span>待补充和明确差距会带你回到资料、建议或成长路径。</span></div>
            </div>
            {autosaveChoicePending && (
              <section className="onboarding-storage-choice" aria-labelledby="onboarding-storage-title-final">
                <div>
                  <strong id="onboarding-storage-title-final">先确认本机保存方式</strong>
                  <p>{autosaveAvailable
                    ? '完成选择后才能开始使用。会保存能力档案、目标岗位、当前页面和已选成长路径；简历姓名、未审核候选、原文件、AI 报告和模型密钥不会保存。'
                    : '当前浏览器不允许本机存储。选择继续后，数据只保留在本次会话中。'}</p>
                </div>
                <div className="onboarding-storage-actions">
                  <button className="primary-button" type="button" onClick={() => onChooseAutosave(true)} disabled={!autosaveAvailable}>自动保存</button>
                  <button className="ghost-button" type="button" onClick={() => onChooseAutosave(false)}>本次不保存</button>
                </div>
              </section>
            )}
            <footer className="onboarding-wizard-footer onboarding-wizard-footer-final">
              <button className="onboarding-skip-button" type="button" disabled={!canLeave} onClick={() => onFinish('skipped')}>跳过教程</button>
              <button className="primary-button" type="button" disabled={!canLeave || !selectedStart} onClick={() => selectedStart && onFinish('completed', selectedStart)}>
                {startPoint?.action ?? '开始使用'} <span aria-hidden="true">→</span>
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
