import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiPost, errMessage } from '../api';
import type { Filters, MatchResult, Recommendation, ReportResp, StudentProfile } from '../types';
import { fmtNum, fmtPct, todayStamp } from '../format';
import { filtersSummary, parseFilters } from '../lib/filters';
import { getReportText, reportFileName } from '../report';
import { isReportStale, type ReportMeta } from '../lib/stale';
import { EmptyState, ErrorBox, Loading } from './ui';

function DimensionChart({ match }: { match: MatchResult }) {
  const dims = match.dimensions.filter(d => d.required > 0);
  const naDims = match.dimensions.filter(d => d.required === 0);
  if (dims.length === 0) {
    return <div className="item pending">该岗位没有可用要求，无法计算匹配度。</div>;
  }
  const data = dims.map(d => ({
    name: d.label,
    basic: fmtNum(d.basic ?? 0),
    enhanced: fmtNum(d.enhanced ?? 0)
  }));
  return (
    <>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={64 + dims.length * 58}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 52, bottom: 4, left: 4 }} barCategoryGap="24%">
            <CartesianGrid horizontal={false} stroke="rgba(255,255,255,.08)" />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => v + '%'}
              tick={{ fontSize: 10, fill: '#7d7d84' }} axisLine={{ stroke: 'rgba(255,255,255,.08)' }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={72}
              tick={{ fontSize: 11, fill: '#d7d7dc' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: unknown) => [String(v) + '%']} />
            <Bar dataKey="basic" name="基础匹配" fill="#f5f5f7" radius={[0, 3, 3, 0]} barSize={12}>
              <LabelList dataKey="basic" position="right" formatter={(v: unknown) => fmtPct(Number(v))}
                style={{ fontSize: 10, fill: '#f5f5f7' }} />
            </Bar>
            <Bar dataKey="enhanced" name="增强参考" fill="#77777f" radius={[0, 3, 3, 0]} barSize={12}>
              <LabelList dataKey="enhanced" position="right" formatter={(v: unknown) => fmtPct(Number(v))}
                style={{ fontSize: 10, fill: '#b7b7bd' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="chart-note mono">白＝基础匹配 · 灰＝增强参考（含相关基础，上限 0.25/项）· 数据全部来自服务端匹配结果</p>
      </div>
      {naDims.length > 0 && (
        <p className="soft-note">
          {naDims.map(d => d.label).join('、')}：该岗位无此类要求，显示「不适用」，不计入分数。
        </p>
      )}
    </>
  );
}

function ReportBlock({ report, stale, onCopy, onExport, copyState }: {
  report: ReportResp;
  stale: boolean;
  onCopy: () => void;
  onExport: () => void;
  copyState: string;
}) {
  return (
    <div className="report">
      {stale && (
        <div className="stale-banner" role="status">
          学生信息、目标岗位或服务端版本已变化，下方报告按旧输入生成，已标记失效——请点击「生成职业建议」重新计算。
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

export default function MatchesTab({ isActive, student, studentRev, serverAlgorithm, serverDataVersion, showToast, onGoProfile }: {
  isActive: boolean;
  student: StudentProfile;
  studentRev: number;
  serverAlgorithm: string | null;
  serverDataVersion: string | null;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
  onGoProfile: () => void;
}) {
  const [city, setCity] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryPeriod, setSalaryPeriod] = useState<Filters['salary_period']>('month');
  const [skillText, setSkillText] = useState('');
  const [sortBy, setSortBy] = useState<'basic' | 'enhanced'>('basic');
  const [items, setItems] = useState<Recommendation[]>([]);
  const [meta, setMeta] = useState<{ count: number; note: string; summary: string; rev: number } | null>(null);
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

  const notConfirmed = !student.confirmed;
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
  const reportDisabled = reportLoading || resultsStale || notConfirmed;

  useEffect(() => {
    // 进入匹配页或确认画像后自动计算一次；学生信息编辑造成的过期不自动重算，
    // 由失效横幅提示用户手动刷新，避免连续输入触发请求风暴。
    if (isActive && !notConfirmed && !loading && (meta == null || meta.rev !== studentRev)) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, notConfirmed]);

  async function load() {
    if (studentRef.current.confirmed !== true) return;
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
            reason: '这是你的意向目标岗位，已按当前画像单独计算。',
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
      setMeta({ count: d.candidate_count, note: d.note, summary: filtersSummary(parsed.filters!), rev: reqRev });
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
    if (!studentRef.current.confirmed) {
      setReportError(null);
      showToast('画像尚未确认，请先到「能力档案」确认后再生成建议', 'err');
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

  if (notConfirmed && meta == null && !loading && loadError == null) {
    return (
      <div className="matches-stitch matches-stitch-empty">
        <div className="matches-stitch-hero"><h2 className="empty-title">深度能力匹配报告</h2></div>
        <div className="match-empty-card"><EmptyState symbol="↗" title="先完成并确认能力画像"><p>到「能力档案」填写并点击「确认完整画像」后，这里会展示最多 5 个岗位推荐。</p><button className="ghost-button" type="button" onClick={onGoProfile}>去填写能力画像</button></EmptyState></div>
      </div>
    );
  }

  return (
    <div className="matches-stitch">
      <section className="matches-stitch-hero">
        <h2>{m?.basic == null ? '—' : fmtNum(m.basic)}<small>/ 100</small></h2>
        <h3>{m?.job_name || '正在计算目标岗位'}</h3>
        <div className="matches-hero-actions"><button className="primary-button" type="button" onClick={generateReport} disabled={reportDisabled}>{reportLoading ? '正在生成…' : '生成 AI 深度建议'}</button><button className="ghost-button" type="button" onClick={load} disabled={loading}>刷新匹配结果</button></div>
      </section>
      <main className="match-report-flow">
        <details className="match-filter-panel"><summary>调整岗位筛选条件 <span>{meta?.summary || '全部岗位'}</span></summary><div className="matches-stitch-filter"><label>城市<input value={city} maxLength={80} placeholder="不限" onChange={e => setCity(e.target.value)} /></label><label>薪资下限<input value={salaryMin} type="number" min={0} step={100} placeholder="如 5000" onChange={e => setSalaryMin(e.target.value)} /></label><label>薪资上限<input value={salaryMax} type="number" min={0} step={100} placeholder="如 12000" onChange={e => setSalaryMax(e.target.value)} /></label><label>计薪周期<select value={salaryPeriod} onChange={e => setSalaryPeriod(e.target.value as Filters['salary_period'])}><option value="month">按月</option><option value="day">按天</option></select></label><label>必须包含技能<input value={skillText} maxLength={200} placeholder="Java, MySQL" onChange={e => setSkillText(e.target.value)} /></label><label>排序<select value={sortBy} onChange={e => setSortBy(e.target.value as 'basic' | 'enhanced')}><option value="basic">按基础分</option><option value="enhanced">按增强分</option></select></label><button className="primary-button" type="button" onClick={load}>应用筛选</button></div></details>
        {filterError && <div className="error-box"><p>{filterError}</p></div>}
        {notConfirmed && <div className="stale-banner">画像已修改且尚未确认，当前报告已失效。</div>}{matchesStale && !notConfirmed && <div className="stale-banner">画像已变化，请刷新匹配结果。</div>}{versionStale && <div className="stale-banner">服务端算法或数据版本已更新，请刷新匹配结果。</div>}
        {loading ? <Loading text="正在计算推荐…" /> : loadError != null ? <ErrorBox error={loadError} onRetry={load} retryLabel="重新计算推荐" /> : !m ? <EmptyState symbol="◌" title="暂时没有符合条件的岗位"><p>{meta?.note || '请调整筛选条件后重试。'}</p></EmptyState> : <>
          <section className="report-section report-diagnosis"><header><p>ACT 01 · 双维匹配诊断</p><h2>双维量化契合诊断</h2><span>基础分与增强分均由服务端匹配规则计算</span></header><div className="diagnosis-grid"><article><span>BASE FIT INDEX</span><em>基础对齐分</em><strong>{fmtPct(m.basic)}</strong><p>只统计已确认、等级达标且有证据的能力项。</p><i><b style={{ width: Math.min(100, m.basic ?? 0) + '%' }} /></i></article><article><span>ENHANCED MATCH</span><em>增强匹配度</em><strong>{fmtPct(m.enhanced)}</strong><p>综合能力等级与相关基础能力后的参考结果，不改变基础分。</p><i><b style={{ width: Math.min(100, m.enhanced ?? 0) + '%' }} /></i></article></div><div className="diagnosis-facts"><div><b>{m.satisfied}</b><span>已满足能力</span></div><div><b>{m.gap_items.length}</b><span>明确能力缺口</span></div><div><b>{m.pending_items.length}</b><span>待确认能力</span></div><div><b>{m.required}</b><span>岗位要求总数</span></div></div></section>
          <section className="report-section report-ecosystem"><header><p>ACT 02 · 能力生态图谱</p><h2>能力维度全景图谱</h2><span>观察技能、证书与通用素质在目标岗位中的分布</span></header><div className="ecosystem-card"><DimensionChart match={m} /><div className="dimension-readouts">{m.dimensions.map(d => <div key={d.id}><span>{d.label}</span><b>{d.required === 0 ? '不适用' : fmtPct(d.basic)}</b><small>{d.satisfied} / {d.required} 已满足</small></div>)}</div></div></section>
          <section className="report-section report-matrix"><header><p>ACT 03 · COMPLIANCE MATRIX</p><h2>必需技能差距矩阵</h2><span>在能力档案中补充等级、确认状态和原文证据</span></header><div className="matrix-list">{m.items.map(x => <div className={'matrix-row ' + x.status} key={x.dimension + x.tag_id}><b>{x.status === 'satisfied' ? '✓' : x.status === 'gap' ? '!' : '○'}</b><div><strong>{x.label}</strong><small>{x.dimension} · {x.enhancement_basis || '等待证据核验'}</small></div><span>当前 {x.student_level ?? '—'}</span><span>目标 {x.required_level ?? '—'}</span><em>{x.status === 'satisfied' ? '已满足' : x.status === 'gap' ? '需补齐' : '待确认'}</em></div>)}</div></section>
          <section className="report-section report-advice"><header><p>ACT 04 · INTELLIGENCE ROADMAP</p><h2>AI 智能体建议与行动路径</h2><span>建议只作为职业决策辅助，最终以你的实际经历为准</span></header>{reportError != null && <ErrorBox error={reportError} onRetry={generateReport} retryLabel="重试生成" />}{report ? <ReportBlock report={report} stale={reportStale} onCopy={copyReport} onExport={exportReport} copyState={copyState} /> : <div className="advice-placeholder"><div><b>01</b><h3>生成契合度评价</h3><p>结合已满足项和能力缺口，生成针对目标岗位的判断。</p></div><div><b>02</b><h3>拆解学习方向</h3><p>把差距转换为可开始执行的学习主题与实战任务。</p></div><div><b>03</b><h3>建立成长步骤</h3><p>按优先级排列后续行动，并保留报告导出能力。</p></div><button className="primary-button" type="button" onClick={generateReport} disabled={reportDisabled}>{reportLoading ? '正在生成…' : '生成职业建议'}</button></div>}</section>
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
