import { useCallback, useEffect, useState } from 'react';
import JobsTab from './components/JobsTab';
import ProfileTab from './components/ProfileTab';
import MatchesTab from './components/MatchesTab';
import PathsTab from './components/PathsTab';
import AIConfigPanel from './components/AIConfigPanel';
import LocalDraftSettingsPanel from './components/LocalDraftSettingsPanel';
import OnboardingWizard, { type OnboardingOutcome, type OnboardingStart } from './components/OnboardingWizard';
import { CAREER_TABS, useCareerSession } from './lib/useCareerSession';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    window.localStorage.getItem('career-planning-theme') === 'light' ? 'light' : 'dark'
  );
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
  }, []);
  const {
    tab,
    navigateTo,
    navigateWorkflowStep,
    workflowSteps,
    activeWorkflowStep,
    continueLabel,
    continueWorkflow,
    health,
    loadHealth,
    jobs,
    jobsLoading,
    jobsError,
    loadJobs,
    student,
    resumeName,
    setResumeName,
    studentRev,
    revRef,
    analysis,
    setAnalysis,
    updateStudent,
    editStudent,
    replaceStudent,
    setTargetJob,
    sourceModeRequest,
    onSourceModeRequestHandled,
    profileFocus,
    onProfileFocusHandled,
    goProfileFocus,
    onFreshnessChange,
    sessionResetKey,
    selectedPath,
    pathFocusRequest,
    onPathSelectionChange,
    onClearPathSelection,
    onSavePathSelection,
    autosaveEnabled,
    autosaveChoicePending,
    autosaveAvailable,
    draftStatus,
    draftSavedAt,
    chooseAutosave,
    toggleAutosave,
    clearSessionDraft,
    onboardingRequired,
    finishOnboarding: completeOnboarding
  } = useCareerSession(showToast);
  const [onboardingOpen, setOnboardingOpen] = useState(onboardingRequired);

  useEffect(() => {
    window.localStorage.setItem('career-planning-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const finishOnboarding = useCallback((outcome: OnboardingOutcome, start?: OnboardingStart) => {
    completeOnboarding(outcome, start);
    setOnboardingOpen(false);
  }, [completeOnboarding]);

  return (
    <div className="exploration-shell" data-theme={theme}>
      <header className={autosaveChoicePending || onboardingOpen ? 'exploration-header is-blocked' : 'exploration-header'}>
        <span className="exploration-wordmark"><span aria-hidden="true">↗</span>大学生职业规划</span>
        <nav className="exploration-nav" role="tablist" aria-label="职业探索主导航">
          {CAREER_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={'page-' + t.id}
              className={'exploration-nav-item' + (tab === t.id ? ' active' : '')}
              onClick={() => navigateTo(t.id)}
            >
              <span>{t.code}</span>{t.label}
            </button>
          ))}
        </nav>
        <div className="exploration-header-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === 'dark' ? '切换到白色护眼模式' : '切换到深色模式'}
            aria-pressed={theme === 'light'}
            onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '白色护眼' : '深色模式'}
          </button>
          <button className="onboarding-trigger" type="button" onClick={() => setOnboardingOpen(true)}>
            <span aria-hidden="true">?</span> 新手教程
          </button>
          <button className="settings-trigger" type="button" onClick={() => setSettingsOpen(true)}>
            <span aria-hidden="true">⚙</span> 设置
          </button>
          <button className="model-config-trigger" type="button" onClick={() => setConfigOpen(true)}>
            <span aria-hidden="true">✦</span> AI 模型配置
          </button>
        </div>
      </header>
      {!autosaveChoicePending && <aside className="workflow-guide" aria-label="流程导航">
        <ol>
          {workflowSteps.map((item, index) => <li key={item.label} className={item.state === '已过期' ? 'is-stale' : item.state.startsWith('已') || item.state === '最新' ? 'is-done' : ''}>
            <button
              className="workflow-guide-step"
              type="button"
              title={item.label + '：' + item.state}
              aria-label={(index + 1) + '. ' + item.label + '：' + item.state}
              aria-current={activeWorkflowStep === index ? 'step' : undefined}
              onClick={() => navigateWorkflowStep(index)}
            >
              <span className="workflow-step-number" aria-hidden="true">{index + 1}</span>
              <span className="workflow-guide-step-copy"><strong>{item.label}</strong><small>{item.state}</small></span>
            </button>
          </li>)}
        </ol>
        <button
          className="workflow-guide-next"
          type="button"
          aria-label={'下一步：' + continueLabel}
          onClick={continueWorkflow}
        >
          <svg className="workflow-guide-next-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="M4 12h16m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="workflow-guide-next-copy"><small>下一步</small><b>{continueLabel}</b></span>
        </button>
      </aside>}
      {(onboardingOpen || autosaveChoicePending) && <OnboardingWizard
        autosaveChoicePending={autosaveChoicePending}
        autosaveAvailable={autosaveAvailable}
        onChooseAutosave={chooseAutosave}
        onFinish={finishOnboarding}
      />}
      <main className="exploration-pages" data-active-page={tab}>
        <h1 className="sr-only">大学生职业探索与岗位匹配</h1>
        <div id="page-jobs" className={'panel' + (tab === 'jobs' ? ' active' : '')} role="tabpanel" aria-label="职业探索">
          <JobsTab
            jobs={jobs}
            loading={jobsLoading}
            error={jobsError}
            onRetry={loadJobs}
            onSetTarget={setTargetJob}
            targetJobId={student.intention.target_job_id}
          />
        </div>
        <div id="page-profile" className={'panel' + (tab === 'profile' ? ' active' : '')} role="tabpanel" aria-label="简历与个人报告">
          <ProfileTab
            student={student}
            resumeName={resumeName}
            setResumeName={setResumeName}
            updateStudent={updateStudent}
            editStudent={editStudent}
            replaceStudent={replaceStudent}
            revRef={revRef}
            jobs={jobs}
            analysis={analysis}
            setAnalysis={setAnalysis}
            showToast={showToast}
            onGoMatches={() => navigateTo('matches')}
            onSetTargetJob={setTargetJob}
            sourceModeRequest={sourceModeRequest}
            onSourceModeRequestHandled={onSourceModeRequestHandled}
            focusTarget={profileFocus}
            onFocusHandled={onProfileFocusHandled}
          />
        </div>
        <div id="page-matches" className={'panel' + (tab === 'matches' ? ' active' : '')} role="tabpanel" aria-label="匹配报告">
          <MatchesTab
            key={sessionResetKey}
            isActive={tab === 'matches'}
            student={student}
            studentRev={studentRev}
            serverAlgorithm={health?.algorithm_version ?? null}
            serverDataVersion={health?.data_version ?? null}
            showToast={showToast}
            onGoProfile={() => navigateTo('profile')}
            onGoProfileFocus={goProfileFocus}
            onFreshnessChange={onFreshnessChange}
          />
        </div>
        <div id="page-paths" className={'panel' + (tab === 'paths' ? ' active' : '')} role="tabpanel" aria-label="成长路径">
          <PathsTab active={tab === 'paths'} jobs={jobs} showToast={showToast} targetJobId={student.intention.target_job_id} focusRequest={pathFocusRequest} savedSelection={selectedPath} onSelectionChange={onPathSelectionChange} onClearSelection={onClearPathSelection} onSaveSelection={onSavePathSelection} />
        </div>
      </main>
      {configOpen && <AIConfigPanel onClose={() => setConfigOpen(false)} onSaved={() => { void loadHealth(); showToast('AI 模型配置已更新'); }} />}
      {settingsOpen && <LocalDraftSettingsPanel
        enabled={autosaveEnabled}
        available={autosaveAvailable}
        status={draftStatus}
        savedAt={draftSavedAt}
        onToggle={toggleAutosave}
        onClear={clearSessionDraft}
        onClose={() => setSettingsOpen(false)}
      />}
      {toast && <div className={'toast show ' + toast.kind} role="status">{toast.msg}</div>}
    </div>
  );
}
