import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { apiGet, errMessage } from './api';
import type { HealthResp, JobSummary, ProfileFocusTarget, ProfileResp, StudentProfile } from './types';
import JobsTab from './components/JobsTab';
import ProfileTab from './components/ProfileTab';
import MatchesTab from './components/MatchesTab';
import PathsTab from './components/PathsTab';
import AIConfigPanel from './components/AIConfigPanel';
import { createLocalDraft, getBrowserStorage, readAutosavePreference, readLocalDraft, writeAutosavePreference, writeLocalDraft, clearLocalDraft, type PathSelection } from './lib/localDraft';
import { deriveWorkflowState, type MatchFreshness, type ReportFreshness } from './lib/workflow';

const EMPTY_STUDENT: StudentProfile = {
  major: '',
  skills: [],
  certificates: [],
  qualities: [],
  experiences: '',
  intention: { target_job_id: '', city: '' },
  confirmed: false,
  advantages: [],
  improvements: []
};

type TabId = 'jobs' | 'profile' | 'paths' | 'matches';
type WorkflowAnchor = 'report-matrix' | 'report-advice';

const TABS: Array<{ id: TabId; label: string; code: string }> = [
  { id: 'jobs', label: '职业探索', code: '01' },
  { id: 'profile', label: '能力档案', code: '02' },
  { id: 'matches', label: '匹配报告', code: '03' },
  { id: 'paths', label: '成长路径', code: '04' }
];

function tabFromLocation(): TabId {
  const value = window.location.hash.slice(1);
  return TABS.some(item => item.id === value) ? value as TabId : 'jobs';
}

export default function App() {
  const [storage] = useState(getBrowserStorage);
  const [initialPreference] = useState(() => readAutosavePreference(storage));
  const [tab, setTab] = useState<TabId>(tabFromLocation);
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<unknown>(null);
  const [student, setStudent] = useState<StudentProfile>(EMPTY_STUDENT);
  const [resumeName, setResumeName] = useState('');
  const [studentRev, setStudentRev] = useState(0);
  const [analysis, setAnalysis] = useState<ProfileResp['analysis'] | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(initialPreference.enabled);
  const [autosaveChoicePending, setAutosaveChoicePending] = useState(!initialPreference.configured);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState(initialPreference.available ? '正在检查本机草稿…' : '浏览器本机存储不可用；本次数据只保留在内存中。');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<PathSelection | null>(null);
  const [pathFocusRequest, setPathFocusRequest] = useState<{ jobId: string; token: number } | null>(null);
  const [profileFocus, setProfileFocus] = useState<ProfileFocusTarget | null>(null);
  const [matchFreshness, setMatchFreshness] = useState<MatchFreshness>('not_run');
  const [reportFreshness, setReportFreshness] = useState<ReportFreshness>('not_generated');
  const [workflowAnchor, setWorkflowAnchor] = useState<WorkflowAnchor | null>(null);
  const [workflowFocus, setWorkflowFocus] = useState<0 | 1 | 2 | 3 | null>(null);
  const [sessionResetKey, setSessionResetKey] = useState(0);
  const skipNextDraftWrite = useRef(false);
  const autosaveModalRef = useRef<HTMLElement | null>(null);

  // 所有画像修改都经由 applyStudent 同步进 studentRef / revRef：
  // 异步请求（画像生成、简历解析、匹配、报告）返回时用 rev 判断期间是否
  // 发生过编辑，避免旧响应覆盖请求期间的新输入。
  const studentRef = useRef(student);
  const revRef = useRef(0);
  studentRef.current = student;

  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!autosaveChoicePending) return;
    const modal = autosaveModalRef.current;
    if (!modal) return;
    modal.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [autosaveChoicePending]);

  useEffect(() => {
    const syncTabFromHistory = () => {
      const nextTab = tabFromLocation();
      setTab(nextTab);
      setWorkflowFocus(nextTab === 'jobs' ? 0 : nextTab === 'profile' ? 1 : nextTab === 'matches' ? 2 : null);
    };
    window.addEventListener('popstate', syncTabFromHistory);
    return () => window.removeEventListener('popstate', syncTabFromHistory);
  }, []);

  const navigateTo = useCallback((nextTab: TabId) => {
    setWorkflowFocus(nextTab === 'jobs' ? 0 : nextTab === 'profile' ? 1 : nextTab === 'matches' ? 2 : null);
    if (nextTab === tab) return;
    window.history.pushState(null, '', '#' + nextTab);
    setTab(nextTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  const navigateWorkflowStep = useCallback((stepIndex: number) => {
    if (stepIndex === 0) {
      setWorkflowFocus(0);
      setWorkflowAnchor(null);
      navigateTo('jobs');
      return;
    }
    if (stepIndex === 1) {
      setWorkflowFocus(1);
      setWorkflowAnchor(null);
      navigateTo('profile');
      return;
    }

    const anchor: WorkflowAnchor = stepIndex === 2 ? 'report-matrix' : 'report-advice';
    setWorkflowAnchor(anchor);
    if (tab !== 'matches') {
      navigateTo('matches');
    }
    setWorkflowFocus(stepIndex === 2 ? 2 : 3);
  }, [navigateTo, tab]);

  useEffect(() => {
    if (tab !== 'matches' || !workflowAnchor) return;
    const anchor = workflowAnchor;
    let attempts = 0;
    let timer = 0;
    const seek = () => {
      const target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setWorkflowAnchor(null);
        return;
      }
      if (attempts++ >= 60) {
        setWorkflowAnchor(null);
        return;
      }
      timer = window.setTimeout(seek, 100);
    };
    timer = window.setTimeout(seek, 0);
    return () => window.clearTimeout(timer);
  }, [tab, workflowAnchor]);

  const applyStudent = useCallback((next: StudentProfile) => {
    studentRef.current = next;
    revRef.current += 1;
    setStudent(next);
    setStudentRev(revRef.current);
  }, []);

  // 编辑路径：任何字段修改都会撤销整体确认，并清空基于旧输入的 AI 分析
  // 与优势/待提升标签，避免旧结论残留。
  const editStudent = useCallback((fn: (s: StudentProfile) => { next: StudentProfile; notes?: string[] }): string[] => {
    const cur = studentRef.current;
    const r = fn(cur);
    if (r.next === cur) return r.notes ?? [];
    applyStudent({ ...r.next, confirmed: false, advantages: [], improvements: [] });
    setAnalysis(null);
    return r.notes ?? [];
  }, [applyStudent]);

  const updateStudent = useCallback((fn: (s: StudentProfile) => StudentProfile) => {
    editStudent(s => ({ next: fn(s) }));
  }, [editStudent]);

  const replaceStudent = useCallback((s: StudentProfile) => {
    applyStudent(s);
  }, [applyStudent]);

  const restoreLocalDraft = useCallback(() => {
    const result = readLocalDraft(storage);
    if (result.status === 'restored') {
      applyStudent(result.draft.student);
      setTab(result.draft.tab);
      window.history.replaceState(null, '', '#' + result.draft.tab);
      setSelectedPath(result.draft.selectedPath);
      setDraftSavedAt(result.draft.savedAt);
      setDraftStatus('已恢复本机草稿 · ' + new Date(result.draft.savedAt).toLocaleString());
    } else if (result.status === 'invalid') {
      // 保留一次恢复失败提示，避免 hydrated 后的首次自动保存立即把它覆盖。
      skipNextDraftWrite.current = true;
      setDraftSavedAt(null);
      setSelectedPath(null);
      setDraftStatus(result.reason === 'version'
        ? '本机草稿版本不兼容，已从空白会话开始。'
        : '本机草稿损坏，已从空白会话开始。');
    } else if (result.status === 'unavailable') {
      setDraftStatus('浏览器本机存储不可用；本次数据只保留在内存中。');
    } else {
      setDraftSavedAt(null);
      setDraftStatus('尚无本机草稿。');
    }
    setDraftHydrated(true);
  }, [applyStudent, storage]);

  useEffect(() => {
    if (!initialPreference.configured) return;
    if (initialPreference.enabled) {
      restoreLocalDraft();
    } else {
      setDraftStatus('自动保存已关闭；本次不读取旧草稿，可启用恢复或清除本机草稿。');
      setDraftHydrated(true);
    }
  }, [initialPreference.configured, initialPreference.enabled, restoreLocalDraft]);

  useEffect(() => {
    if (autosaveChoicePending || !draftHydrated) return;
    if (skipNextDraftWrite.current) {
      skipNextDraftWrite.current = false;
      return;
    }
    if (!autosaveEnabled) return;
    const draft = createLocalDraft(student, tab, selectedPath);
    if (writeLocalDraft(storage, draft)) {
      setDraftSavedAt(draft.savedAt);
      setDraftStatus('已保存到本机浏览器 · ' + new Date(draft.savedAt).toLocaleString());
    } else {
      setDraftStatus('本机保存失败；当前内容仍保留在本次会话中。');
    }
  }, [autosaveChoicePending, autosaveEnabled, draftHydrated, selectedPath, storage, student, tab]);

  const chooseAutosave = useCallback((enabled: boolean) => {
    const isInitialChoice = autosaveChoicePending;
    const saved = writeAutosavePreference(storage, enabled);
    setAutosaveEnabled(enabled && saved);
    setAutosaveChoicePending(false);
    if (enabled && !saved) setDraftStatus('无法启用本机保存；本次内容仍可继续使用。');
    else if (!storage) setDraftStatus('浏览器本机存储不可用；本次数据只保留在内存中。');
    else if (enabled && isInitialChoice) setDraftStatus('正在检查本机草稿…');
    else if (!enabled) setDraftStatus(isInitialChoice
      ? '自动保存已关闭；本次未读取旧草稿，可稍后启用恢复或清除本机草稿。'
      : '自动保存已关闭；已有草稿仍留在本机，可点击清除。');
    if (isInitialChoice && enabled && saved) restoreLocalDraft();
    else if (isInitialChoice) setDraftHydrated(true);
  }, [autosaveChoicePending, restoreLocalDraft, storage]);

  const clearSessionDraft = useCallback(() => {
    const cleared = clearLocalDraft(storage);
    skipNextDraftWrite.current = true;
    applyStudent(EMPTY_STUDENT);
    setResumeName('');
    setAnalysis(null);
    setSelectedPath(null);
    setProfileFocus(null);
    setMatchFreshness('not_run');
    setReportFreshness('not_generated');
    setWorkflowAnchor(null);
    setWorkflowFocus(0);
    setPathFocusRequest(null);
    setSessionResetKey(value => value + 1);
    setTab('jobs');
    window.history.replaceState(null, '', '#jobs');
    setDraftSavedAt(null);
    setDraftStatus(cleared ? '本机草稿已清除，流程已重置。' : '无法清除本机草稿；本次流程已重置。');
  }, [applyStudent, storage]);

  const confirmProfile = useCallback(() => {
    const current = studentRef.current;
    const confirm = (items: typeof current.skills) => items.map(item => ({ ...item, confirmed: true }));
    applyStudent({
      ...current,
      skills: confirm(current.skills),
      certificates: confirm(current.certificates),
      qualities: confirm(current.qualities),
      confirmed: true
    });
    showToast('画像已确认，可前往「匹配报告」查看匹配');
  }, [applyStudent, showToast]);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await apiGet<HealthResp>('/api/health'));
    } catch {
      // 页面仍可浏览；需要模型的操作会在实际请求时给出具体错误。
    }
  }, []);

  useEffect(() => { void loadHealth(); }, [loadHealth]);
  // 进入匹配页时重新核对服务端版本：后端重启升级后，旧会话结果能立即提示失配。
  useEffect(() => {
    if (tab === 'matches') void loadHealth();
  }, [tab, loadHealth]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const d = await apiGet<{ items: JobSummary[] }>('/api/jobs');
      setJobs(d.items);
    } catch (e) {
      setJobsError(e);
      showToast('岗位加载失败：' + errMessage(e), 'err');
    } finally {
      setJobsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const setTargetJob = useCallback((id: string, name: string) => {
    const current = studentRef.current;
    if (current.intention.target_job_id !== id) {
      applyStudent({ ...current, intention: { ...current.intention, target_job_id: id } });
    }
    showToast('目标岗位已设为 ' + name + '；档案确认保留，旧匹配与报告需要刷新');
    navigateTo('profile');
  }, [applyStudent, navigateTo, showToast]);

  const workflow = deriveWorkflowState({
    targetJobId: student.intention.target_job_id,
    student,
    match: matchFreshness,
    report: reportFreshness
  });
  const workflowSteps = [
    { id: 'jobs' as TabId, label: '目标岗位', state: workflow.target === 'chosen' ? '已选择' : '可跳过' },
    { id: 'profile' as TabId, label: '能力档案', state: workflow.profile === 'ready' ? '已确认' : workflow.profile === 'empty' ? '待填写' : '待确认' },
    { id: 'matches' as TabId, label: '匹配结果', state: workflow.match === 'current' ? '最新' : workflow.match === 'stale' ? '已过期' : workflow.match === 'not_run' ? '待计算' : '待确认档案' },
    { id: 'matches' as TabId, label: '行动建议', state: workflow.report === 'current' ? '已生成' : workflow.report === 'stale' ? '已过期' : workflow.report === 'not_generated' ? '可生成' : '等待最新匹配' }
  ];
  const activeWorkflowStep = workflowFocus ?? (tab === 'jobs' ? 0
    : tab === 'profile' ? 1
    : tab === 'matches' && (reportFreshness === 'current' || reportFreshness === 'stale') ? 3
    : tab === 'matches' ? 2
    : -1);
  const continueLabel = workflow.next === 'profile' ? '继续整理档案' : workflow.next === 'matches'
    ? (matchFreshness === 'stale' ? '刷新匹配结果' : '查看岗位匹配')
    : (reportFreshness === 'stale' ? '更新行动建议' : reportFreshness === 'current' ? '查看行动建议' : '生成行动建议');
  const continueWorkflow = useCallback(() => {
    navigateWorkflowStep(workflow.next === 'profile' ? 1 : workflow.next === 'matches' ? 2 : 3);
  }, [navigateWorkflowStep, workflow.next]);
  const handleAutosaveModalKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div className="exploration-shell">
      <header className={autosaveChoicePending ? 'exploration-header is-blocked' : 'exploration-header'}>
        <nav className="exploration-nav" role="tablist" aria-label="职业探索主导航">
          {TABS.map(t => (
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
        <button className="model-config-trigger" type="button" onClick={() => setConfigOpen(true)}>
          <span aria-hidden="true">✦</span> AI 模型配置
        </button>
      </header>
      {!autosaveChoicePending && <nav className="workflow-guide" aria-label="职业规划流程步骤">
        <ol>{workflowSteps.map((item, index) => <li key={item.label} className={item.state === '已过期' ? 'is-stale' : item.state.startsWith('已') || item.state === '最新' ? 'is-done' : ''}>
          <button
            type="button"
            title={item.label + '：' + item.state}
            aria-label={(index + 1) + '. ' + item.label + '：' + item.state}
            aria-current={activeWorkflowStep === index ? 'step' : undefined}
            onClick={() => navigateWorkflowStep(index)}
          >
            <span className="workflow-step-number" aria-hidden="true">{index + 1}</span>
            <span className="sr-only">{item.label}：{item.state}</span>
          </button>
        </li>)}</ol>
        <button className="workflow-guide-next" type="button" onClick={continueWorkflow} aria-label={'下一步：' + continueLabel} title={continueLabel}>
          <span className="workflow-guide-next-mark" aria-hidden="true">↗</span>
          <span className="workflow-guide-next-copy"><small>下一步</small><b>{continueLabel}</b></span>
        </button>
      </nav>}
      {autosaveChoicePending && <div className="workflow-autosave-backdrop" role="presentation">
        <section
          ref={autosaveModalRef}
          className="workflow-autosave-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-autosave-title"
          aria-describedby="workflow-autosave-description"
          onKeyDown={handleAutosaveModalKeyDown}
        >
          <div className="workflow-autosave-header">
            <p className="workflow-autosave-kicker">FIRST SESSION · 01—04</p>
            <h2 id="workflow-autosave-title">先确认流程与保存方式</h2>
            <p id="workflow-autosave-description">你可以从岗位开始，也可以先建立能力档案。确认后，右侧会保留一个只显示 1、2、3、4 的步骤导航，随时可以跳转；成长路径也可以从主导航进入。</p>
          </div>
          <ol className="workflow-modal-steps" aria-label="职业规划流程">
            {workflowSteps.map((item, index) => <li key={item.label} className={item.state === '已过期' ? 'is-stale' : item.state.startsWith('已') || item.state === '最新' ? 'is-done' : ''}>
              <span className="workflow-modal-step-number" aria-hidden="true">{index + 1}</span>
              <span><b>{item.label}</b><small>{item.state}</small></span>
            </li>)}
          </ol>
          <p className="workflow-modal-next">建议下一步：<strong>{continueLabel}</strong></p>
          <div className="workflow-modal-storage">
            <strong>是否自动保存到本机浏览器？</strong>
            <p>{initialPreference.available
              ? '开启后，能力档案、目标岗位、当前页面和已选成长路径会保存在当前浏览器，直到你清除。简历姓名、未审核的简历候选、原文件、AI 报告和模型密钥不会保存。'
              : '当前浏览器本机存储不可用。你仍可继续使用，数据只保留在本次会话中；自动保存选项暂不可用。'}</p>
          </div>
          <div className="workflow-modal-actions">
            <button className="primary-button" type="button" onClick={() => chooseAutosave(true)} disabled={!initialPreference.available}>继续并自动保存</button>
            <button className="ghost-button" type="button" onClick={() => chooseAutosave(false)}>关闭自动保存并继续</button>
          </div>
        </section>
      </div>}
      {!autosaveChoicePending && <div className="local-draft-bar" aria-label="本机草稿设置">
        <label><input type="checkbox" checked={autosaveEnabled} disabled={!initialPreference.available || autosaveChoicePending} onChange={e => chooseAutosave(e.target.checked)} /> 自动保存到本机浏览器</label>
        <span role="status">{draftStatus}{draftSavedAt ? ' · 最近保存：' + new Date(draftSavedAt).toLocaleString() : ''}</span>
        <button className="ghost-button" type="button" onClick={clearSessionDraft}>清除本机草稿并重置流程</button>
      </div>}
      <main className="exploration-pages" data-active-page={tab}>
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
        <div id="page-profile" className={'panel' + (tab === 'profile' ? ' active' : '')} role="tabpanel" aria-label="能力档案">
          <ProfileTab
            student={student}
            resumeName={resumeName}
            setResumeName={setResumeName}
            updateStudent={updateStudent}
            editStudent={editStudent}
            replaceStudent={replaceStudent}
            confirmProfile={confirmProfile}
            revRef={revRef}
            jobs={jobs}
            analysis={analysis}
            setAnalysis={setAnalysis}
            showToast={showToast}
            onGoMatches={() => navigateTo('matches')}
            onSetTargetJob={setTargetJob}
            focusTarget={profileFocus}
            onFocusHandled={() => setProfileFocus(null)}
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
            onGoProfileFocus={target => { setProfileFocus({ ...target, token: Date.now() }); navigateTo('profile'); }}
            onGoPaths={jobId => {
              if (jobId) setPathFocusRequest({ jobId, token: Date.now() });
              navigateTo('paths');
            }}
            onFreshnessChange={(match, report) => { setMatchFreshness(match); setReportFreshness(report); }}
          />
        </div>
        <div id="page-paths" className={'panel' + (tab === 'paths' ? ' active' : '')} role="tabpanel" aria-label="成长路径">
          <PathsTab active={tab === 'paths'} jobs={jobs} showToast={showToast} targetJobId={student.intention.target_job_id} focusRequest={pathFocusRequest} savedSelection={selectedPath} onSelectionChange={setSelectedPath} onClearSelection={() => setSelectedPath(null)} onSaveSelection={selection => setSelectedPath({ ...selection, targetJobId: student.intention.target_job_id, savedAt: new Date().toISOString() })} />
        </div>
      </main>
      {configOpen && <AIConfigPanel onClose={() => setConfigOpen(false)} onSaved={() => { void loadHealth(); showToast('AI 模型配置已更新'); }} />}
      {toast && <div className={'toast show ' + toast.kind} role="status">{toast.msg}</div>}
    </div>
  );
}
