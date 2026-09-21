import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, errMessage } from './api';
import type { HealthResp, JobSummary, ProfileResp, StudentProfile } from './types';
import JobsTab from './components/JobsTab';
import ProfileTab from './components/ProfileTab';
import MatchesTab from './components/MatchesTab';
import PathsTab from './components/PathsTab';

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

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'jobs', label: '岗位浏览' },
  { id: 'profile', label: '我的能力' },
  { id: 'paths', label: '职业路径' },
  { id: 'matches', label: '匹配与建议' }
];

export default function App() {
  const [tab, setTab] = useState<TabId>('jobs');
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
    showToast('画像已确认，可前往「匹配与建议」查看匹配');
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
    showToast('目标岗位已设为 ' + name + '，到「我的能力」确认画像后即可匹配');
  }, [updateStudent, showToast]);

  const llmNote = health
    ? (health.llm_configured ? '模型 ' + health.llm_model : '模型未配置：画像与建议会提示错误，岗位浏览不受影响')
    : null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          职业罗盘
          <small>CAREER COMPASS · 计算机类岗位</small>
        </div>
        <div className="status" role="status" aria-live="polite">
          <span className={'status-dot' + (health?.status === 'ok' ? ' ok' : '')} />
          <span className="mono">
            {healthError != null
              ? '服务未连接'
              : health
                ? '数据 ' + health.data_version + ' · 算法 ' + health.algorithm_version + ' · ' + (llmNote ?? '')
                : '正在检查服务…'}
          </span>
        </div>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">COMPUTER CAREERS · SAMPLE-BASED</p>
          <h1>看清<em>岗位</em>，<br />也看清自己。</h1>
          <p className="hero-sub">
            岗位画像整理自历史招聘样本，匹配分由程序按标签重合度计算。确认你的技能、证书和素质，得到可执行的学习建议。
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <span className="orbit-ring" />
          <span className="orbit-ring ring-two" />
          <span className="orbit-core">◈<span>6 ROLES · 3 STAGES</span></span>
          <span className="orbit-label label-a"><b>能力基线</b><br />技能 / 证书 / 素质</span>
          <span className="orbit-label label-b"><b>匹配建议</b><br />满足 / 差距 / 待确认</span>
          <span className="orbit-label label-c"><b>路径参考</b><br />晋升 / 换岗</span>
        </div>
      </section>
      <nav className="tabs" role="tablist" aria-label="功能页签">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        <div className={'panel' + (tab === 'jobs' ? ' active' : '')} role="tabpanel" aria-label="岗位浏览">
          <JobsTab
            jobs={jobs}
            loading={jobsLoading}
            error={jobsError}
            onRetry={loadJobs}
            onSetTarget={setTargetJob}
            targetJobId={student.intention.target_job_id}
          />
        </div>
        <div className={'panel' + (tab === 'profile' ? ' active' : '')} role="tabpanel" aria-label="我的能力">
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
            onGoMatches={() => setTab('matches')}
          />
        </div>
        <div className={'panel' + (tab === 'paths' ? ' active' : '')} role="tabpanel" aria-label="职业路径">
          <PathsTab active={tab === 'paths'} jobs={jobs} showToast={showToast} />
        </div>
        <div className={'panel' + (tab === 'matches' ? ' active' : '')} role="tabpanel" aria-label="匹配与建议">
          <MatchesTab
            isActive={tab === 'matches'}
            student={student}
            studentRev={studentRev}
            serverAlgorithm={health?.algorithm_version ?? null}
            serverDataVersion={health?.data_version ?? null}
            showToast={showToast}
            onGoProfile={() => setTab('profile')}
          />
        </div>
      </main>
      {toast && <div className={'toast show ' + toast.kind} role="status">{toast.msg}</div>}
    </div>
  );
}
