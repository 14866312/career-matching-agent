import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, errMessage } from '../api';
import type { HealthResp, JobSummary, ProfileFocusTarget, ProfileResp, StudentProfile } from '../types';
import {
  clearLocalDraft,
  createLocalDraft,
  getBrowserStorage,
  readAutosavePreference,
  readLocalDraft,
  writeAutosavePreference,
  writeLocalDraft,
  type PathSelection
} from './localDraft';
import { readOnboardingState, writeOnboardingState } from './onboarding';
import { deriveWorkflowState, type MatchFreshness, type ReportFreshness } from './workflow';

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

export type CareerTab = 'jobs' | 'profile' | 'paths' | 'matches';
type WorkflowAnchor = 'profile-source' | 'profile-report' | 'report-matrix' | 'report-advice';
type WorkflowStep = 0 | 1 | 2 | 3;
type ToastKind = 'ok' | 'err';
type OnboardingOutcome = 'completed' | 'skipped';
type OnboardingStart = 'resume' | 'manual' | 'jobs';

export const CAREER_TABS: Array<{ id: CareerTab; label: string; code: string }> = [
  { id: 'jobs', label: '职业探索', code: '01' },
  { id: 'profile', label: '简历与个人报告', code: '02' },
  { id: 'matches', label: '匹配报告', code: '03' },
  { id: 'paths', label: '成长路径', code: '04' }
];

function workflowStepForTab(tab: CareerTab): WorkflowStep | null {
  if (tab === 'profile') return 0;
  if (tab === 'matches') return 2;
  return null;
}

function tabFromLocation(): CareerTab {
  const value = window.location.hash.slice(1);
  return CAREER_TABS.some(item => item.id === value) ? value as CareerTab : 'jobs';
}

/**
 * Owns the cross-page career-planning session. Components still own their
 * local UI and network effects; this hook only coordinates shared input,
 * draft persistence, freshness, workflow navigation, and session resets.
 */
export function useCareerSession(showToast: (message: string, kind?: ToastKind) => void) {
  const [storage] = useState(getBrowserStorage);
  const [initialPreference] = useState(() => readAutosavePreference(storage));
  const [initialOnboarding] = useState(() => readOnboardingState(storage));
  const [tab, setTab] = useState<CareerTab>(tabFromLocation);
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<unknown>(null);
  const [student, setStudent] = useState<StudentProfile>(EMPTY_STUDENT);
  const [resumeName, setResumeName] = useState('');
  const [studentRev, setStudentRev] = useState(0);
  const [analysis, setAnalysis] = useState<ProfileResp['analysis'] | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(initialPreference.enabled);
  const [autosaveChoicePending, setAutosaveChoicePending] = useState(!initialPreference.configured);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState(initialPreference.available
    ? '正在检查本机草稿…'
    : '浏览器本机存储不可用；本次数据只保留在内存中。');
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<PathSelection | null>(null);
  const [pathFocusRequest, setPathFocusRequest] = useState<{ jobId: string; token: number } | null>(null);
  const [profileFocus, setProfileFocus] = useState<ProfileFocusTarget | null>(null);
  const [matchFreshness, setMatchFreshness] = useState<MatchFreshness>('not_run');
  const [reportFreshness, setReportFreshness] = useState<ReportFreshness>('not_generated');
  const [workflowAnchor, setWorkflowAnchor] = useState<WorkflowAnchor | null>(null);
  const [workflowFocus, setWorkflowFocus] = useState<WorkflowStep | null>(null);
  const [profileSourceModeRequest, setProfileSourceModeRequest] = useState<{
    mode: 'resume' | 'manual'; token: number;
  } | null>(null);
  const [sessionResetKey, setSessionResetKey] = useState(0);
  const skipNextDraftWrite = useRef(false);

  // All profile updates pass through applyStudent so async component requests
  // can compare the revision they started with to the current session state.
  const studentRef = useRef(student);
  const revRef = useRef(0);
  const tabRef = useRef(tab);
  studentRef.current = student;
  tabRef.current = tab;

  useEffect(() => {
    const syncTabFromHistory = () => {
      const nextTab = tabFromLocation();
      tabRef.current = nextTab;
      setTab(nextTab);
      setWorkflowFocus(workflowStepForTab(nextTab));
    };
    window.addEventListener('popstate', syncTabFromHistory);
    return () => window.removeEventListener('popstate', syncTabFromHistory);
  }, []);

  const navigateTo = useCallback((nextTab: CareerTab) => {
    setWorkflowFocus(workflowStepForTab(nextTab));
    if (nextTab === tabRef.current) return;
    tabRef.current = nextTab;
    window.history.pushState(null, '', '#' + nextTab);
    setTab(nextTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigateWorkflowStep = useCallback((stepIndex: number) => {
    const step = stepIndex as WorkflowStep;
    if (step === 0 || step === 1) {
      setWorkflowAnchor(step === 0 ? 'profile-source' : 'profile-report');
      navigateTo('profile');
      setWorkflowFocus(step);
      return;
    }

    const anchor: WorkflowAnchor = step === 2 ? 'report-matrix' : 'report-advice';
    setWorkflowAnchor(anchor);
    navigateTo('matches');
    setWorkflowFocus(step === 2 ? 2 : 3);
  }, [navigateTo]);

  useEffect(() => {
    if (!workflowAnchor || !((tab === 'matches' && workflowAnchor.startsWith('report-')) ||
      (tab === 'profile' && workflowAnchor.startsWith('profile-')))) return;
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

  const editStudent = useCallback((fn: (current: StudentProfile) => {
    next: StudentProfile; notes?: string[];
  }): string[] => {
    const current = studentRef.current;
    const result = fn(current);
    if (result.next === current) return result.notes ?? [];
    applyStudent({ ...result.next, confirmed: false, advantages: [], improvements: [] });
    setAnalysis(null);
    return result.notes ?? [];
  }, [applyStudent]);

  const updateStudent = useCallback((fn: (current: StudentProfile) => StudentProfile) => {
    editStudent(current => ({ next: fn(current) }));
  }, [editStudent]);

  const replaceStudent = useCallback((next: StudentProfile) => {
    applyStudent(next);
  }, [applyStudent]);

  const restoreLocalDraft = useCallback(() => {
    const result = readLocalDraft(storage);
    if (result.status === 'restored') {
      applyStudent(result.draft.student);
      tabRef.current = result.draft.tab;
      setTab(result.draft.tab);
      window.history.replaceState(null, '', '#' + result.draft.tab);
      setSelectedPath(result.draft.selectedPath);
      setDraftSavedAt(result.draft.savedAt);
      setDraftStatus('已恢复本机草稿 · ' + new Date(result.draft.savedAt).toLocaleString());
    } else if (result.status === 'invalid') {
      // Preserve this error through the first hydrated render.
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

  const toggleAutosave = useCallback((enabled: boolean) => {
    const saved = writeAutosavePreference(storage, enabled);
    if (!saved) {
      setAutosaveEnabled(false);
      setDraftStatus('无法更新本机保存设置；当前内容仍保留在本次会话中。');
      return;
    }

    if (enabled) {
      const current = studentRef.current;
      const hasCurrentContent = Boolean(
        current.major.trim() || current.experiences.trim() || current.skills.length ||
        current.certificates.length || current.qualities.length ||
        current.intention.target_job_id || current.intention.city.trim() || selectedPath || tab !== 'jobs'
      );
      const existing = readLocalDraft(storage);
      setAutosaveEnabled(true);
      if (!hasCurrentContent && existing.status === 'restored') {
        restoreLocalDraft();
      } else {
        setDraftStatus('自动保存已开启；从现在开始保存本次流程。');
      }
      return;
    }

    setAutosaveEnabled(false);
    setDraftStatus('自动保存已关闭；已有草稿仍留在本机，可在此清除。');
  }, [restoreLocalDraft, selectedPath, storage, tab]);

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
    setWorkflowFocus(null);
    setPathFocusRequest(null);
    setSessionResetKey(value => value + 1);
    tabRef.current = 'jobs';
    setTab('jobs');
    window.history.replaceState(null, '', '#jobs');
    setDraftSavedAt(null);
    setDraftStatus(cleared ? '本机草稿已清除，流程已重置。' : '无法清除本机草稿；本次流程已重置。');
  }, [applyStudent, storage]);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await apiGet<HealthResp>('/api/health'));
    } catch {
      // The app remains usable; model calls will report their own failure.
    }
  }, []);

  useEffect(() => { void loadHealth(); }, [loadHealth]);
  useEffect(() => {
    if (tab === 'matches') void loadHealth();
  }, [tab, loadHealth]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const result = await apiGet<{ items: JobSummary[] }>('/api/jobs');
      setJobs(result.items);
    } catch (error) {
      setJobsError(error);
      showToast('岗位加载失败：' + errMessage(error), 'err');
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
    showToast('目标岗位已设为 ' + name + '；旧匹配与岗位建议需要刷新');
    navigateTo('profile');
  }, [applyStudent, navigateTo, showToast]);

  const finishOnboarding = useCallback((outcome: OnboardingOutcome, start?: OnboardingStart) => {
    const saved = writeOnboardingState(storage, outcome);
    if (!saved && storage) showToast('新手教程状态保存失败；本次仍可继续使用', 'err');
    if (outcome !== 'completed' || !start) return;
    if (start === 'jobs') {
      navigateTo('jobs');
      return;
    }
    setProfileSourceModeRequest({ mode: start, token: Date.now() });
    navigateTo('profile');
  }, [navigateTo, showToast, storage]);

  const workflow = deriveWorkflowState({
    targetJobId: student.intention.target_job_id,
    student,
    match: matchFreshness,
    report: reportFreshness
  });
  const workflowSteps = [
    { label: '导入或填写资料', state: workflow.profile === 'ready' ? '已填写' : '待填写' },
    { label: '个人分析报告', state: analysis ? '已生成' : workflow.profile === 'ready' ? '可生成' : '待填写资料' },
    { label: '岗位匹配', state: workflow.match === 'current' ? '最新' : workflow.match === 'stale' ? '已过期' : workflow.match === 'not_run' ? '待计算' : '待填写资料' },
    { label: '行动建议', state: workflow.report === 'current' ? '已生成' : workflow.report === 'stale' ? '已过期' : workflow.report === 'not_generated' ? '可生成' : '等待最新匹配' }
  ];
  const activeWorkflowStep = workflowFocus;
  const nextWorkflowStep: WorkflowStep = workflow.profile === 'empty' ? 0
    : !analysis && (activeWorkflowStep === null || activeWorkflowStep === 0) ? 1
      : workflow.match !== 'current' ? 2 : 3;
  const continueLabel = nextWorkflowStep === 0 ? '导入简历或填写资料'
    : nextWorkflowStep === 1 ? '查看个人报告'
      : nextWorkflowStep === 2 ? (matchFreshness === 'stale' ? '刷新岗位匹配' : '查看岗位匹配')
        : (reportFreshness === 'stale' ? '更新行动建议' : '查看行动建议');
  const continueWorkflow = useCallback(() => {
    navigateWorkflowStep(nextWorkflowStep);
  }, [navigateWorkflowStep, nextWorkflowStep]);
  const handleSourceModeRequestHandled = useCallback(() => {
    setProfileSourceModeRequest(null);
  }, []);
  const handleProfileFocusHandled = useCallback(() => {
    setProfileFocus(null);
  }, []);
  const handleFreshnessChange = useCallback((match: MatchFreshness, report: ReportFreshness) => {
    setMatchFreshness(match);
    setReportFreshness(report);
  }, []);
  const goProfileFocus = useCallback((target: Omit<ProfileFocusTarget, 'token'>) => {
    setProfileFocus({ ...target, token: Date.now() });
    navigateTo('profile');
  }, [navigateTo]);
  const changePathSelection = useCallback((selection: PathSelection) => {
    setSelectedPath(selection);
  }, []);
  const clearPathSelection = useCallback(() => {
    setSelectedPath(null);
  }, []);
  const savePathSelection = useCallback((selection: PathSelection) => {
    setSelectedPath({
      ...selection,
      targetJobId: studentRef.current.intention.target_job_id,
      savedAt: new Date().toISOString()
    });
  }, []);

  return {
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
    sourceModeRequest: profileSourceModeRequest,
    onSourceModeRequestHandled: handleSourceModeRequestHandled,
    profileFocus,
    onProfileFocusHandled: handleProfileFocusHandled,
    goProfileFocus,
    matchFreshness,
    reportFreshness,
    onFreshnessChange: handleFreshnessChange,
    sessionResetKey,
    selectedPath,
    pathFocusRequest,
    onPathSelectionChange: changePathSelection,
    onClearPathSelection: clearPathSelection,
    onSavePathSelection: savePathSelection,
    autosaveEnabled,
    autosaveChoicePending,
    autosaveAvailable: initialPreference.available,
    draftStatus,
    draftSavedAt,
    chooseAutosave,
    toggleAutosave,
    clearSessionDraft,
    onboardingRequired: initialOnboarding.status !== 'stored' || !initialPreference.configured,
    finishOnboarding
  };
}
