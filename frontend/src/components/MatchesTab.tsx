import { useEffect, useRef, useState } from 'react';
import { apiPost, errMessage } from '../api';
import type { Filters, MatchItem, MatchResult, ProfileFocusTarget, Recommendation, ReportResp, StudentProfile } from '../types';
import { fmtNum, fmtPct, todayStamp } from '../format';
import { filtersSummary, parseFilters } from '../lib/filters';
import { getReportText, reportFileName } from '../report';
import { isReportStale, type ReportMeta } from '../lib/stale';
import { EmptyState, ErrorBox, Loading } from './ui';
import { hasProfileContent } from '../lib/workflow';

function statusOrder(item: MatchItem): number {
  return item.status === 'satisfied' ? 1 : 0;
}

function ReportBlock({ report, stale, staleMessage, onCopy, onExport, copyState }: {
  report: ReportResp;
  stale: boolean;
  staleMessage: string;
  onCopy: () => void;
  onExport: () => void;
  copyState: string;
}) {
  return (
    <div className="report">
      {stale && (
        <div className="stale-banner" role="status">
          {staleMessage}
        </div>
      )}
      <div className="item-block">
        <h4>契合度评价</h4>
        <p>{report.advice.fit_evaluation}</p>
      </div>
      <div className="item-block">
        <h4>学习方向</h4>
        {report.advice.learning_directions.map((x, i) => <div className="item" key={i}>→ {x}</div>)}
      </div>
      <div className="item-block">
        <h4>学习建议</h4>
        {report.advice.learning_steps.map((x, i) => <div className="item" key={i}>→ {x}</div>)}
      </div>
      <div className="detail-actions">
        <button className="ghost-button" type="button" disabled={stale} aria-label="复制报告" onClick={onCopy}>{copyState || '复制报告'}</button>
        <button className="ghost-button" type="button" disabled={stale} aria-label="导出报告TXT" onClick={onExport}>导出 TXT</button>
      </div>
      <p className="soft-note">{report.notice}</p>
    </div>
  );
}

export default function MatchesTab({ isActive, student, studentRev, serverAlgorithm, serverDataVersion, showToast, onGoProfile, onGoProfileFocus, onFreshnessChange }: {
  isActive: boolean;
  student: StudentProfile;
  studentRev: number;
  serverAlgorithm: string | null;
  serverDataVersion: string | null;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
  onGoProfile: () => void;
  onGoProfileFocus: (target: Omit<ProfileFocusTarget, 'token'>) => void;
  onFreshnessChange: (match: 'not_run' | 'current' | 'stale', report: 'not_generated' | 'current' | 'stale') => void;
}) {
  const [city, setCity] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryPeriod, setSalaryPeriod] = useState<Filters['salary_period']>('month');
  const [skillText, setSkillText] = useState('');
  const [sortBy, setSortBy] = useState<'basic' | 'enhanced'>('basic');
  const [items, setItems] = useState<Recommendation[]>([]);
  const [meta, setMeta] = useState<{ count: number; note: string; summary: string; rev: number; targetJobId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [report, setReport] = useState<ReportResp | null>(null);
  const [reportMeta, setReportMeta] = useState<ReportMeta | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<unknown>(null);
  const [copyState, setCopyState] = useState('');

  // 最新值引用：异步请求返回时用 rev / active 判断期间是否发生变化，
  // 防止旧响应覆盖请求期间的新输入或新选择。
  const revRef = useRef(studentRev);
  const studentRef = useRef(student);
  revRef.current = studentRev;
  studentRef.current = student;

  const active = items[activeIndex] ?? null;
  const activeRef = useRef<Recommendation | null>(active);
  activeRef.current = active;

  const hasProfile = hasProfileContent(student);
  const m = active?.match;
  const versionStale = m != null && (
    (serverAlgorithm != null && m.algorithm_version !== serverAlgorithm) ||
    (serverDataVersion != null && m.data_version !== serverDataVersion)
  );
  const matchesStale = meta != null && meta.rev !== studentRev;
  const resultsStale = matchesStale || versionStale;
  const reportStale =
    isReportStale(reportMeta, studentRev, active?.job_id ?? null, active?.match.input_version ?? null) ||
    versionStale;
  const reportDisabled = reportLoading || resultsStale || !hasProfile || !active;
  const reportStaleMessage = versionStale
    ? '服务端算法或岗位数据版本已更新；请刷新匹配结果，再生成新建议。'
    : resultsStale
      ? (meta && meta.targetJobId !== student.intention.target_job_id
        ? '目标岗位已切换；请刷新匹配结果，再生成新建议。'
        : '简历或资料已变化；请刷新匹配结果，再生成新建议。')
      : '当前报告对应的岗位或输入已变化；请刷新匹配结果并生成新建议。';
  const workflowMatch = meta == null ? 'not_run' : resultsStale ? 'stale' : 'current';
  const workflowReport = !report ? 'not_generated' : reportStale ? 'stale' : 'current';

  useEffect(() => {
    onFreshnessChange(workflowMatch, workflowReport);
  }, [onFreshnessChange, workflowMatch, workflowReport]);

  useEffect(() => {
    // 首次进入匹配页自动计算一次；学生信息编辑造成的过期不自动重算，
    // 由失效横幅提示用户手动刷新，避免连续输入触发请求风暴。
    if (isActive && hasProfile && !loading && meta == null) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, hasProfile]);

  async function load() {
    if (!hasProfileContent(studentRef.current)) return;
    const parsed = parseFilters(city, salaryMin, salaryMax, salaryPeriod, skillText);
    if (!parsed.ok) {
      setFilterError(parsed.error ?? '筛选条件无效');
      return;
    }
    setFilterError(null);
    const reqStudent = studentRef.current;
    const reqRev = revRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await apiPost<{ items: Recommendation[]; candidate_count: number; sort_by: string; note: string }>(
        '/api/recommendations',
        { student: reqStudent, filters: parsed.filters, sort_by: sortBy }
      );
      if (revRef.current !== reqRev) {
        showToast('输入在计算期间已修改，本次推荐已丢弃，请重新计算', 'err');
        return;
      }
      const merged = [...d.items];
      // 目标岗位可能不在推荐前5：单独调用 /api/matches，保证目标岗位始终可查看比较。
      const tid = reqStudent.intention.target_job_id;
      if (tid && !merged.some(x => x.job_id === tid)) {
        try {
          const t = await apiPost<MatchResult>('/api/matches', { student: reqStudent, job_id: tid });
          if (revRef.current !== reqRev) {
            showToast('输入在计算期间已修改，本次推荐已丢弃，请重新计算', 'err');
            return;
          }
          merged.unshift({
            job_id: t.job_id,
            job_name: t.job_name,
            match: t,
            reason: '这是你的意向目标岗位，已按当前资料单独计算。',
            samples: [],
            matching_sample_count: 0,
            standalone: true
          });
        } catch (targetErr) {
          showToast('目标岗位单独计算失败：' + errMessage(targetErr), 'err');
        }
      }
      setItems(merged);
      setActiveIndex(merged.length > 0 ? 0 : -1);
      setMeta({ count: d.candidate_count, note: d.note, summary: filtersSummary(parsed.filters!), rev: reqRev, targetJobId: reqStudent.intention.target_job_id });
      setReport(null);
      setReportMeta(null);
      setReportError(null);
    } catch (e) {
      setLoadError(e);
      showToast('推荐计算失败：' + errMessage(e), 'err');
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    const job = activeRef.current;
    if (!job) return;
    if (reportLoading) return;
    // ErrorBox 的重试也直接调用本函数：内部重新校验，防止绕过按钮的禁用门槛。
    if (!hasProfileContent(studentRef.current)) {
      setReportError(null);
      showToast('请先导入简历或填写资料，再生成岗位建议', 'err');
      return;
    }
    if (resultsStale) {
      setReportError(null);
      showToast('结果已失效，请先点击「刷新推荐」再生成建议', 'err');
      return;
    }
    const reqRev = revRef.current;
    const reqJobId = job.job_id;
    setReportError(null);
    setReportLoading(true);
    try {
      const d = await apiPost<ReportResp>('/api/reports', { student: studentRef.current, job_id: reqJobId });
      if (revRef.current !== reqRev || activeRef.current?.job_id !== reqJobId) {
        showToast('输入或目标岗位在生成期间已变化，本次报告已丢弃，请重新生成', 'err');
        return;
      }
      setReport(d);
      setReportMeta({ studentRev: reqRev, jobId: reqJobId, inputVersion: d.input_version });
      showToast('职业建议已生成');
    } catch (e) {
      setReportError(e);
      showToast('建议生成失败：' + errMessage(e), 'err');
    } finally {
      setReportLoading(false);
    }
  }

  async function copyReport() {
    if (!report) return;
    if (reportStale || resultsStale) {
      showToast('报告已过期，刷新匹配并重新生成后才能复制', 'err');
      return;
    }
    const text = getReportText(report);
    if (!text) {
      const msg = '复制失败：报告文本缺失，请重新生成';
      setCopyState(msg);
      showToast(msg, 'err');
      return;
    }
    const done = (ok: boolean) => {
      const msg = ok ? '已复制到剪贴板 ✓' : '复制失败，请手动选择文本复制';
      setCopyState(msg);
      showToast(msg, ok ? 'ok' : 'err');
      setTimeout(() => setCopyState(''), 2400);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        done(true);
      } else {
        done(fallbackCopy(text));
      }
    } catch {
      try {
        done(fallbackCopy(text));
      } catch {
        done(false);
      }
    }
  }

  function exportReport() {
    if (!report) return;
    if (reportStale || resultsStale) {
      showToast('报告已过期，刷新匹配并重新生成后才能导出', 'err');
      return;
    }
    const text = getReportText(report);
    if (!text) {
      showToast('导出失败：报告文本缺失，请重新生成', 'err');
      return;
    }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportFileName(report.job_name).replace('.txt', '-' + todayStamp() + '.txt');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('已导出 TXT 文件（与服务端报告原文一致）');
    } catch (e) {
      showToast('导出失败：' + errMessage(e), 'err');
    }
  }

  function focusProfileItem(item: MatchItem) {
    onGoProfileFocus({ dimension: item.dimension, tag_id: item.tag_id, label: item.label, reason: 'not_provided' });
  }

  if (!hasProfile && meta == null && !loading && loadError == null) {
    return (
      <div className="matches-stitch matches-stitch-empty">
        <div className="matches-stitch-hero"><h2 className="empty-title">岗位匹配</h2></div>
        <div className="match-empty-card"><EmptyState symbol="↗" title="先导入简历或填写资料"><p>补充专业、经历或技能后，这里会展示岗位推荐。无需先选择目标岗位。</p><button className="ghost-button" type="button" onClick={onGoProfile}>去整理资料</button></EmptyState></div>
      </div>
    );
  }

  return (
    <div className="matches-stitch">
      <section className="matches-stitch-hero">
        <h2>{m?.basic == null ? '—' : fmtNum(m.basic)}<small>/ 100</small></h2>
        <h3>{m?.job_name || '正在计算目标岗位'}</h3>
        <div className="matches-hero-actions"><button className="primary-button" type="button" onClick={generateReport} disabled={reportDisabled}>{reportLoading ? '正在生成…' : '生成岗位建议'}</button><button className="ghost-button" type="button" onClick={load} disabled={loading}>刷新匹配结果</button></div>
      </section>
      <main className="match-report-flow">
        <details className="match-filter-panel"><summary>调整岗位筛选条件 <span>{meta?.summary || '全部岗位'}</span></summary><div className="matches-stitch-filter"><label>城市<input value={city} maxLength={80} placeholder="不限" onChange={e => setCity(e.target.value)} /></label><label>薪资下限<input value={salaryMin} type="number" min={0} step={100} placeholder="如 5000" onChange={e => setSalaryMin(e.target.value)} /></label><label>薪资上限<input value={salaryMax} type="number" min={0} step={100} placeholder="如 12000" onChange={e => setSalaryMax(e.target.value)} /></label><label>计薪周期<select value={salaryPeriod} onChange={e => setSalaryPeriod(e.target.value as Filters['salary_period'])}><option value="month">按月</option><option value="day">按天</option></select></label><label>必须包含技能<input value={skillText} maxLength={200} placeholder="Java, MySQL" onChange={e => setSkillText(e.target.value)} /></label><label>排序<select value={sortBy} onChange={e => setSortBy(e.target.value as 'basic' | 'enhanced')}><option value="basic">按基础分</option><option value="enhanced">按增强分</option></select></label><button className="primary-button" type="button" onClick={load}>应用筛选</button></div></details>
        {filterError && <div className="error-box"><p>{filterError}</p></div>}
        {matchesStale && <div className="stale-banner">{meta && meta.targetJobId !== student.intention.target_job_id ? '目标岗位已切换；旧匹配与建议已过期，请刷新匹配结果。' : '简历或资料已变化；旧匹配与建议已过期，请刷新匹配结果。'}</div>}{versionStale && <div className="stale-banner">服务端算法或岗位数据版本已更新，旧匹配与建议已过期，请刷新匹配结果。</div>}
        {loading ? <Loading text="正在计算推荐…" /> : loadError != null ? <ErrorBox error={loadError} onRetry={load} retryLabel="重新计算推荐" /> : !m ? <EmptyState symbol="◌" title="暂时没有符合条件的岗位"><p>{meta?.note || '请调整筛选条件后重试。'}</p></EmptyState> : <>
          <section className="report-section report-diagnosis"><header><p>ACT 01 · 双维匹配诊断</p><h2>岗位匹配概览</h2><span>只根据当前资料计算，未提及不代表不具备</span></header><div className="diagnosis-grid"><article><span>BASE FIT INDEX</span><em>基础匹配度</em><strong>{fmtPct(m.basic)}</strong><p>统计当前资料中提及的岗位要求，不推断熟练度。</p><i><b style={{ width: Math.min(100, m.basic ?? 0) + '%' }} /></i></article><article><span>ENHANCED MATCH</span><em>增强匹配度</em><strong>{fmtPct(m.enhanced)}</strong><p>考虑相关技能提供的基础，不代表已掌握全部岗位技能。</p><i><b style={{ width: Math.min(100, m.enhanced ?? 0) + '%' }} /></i></article></div><div className="diagnosis-facts"><div><b>{m.satisfied}</b><span>资料已提及</span></div><div><b>{m.pending_items.length}</b><span>资料未提及</span></div><div><b>{m.required}</b><span>岗位要求总数</span></div></div></section>
          <section className="report-section report-capability-summary"><header><p>ACT 02 · 能力摘要</p><h2>技能与岗位维度</h2><span>仅展示当前资料中已提及的内容；未提及不代表不具备</span></header><div className="capability-summary-grid">{m.dimensions.map(d => <article key={d.id}><span>{d.label}</span><strong>{d.required === 0 ? '不适用' : d.satisfied + ' / ' + d.required}</strong><p>{d.required === 0 ? '该岗位没有设置此类要求。' : d.satisfied + ' 项要求在当前资料中出现，' + (d.required - d.satisfied) + ' 项可以按实际情况补充。'}</p></article>)}</div></section>
          <section className="report-section report-matrix" id="report-matrix"><header><p>ACT 03 · REQUIREMENTS</p><h2>岗位要求与当前资料</h2><span>按岗位必需项优先；简历未提及的能力可按实际情况补充</span></header><div className="matrix-list">{[...m.items].sort((a, b) => Number(a.related_only) - Number(b.related_only) || statusOrder(a) - statusOrder(b)).map(x => <div className={'matrix-row ' + (x.status === 'satisfied' ? 'satisfied' : 'pending')} key={x.dimension + x.tag_id}><b aria-hidden="true">{x.status === 'satisfied' ? '✓' : '○'}</b><div><strong>{x.label}</strong><small>{x.dimension}{x.enhancement_basis ? ' · ' + x.enhancement_basis : ''}</small></div>{x.status === 'satisfied' ? <em>资料中已出现</em> : <button type="button" className="matrix-action" onClick={() => focusProfileItem(x)}>补充资料 →</button>}</div>)}</div></section>
          <section className="report-section report-advice" id="report-advice"><header><p>ACT 04 · INTELLIGENCE ROADMAP</p><h2>AI 智能体建议与行动路径</h2><span>建议只作为职业决策辅助，最终以你的实际经历为准</span></header>{reportError != null && <ErrorBox error={reportError} onRetry={generateReport} retryLabel="重试生成" />}{report ? <ReportBlock report={report} stale={reportStale} staleMessage={reportStaleMessage} onCopy={copyReport} onExport={exportReport} copyState={copyState} /> : <div className="advice-placeholder"><div><b>01</b><h3>生成契合度评价</h3><p>结合当前资料与岗位要求，生成针对目标岗位的判断。</p></div><div><b>02</b><h3>拆解学习方向</h3><p>把岗位要求转换为可开始执行的学习主题与实战任务。</p></div><div><b>03</b><h3>建立成长步骤</h3><p>按优先级排列后续行动，并保留报告导出能力。</p></div></div>}</section>
          <section className="report-section report-alternatives"><header><p>ACT 05 · 协同备选</p><h2>其他高匹配岗位</h2><span>{meta ? '共 ' + meta.count + ' 个岗位符合 · ' + meta.note : '选择岗位可切换整份报告'}</span></header><div className="alternative-grid">{items.map((x, i) => <button type="button" className={i === activeIndex ? 'active' : ''} key={x.job_id} onClick={() => { setActiveIndex(i); setReport(null); setReportMeta(null); setReportError(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>{String(i + 1).padStart(2, '0')}</span><h3>{x.job_name}</h3><strong>{fmtPct(x.match.basic)}</strong><p>{x.reason}</p></button>)}</div></section>
        </>}
      </main>
    </div>
  );
}

function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
