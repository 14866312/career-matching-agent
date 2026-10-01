import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
    description: '导入简历后，系统提取专业、经历和技能；你可以按需修改或删除。',
    action: '从简历开始'
  },
  {
    id: 'manual',
    eyebrow: '从零开始',
    title: '我没有简历',
    description: '直接填写专业、经历和技能，随后生成个人报告；目标岗位可以稍后再选。',
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
  { number: '1', title: '导入或填写资料', detail: '从简历提取技能，也能直接手动填写。' },
  { number: '2', title: '生成个人报告', detail: '查看技能、经历与提升方向。' },
  { number: '3', title: '匹配岗位', detail: '查看岗位要求与当前资料的对应情况。' },
  { number: '4', title: '查看针对性建议', detail: '选定岗位后生成建议，按需探索成长路径。' }
];

const ROUTE_STEPS = [
  { number: '01', title: '整理资料', detail: '导入或填写' },
  { number: '02', title: '个人报告', detail: '认识自己' },
  { number: '03', title: '岗位匹配', detail: '了解岗位' },
  { number: '04', title: '行动建议', detail: '明确下一步' }
];

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.hidden && element.getClientRects().length > 0);
}

function ArrowRightIcon() {
  return (
    <svg className="onboarding-action-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 12h16m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.scrollTop = 0;
    if (screen === 1) dialog.querySelector<HTMLButtonElement>('.onboarding-back-button')?.focus({ preventScroll: true });
    else dialog.focus({ preventScroll: true });
  }, [screen]);

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
        <div className="onboarding-wizard-header">
          <div>
            <p className="onboarding-wizard-kicker">新手教程 · 从这里开始</p>
            <p className="onboarding-wizard-progress" aria-live="polite">{screen === 0 ? '入口选择' : '开始规划'} · {screen + 1} / 2</p>
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
        </div>

        {screen === 0 ? (
          <>
            <div className="onboarding-wizard-intro">
              <span className="onboarding-section-label">四步路线</span>
              <h2 id="onboarding-wizard-title">从简历到下一步求职行动</h2>
              <p id="onboarding-wizard-description">先导入简历或手动填写资料，查看个人分析，再匹配岗位和获取建议。也可以先浏览岗位；目标岗位不是开始的前提。</p>
            </div>

            {autosaveChoicePending && (
              <section className="onboarding-storage-choice" aria-labelledby="onboarding-storage-title">
                <div>
                  <span className="onboarding-section-label">使用偏好</span>
                  <strong id="onboarding-storage-title">要在这台浏览器自动保存吗？</strong>
                  <p>{autosaveAvailable
                    ? '会保存已整理的简历资料、目标岗位、当前页面和已选成长路径。简历姓名、原文件、AI 报告和模型密钥不会保存。'
                    : '当前浏览器不允许本机存储。你仍可继续使用，数据只保留在本次会话中。'}</p>
                </div>
                <div className="onboarding-storage-actions">
                  <button className="primary-button" type="button" onClick={() => onChooseAutosave(true)} disabled={!autosaveAvailable}>自动保存</button>
                  <button className="ghost-button" type="button" onClick={() => onChooseAutosave(false)}>本次不保存</button>
                </div>
              </section>
            )}

            <ol className="onboarding-route-preview" aria-label="职业规划四步路线">
              {ROUTE_STEPS.map((step, index) => (
                <li key={step.number}>
                  <span className="onboarding-route-number" aria-hidden="true">{step.number}</span>
                  <span className="onboarding-route-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
                  {index < ROUTE_STEPS.length - 1 && <span className="onboarding-route-line" aria-hidden="true" />}
                </li>
              ))}
            </ol>

            <div className="onboarding-choice-heading">
              <span className="onboarding-section-label">第一步</span>
              <strong>从哪里开始最适合你？</strong>
              <small>选完后仍可随时切换页面。</small>
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
                  <em>{point.action}<ArrowRightIcon /></em>
                </button>
              ))}
            </div>

            <footer className="onboarding-wizard-footer">
              <span>你可以之后从顶部“新手教程”再次打开说明。</span>
              <button className="onboarding-skip-button" type="button" disabled={!canLeave} onClick={() => onFinish('skipped')}>先跳过教程</button>
            </footer>
          </>
        ) : (
          <>
            <div className="onboarding-wizard-intro">
              <button className="onboarding-back-button" type="button" onClick={() => setScreen(0)}>重新选择入口</button>
              <span className="onboarding-section-label">第二步</span>
              <h2 id="onboarding-wizard-title">准备好，按这条线继续</h2>
              <p id="onboarding-wizard-description">当前入口：{startPoint?.title}。{startPoint?.description}</p>
            </div>
            {autosaveChoicePending && (
              <section className="onboarding-storage-choice" aria-labelledby="onboarding-storage-title-final">
                <div>
                  <span className="onboarding-section-label">使用偏好</span>
                  <strong id="onboarding-storage-title-final">先确认本机保存方式</strong>
                  <p>{autosaveAvailable
                    ? '完成选择后才能开始使用。会保存已整理的简历资料、目标岗位、当前页面和已选成长路径；简历姓名、原文件、AI 报告和模型密钥不会保存。'
                    : '当前浏览器不允许本机存储。选择继续后，数据只保留在本次会话中。'}</p>
                </div>
                <div className="onboarding-storage-actions">
                  <button className="primary-button" type="button" onClick={() => onChooseAutosave(true)} disabled={!autosaveAvailable}>自动保存</button>
                  <button className="ghost-button" type="button" onClick={() => onChooseAutosave(false)}>本次不保存</button>
                </div>
              </section>
            )}
            <ol className="onboarding-flow-list" aria-label="四步使用说明">
              {FLOW_STEPS.map(step => (
                <li key={step.number}>
                  <span className="onboarding-flow-number" aria-hidden="true">{step.number}</span>
                  <span><strong>{step.title}</strong><small>{step.detail}</small></span>
                </li>
              ))}
            </ol>
            <p className="onboarding-confirmation-note">每一步都可以返回修改。重新导入简历会更新提取的内容，并保留手动补充的信息。</p>
            <div className="onboarding-principles">
              <div><b>技能可修改</b><span>提取有误时直接修改或删除；缺少内容时手动添加。</span></div>
              <div><b>个人报告</b><span>根据当前资料梳理技能、经历和提升方向。</span></div>
              <div><b>岗位建议</b><span>选择感兴趣的岗位，查看匹配依据及针对性行动建议。</span></div>
            </div>
            <footer className="onboarding-wizard-footer onboarding-wizard-footer-final">
              <button className="onboarding-skip-button" type="button" disabled={!canLeave} onClick={() => onFinish('skipped')}>跳过教程</button>
              <button className="primary-button" type="button" disabled={!canLeave || !selectedStart} onClick={() => selectedStart && onFinish('completed', selectedStart)}>
                {startPoint?.action ?? '开始使用'} <ArrowRightIcon />
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
