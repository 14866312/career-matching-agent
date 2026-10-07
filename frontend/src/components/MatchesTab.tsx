import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { apiPost, errMessage } from '../api';
import type { Filters, MatchItem, MatchResult, ProfileFocusTarget, Recommendation, ReportResp, StudentProfile } from '../types';
import { fmtNum, fmtPct, todayStamp } from '../format';
import { filtersSummary, parseFilters } from '../lib/filters';
import { getReportText, reportFileName } from '../report';
import { isReportStale, type ReportMeta } from '../lib/stale';
import { EmptyState, ErrorBox, Loading } from './ui';
import { hasProfileContent } from '../lib/workflow';
import { createLatestRequest } from '../lib/latestRequest';

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
        <h3>契合度评价</h3>
        <p>{report.advice.fit_evaluation}</p>
      </div>
      <div className="item-block">
        <h3>学习方向</h3>
        {report.advice.learning_directions.map((x, i) => <div className="item" key={i}>→ {x}</div>)}
      </div>
      <div className="item-block">
        <h3>学习建议</h3>
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
  const filterPanelRef = useRef<HTMLDetailsElement>(null);
  const cityInputRef = useRef<HTMLInputElement>(null);

  // 最新值引用：异步请求返回时用 rev / active 判断期间是否发生变化，
  // 防止旧响应覆盖请求期间的新输入或新选择。
  const revRef = useRef(studentRev);
  const studentRef = useRef(student);
  const [recommendationRequests] = useState(createLatestRequest);
  const recommendationControllerRef = useRef<AbortController | null>(null);
  revRef.current = studentRev;
  studentRef.current = student;

  const cancelActiveRecommendation = useCallback(() => {
    const controller = recommendationControllerRef.current;
    recommendationControllerRef.current = null;
    controller?.abort();
  }, []);

  const invalidateRecommendations = useCallback(() => {
    recommendationRequests.begin();
    cancelActiveRecommendation();
    setLoading(false);
  }, [cancelActiveRecommendation, recommendationRequests]);

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
  const resultStatus = loading ? '正在更新' : !hasProfile ? '待填写资料' : resultsStale ? '结果已过期' : loadError != null ? '本次计算失败' : m ? '匹配结果最新' : '暂无匹配结果';
  const nextAction = loading
    ? '正在按当前资料计算。你仍可调整筛选，最后一次提交决定结果。'
    : !hasProfile
      ? '当前资料为空，请先补充资料，再重新匹配。'
      : resultsStale
        ? '先更新匹配结果，再生成岗位建议；下方保留的是旧结果。'
        : loadError != null
          ? '本次计算未完成。请重试，或检查筛选条件后重新应用。'
          : !m
            ? '放宽城市、薪资或技能条件，再应用筛选。'
            : report && !reportStale
              ? '岗位建议已生成，可查看学习步骤、复制或导出报告。'
              : '查看岗位要求，按实际情况补充未提及项，或生成当前岗位建议。';

  useEffect(() => {
    onFreshnessChange(workflowMatch, workflowReport);
  }, [onFreshnessChange, workflowMatch, workflowReport]);

  useEffect(() => {
    invalidateRecommendations();
  }, [invalidateRecommendations, studentRev]);

  useEffect(() => {
    if (!isActive) invalidateRecommendations();
  }, [invalidateRecommendations, isActive]);

  useEffect(() => () => {
    recommendationRequests.begin();
    cancelActiveRecommendation();
  }, [cancelActiveRecommendation, recommendationRequests]);

  useEffect(() => {
    // 首次进入匹配页自动计算一次；学生信息编辑造成的过期不自动重算，
    // 由失效横幅提示用户手动刷新，避免连续输入触发请求风暴。
    if (isActive && hasProfile && !loading && meta == null) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, hasProfile]);

  async function load() {
    const requestId = recommendationRequests.begin();
    cancelActiveRecommendation();
    const isLatestRequest = () => recommendationRequests.isLatest(requestId);
    if (!hasProfileContent(studentRef.current)) {
      if (isLatestRequest()) setLoading(false);
      return;
    }
    const parsed = parseFilters(city, salaryMin, salaryMax, salaryPeriod, skillText);
    if (!parsed.ok) {
      const message = parsed.error ?? '筛选条件无效';
      if (!isLatestRequest()) return;
      setLoading(false);
      setLoadError(null);
      setFilterError(message);
      showToast(message, 'err');
      return;
    }
    setFilterError(null);
    const reqStudent = studentRef.current;
    const reqRev = revRef.current;
    const reqFilters = parsed.filters!;
    const reqSortBy = sortBy;
    const reqTargetJobId = reqStudent.intention.target_job_id;
    const controller = new AbortController();
    recommendationControllerRef.current = controller;
    const inputChanged = () => revRef.current !== reqRev;
    const requestIsCurrent = () => {
      if (!isLatestRequest() || controller.signal.aborted) return false;
      if (!inputChanged()) return true;
      invalidateRecommendations();
      return false;
    };
    setLoading(true);
    setLoadError(null);
    try {
      const d = await apiPost<{ items: Recommendation[]; candidate_count: number; sort_by: string; note: string }>(
        '/api/recommendations',
        { student: reqStudent, filters: reqFilters, sort_by: reqSortBy },
        { signal: controller.signal }
      );
      if (!requestIsCurrent()) return;
      const merged = [...d.items];
      // 目标岗位可能不在推荐前5：单独调用 /api/matches，保证目标岗位始终可查看比较。
      if (reqTargetJobId && !merged.some(x => x.job_id === reqTargetJobId)) {
        try {
          const t = await apiPost<MatchResult>(
            '/api/matches',
            { student: reqStudent, job_id: reqTargetJobId },
            { signal: controller.signal }
          );
          if (!requestIsCurrent()) return;
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
          if (!requestIsCurrent()) return;
          showToast('目标岗位单独计算失败：' + errMessage(targetErr), 'err');
        }
      }
      if (!requestIsCurrent()) return;
      setItems(merged);
      setActiveIndex(merged.length > 0 ? 0 : -1);
      setMeta({ count: d.candidate_count, note: d.note, summary: filtersSummary(reqFilters), rev: reqRev, targetJobId: reqTargetJobId });
      setReport(null);
      setReportMeta(null);
      setReportError(null);
    } catch (e) {
      if (!requestIsCurrent()) return;
      setLoadError(e);
      showToast('推荐计算失败：' + errMessage(e), 'err');
    } finally {
      if (isLatestRequest()) {
        if (recommendationControllerRef.current === controller) recommendationControllerRef.current = null;
        setLoading(false);
      }
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

  function openFilters() {
    if (filterPanelRef.current) filterPanelRef.current.open = true;
    cityInputRef.current?.focus();
  }

  function scrollToReportSection(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const section = document.getElementById(event.currentTarget.hash.slice(1));
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
  }

  if (!hasProfile && meta == null && !loading && loadError == null) {
    return (
      <div className="matches-stitch matches-stitch-empty">
        <div className="matches-stitch-hero"><h2 className="empty-title">岗位匹配</h2></div>
        <div className="match-empty-card"><EmptyState symbol="↗" title="先导入简历或填写资料"><p>填写专业、经历或技能，即可匹配岗位。</p><button className="ghost-button" type="button" onClick={onGoProfile}>去整理资料</button></EmptyState></div>
      </div>
    );
  }

  return (
    <div className="matches-stitch">
      <section className="matches-stitch-hero matches-overview" aria-label="岗位匹配概览">
        <div className="match-overview-heading">
          <div><p className="match-overview-kicker">岗位匹配概览</p><h2>{m?.job_name || (loading ? '正在计算岗位匹配' : '尚无可查看的岗位')}</h2></div>
          <span className={'match-result-status' + (resultsStale ? ' is-stale' : '')}>{resultStatus}</span>
        </div>
        <dl className="match-overview-stats">
          <div className="match-basic-stat"><dt>基础匹配分</dt><dd><strong>{m?.basic == null ? '—' : fmtNum(m.basic)}</strong><small> / 100</small><p>{m ? (m.required > 0 ? `必需项中，资料已提及 ${m.satisfied}／${m.required} 项` : '该岗位未设置必需项，基础匹配分不适用。') : '有匹配结果后展示资料提及比例。'}</p>{m && m.required > 0 && <progress className="match-coverage" value={m.satisfied} max={m.required} aria-label="必需项资料提及比例" aria-valuetext={`资料已提及 ${m.satisfied} 项，共 ${m.required} 项`} />}<p className="match-score-note">仅按精确提及计入；未提及不代表不具备。</p><div className="match-coverage-actions">{m && <a href="#report-matrix" onClick={scrollToReportSection}>查看匹配依据</a>}<button className="ghost-button" type="button" onClick={onGoProfile}>补充资料</button></div></dd></div>
          <div className="match-secondary-stat"><dt>资料未提及</dt><dd><strong>{m ? m.pending_items.length : '—'}</strong><small>{m ? ' 项 / 共 ' + m.required + ' 项' : ' 项'}</small><p>可按实际经历补充，提及内容未经外部验证。</p></dd></div>
          <div className="match-secondary-stat match-enhanced-stat"><dt>增强匹配分 · 辅助参考</dt><dd><strong>{m?.enhanced == null ? '—' : fmtNum(m.enhanced)}</strong><small> / 100</small><p>计入相关技能的有限贡献，优先项不计分。</p></dd></div>
        </dl>
        <p className="match-next-action"><b>下一步</b>{nextAction}</p>
        <div className="matches-hero-actions"><button className="primary-button" type="button" onClick={generateReport} disabled={reportDisabled}>{reportLoading ? '正在生成…' : '生成岗位建议'}</button><button className="ghost-button" type="button" onClick={load} disabled={loading}>刷新匹配结果</button></div>
      </section>
      <div className="match-report-flow">
        <details ref={filterPanelRef} className="match-filter-panel"><summary>筛选岗位 <span>{meta?.summary || '全部岗位'}</span></summary><div className="matches-stitch-filter"><label>城市<input ref={cityInputRef} value={city} maxLength={80} placeholder="不限" onChange={e => setCity(e.target.value)} /></label><label>薪资下限<input value={salaryMin} type="number" min={0} step={100} placeholder="如 5000" onChange={e => setSalaryMin(e.target.value)} /></label><label>薪资上限<input value={salaryMax} type="number" min={0} step={100} placeholder="如 12000" onChange={e => setSalaryMax(e.target.value)} /></label><label>计薪周期<select value={salaryPeriod} onChange={e => setSalaryPeriod(e.target.value as Filters['salary_period'])}><option value="month">按月</option><option value="day">按天</option></select></label><label>必须包含技能<input value={skillText} maxLength={200} placeholder="Java, MySQL" onChange={e => setSkillText(e.target.value)} /></label><label>排序<select value={sortBy} onChange={e => setSortBy(e.target.value as 'basic' | 'enhanced')}><option value="basic">按基础分</option><option value="enhanced">按增强分</option></select></label><button className="primary-button" type="button" onClick={load}>应用筛选</button></div></details>
        {filterError && <div className="error-box" role="alert"><p>{filterError}</p><button className="ghost-button" type="button" onClick={openFilters}>修改筛选条件</button></div>}
        {resultsStale && <div className="stale-banner match-stale-action" role="status"><p>{versionStale ? '岗位数据或算法已更新，请刷新匹配。' : meta && meta.targetJobId !== student.intention.target_job_id ? '目标岗位已切换，请刷新匹配。' : '资料已修改，请刷新匹配。'}</p>{hasProfile ? <button className="ghost-button" type="button" onClick={load} disabled={loading}>更新过期结果</button> : <button className="ghost-button" type="button" onClick={onGoProfile}>补充资料后再匹配</button>}</div>}
        {loading ? <div className="match-loading"><Loading text="正在计算推荐…" /><p>计算中，可继续调整筛选。</p></div> : loadError != null ? <div className="match-load-error"><ErrorBox error={loadError} onRetry={load} retryLabel="重新计算推荐" /><p>筛选条件仍保留，请检查条件或重试计算。</p><button className="ghost-button" type="button" onClick={openFilters}>检查筛选条件</button></div> : !m ? <EmptyState symbol="◌" title="暂时没有符合条件的岗位"><p>{meta?.note || '请调整筛选条件后重试。'}</p><p>可先移除城市或技能限制，放宽薪资范围。</p><button className="ghost-button" type="button" onClick={openFilters}>调整筛选条件</button></EmptyState> : <>
          <section className="report-section report-alternatives"><header><p>01 · 候选岗位</p><h2>候选岗位</h2><span>{meta ? '共 ' + meta.count + ' 个岗位符合 · ' + meta.note : '选择岗位可切换整份报告'}</span></header><div className="alternative-grid">{items.map((x, i) => <button type="button" className={i === activeIndex ? 'active' : ''} aria-pressed={i === activeIndex} key={x.job_id} onClick={() => { setActiveIndex(i); setReport(null); setReportMeta(null); setReportError(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>{String(i + 1).padStart(2, '0')}{i === activeIndex ? ' · 当前岗位' : ''}</span><h3>{x.job_name}</h3><strong>基础 {fmtPct(x.match.basic)}</strong><p>{x.reason}</p></button>)}</div></section>
          <nav className="match-contents" aria-label="匹配报告目录"><span>继续查看</span><a href="#report-dimensions" onClick={scrollToReportSection}>能力摘要</a><a href="#report-matrix" onClick={scrollToReportSection}>岗位要求</a><a href="#report-advice" onClick={scrollToReportSection}>岗位建议</a></nav>
          <section className="report-section report-capability-summary" id="report-dimensions" tabIndex={-1}><header><p>02 · 能力摘要</p><h2>能力概览</h2><span>未提及不代表不具备</span></header><div className="capability-summary-grid">{m.dimensions.map(d => <article key={d.id}><span>{d.label}</span><strong>{d.required === 0 ? '不适用' : d.satisfied + ' / ' + d.required}</strong><p>{d.required === 0 ? '该岗位没有设置此类要求。' : d.satisfied + ' 项要求在当前资料中出现，' + (d.required - d.satisfied) + ' 项可以按实际情况补充。'}</p></article>)}</div></section>
          <section className="report-section report-matrix" id="report-matrix" tabIndex={-1}><header><p>03 · 岗位要求</p><h2>岗位要求</h2><span>按实际经历补充未提及项</span></header><div className="matrix-list">{[...m.items].sort((a, b) => Number(a.related_only) - Number(b.related_only) || statusOrder(a) - statusOrder(b)).map(x => <div className={'matrix-row ' + (x.status === 'satisfied' ? 'satisfied' : 'pending')} key={x.dimension + x.tag_id}><b aria-hidden="true">{x.status === 'satisfied' ? '✓' : '○'}</b><div><strong>{x.label}</strong><small>{{ skills: '技能', certificates: '证书', qualities: '通用素质' }[x.dimension]}{x.enhancement_basis ? ' · ' + x.enhancement_basis : ''}</small></div>{x.status === 'satisfied' ? <em>资料中已出现</em> : <button type="button" className="matrix-action" onClick={() => focusProfileItem(x)}>补充资料 →</button>}</div>)}</div></section>
          <section className="report-section report-advice" id="report-advice" tabIndex={-1}><header><p>04 · 行动建议</p><h2>AI 行动建议</h2><span>建议仅供参考，以实际经历为准</span></header>{reportError != null && <ErrorBox error={reportError} onRetry={generateReport} retryLabel="重试生成" />}{report ? <ReportBlock report={report} stale={reportStale} staleMessage={reportStaleMessage} onCopy={copyReport} onExport={exportReport} copyState={copyState} /> : <div className="advice-placeholder"><div><b>01</b><h3>岗位评价</h3><p>了解资料与岗位的契合情况。</p></div><div><b>02</b><h3>学习方向</h3><p>明确学习方向和实践任务。</p></div><div><b>03</b><h3>行动步骤</h3><p>安排下一步，可导出报告。</p></div></div>}</section>
        </>}
      </div>
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
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
