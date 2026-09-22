import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, errMessage } from './api';
import type { HealthResp, JobSummary, ProfileResp, StudentProfile } from './types';
import JobsTab from './components/JobsTab';
import ProfileTab from './components/ProfileTab';
import MatchesTab from './components/MatchesTab';
import PathsTab from './components/PathsTab';
import SingularityIntro from './components/SingularityIntro';

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
  const [stage, setStage] = useState<'singularity' | 'exploration'>('singularity');
  const [tab, setTab] = useState<TabId>(tabFromLocation);
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [healthError, setHealthError] = useState<unknown>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<unknown>(null);
  const [student, setStudent] = useState<StudentProfile>(EMPTY_STUDENT);
  const [studentRev, setStudentRev] = useState(0);
  const [analysis, setAnalysis] = useState<ProfileResp['analysis'] | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

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
    const syncTabFromHistory = () => setTab(tabFromLocation());
    window.addEventListener('popstate', syncTabFromHistory);
    return () => window.removeEventListener('popstate', syncTabFromHistory);
  }, []);

  const navigateTo = useCallback((nextTab: TabId) => {
    if (nextTab === tab) return;
    window.history.pushState(null, '', '#' + nextTab);
    setTab(nextTab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

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

  const confirmProfile = useCallback(() => {
    applyStudent({ ...studentRef.current, confirmed: true });
    showToast('画像已确认，可前往「匹配报告」查看匹配');
  }, [applyStudent, showToast]);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await apiGet<HealthResp>('/api/health'));
      setHealthError(null);
    } catch (e) {
      setHealthError(e);
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
    updateStudent(s => ({ ...s, intention: { ...s.intention, target_job_id: id } }));
    showToast('目标岗位已设为 ' + name + '，到「能力档案」确认画像后即可匹配');
  }, [updateStudent, showToast]);

  const llmNote = health
    ? (health.llm_configured ? '模型 ' + health.llm_model : '模型未配置：画像与建议会提示错误，职业探索不受影响')
    : null;

  if (stage === 'singularity') {
    return <SingularityIntro onComplete={() => setStage('exploration')} />;
  }

  return (
    <div className="exploration-shell">
      <header className="exploration-header">
        <button className="exploration-brand" type="button" onClick={() => setStage('singularity')} aria-label="重新进入宇宙奇点首页">
          <span className="exploration-brand-core"><i /></span>
          <span><b>CareerAI</b><small>职业智能探索系统</small></span>
        </button>
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
        <div className="exploration-utility">
          <span className={'exploration-profile-state' + (student.confirmed ? ' confirmed' : '')}>
            {student.confirmed ? '画像已确认' : '画像待确认'}
          </span>
          <div className="exploration-status" role="status" aria-live="polite" title={health ? '数据 ' + health.data_version + ' · 算法 ' + health.algorithm_version + ' · ' + (llmNote ?? '') : undefined}>
            <i className={health?.status === 'ok' ? 'online' : ''} />
            {healthError != null ? '服务未连接' : health ? '系统在线' : '连接中'}
          </div>
        </div>
      </header>
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
          />
        </div>
        <div id="page-matches" className={'panel' + (tab === 'matches' ? ' active' : '')} role="tabpanel" aria-label="匹配报告">
          <MatchesTab
            isActive={tab === 'matches'}
            student={student}
            studentRev={studentRev}
            serverAlgorithm={health?.algorithm_version ?? null}
            serverDataVersion={health?.data_version ?? null}
            showToast={showToast}
            onGoProfile={() => navigateTo('profile')}
          />
        </div>
        <div id="page-paths" className={'panel' + (tab === 'paths' ? ' active' : '')} role="tabpanel" aria-label="成长路径">
          <PathsTab active={tab === 'paths'} jobs={jobs} showToast={showToast} />
        </div>
      </main>
      {toast && <div className={'toast show ' + toast.kind} role="status">{toast.msg}</div>}
    </div>
  );
}
