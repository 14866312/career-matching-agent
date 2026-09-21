import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiPost, errMessage } from '../api';
import type { Filters, MatchItem, MatchResult, Recommendation, ReportResp, StudentProfile } from '../types';
import { fmtNum, fmtPct, todayStamp } from '../format';
import { filtersSummary, parseFilters } from '../lib/filters';
import { getReportText, reportFileName } from '../report';
import { isReportStale, type ReportMeta } from '../lib/stale';
import { EmptyState, ErrorBox, Loading } from './ui';

function MatchItemRow({ x }: { x: MatchItem }) {
  const small =
    x.status === 'satisfied'
      ? x.enhancement_basis || '用户已确认'
      : x.status === 'gap'
        ? x.enhancement_basis || '已标记但等级为 0，未计入基础分'
        : x.related_only && x.enhancement_basis
          ? '相关基础：' + x.enhancement_basis + '（计入增强参考，不代表已满足）'
          : x.level_source === 'binary_requirement'
            ? '二元要求 · 具备即可 · 请在「我的能力」确认'
            : x.required_level == null
              ? '要求等级未标注 · 请在「我的能力」确认'
              : '要求等级 ' + x.required_level + ' · 请在「我的能力」确认';
  return (
    <div className={'item ' + (x.status === 'satisfied' ? '' : x.status)}>
      <span className="item-label">
        {x.status === 'satisfied' ? '✓ ' : x.status === 'gap' ? '− ' : '○ '}
        {x.label}
        {x.related_only && x.status !== 'satisfied' && <span className="pill">相关基础</span>}
      </span>
      <small>{small}</small>
    </div>
  );
}

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
            <CartesianGrid horizontal={false} stroke="#e4e8e1" />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => v + '%'}
              tick={{ fontSize: 10, fill: '#71807b' }} axisLine={{ stroke: '#dce2d9' }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={72}
              tick={{ fontSize: 11, fill: '#1c2a27' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: unknown) => [String(v) + '%']} />
            <Bar dataKey="basic" name="基础匹配" fill="#2d6652" radius={[0, 3, 3, 0]} barSize={12}>
              <LabelList dataKey="basic" position="right" formatter={(v: unknown) => fmtPct(Number(v))}
                style={{ fontSize: 10, fill: '#2d6652' }} />
            </Bar>
            <Bar dataKey="enhanced" name="增强参考" fill="#df764a" radius={[0, 3, 3, 0]} barSize={12}>
              <LabelList dataKey="enhanced" position="right" formatter={(v: unknown) => fmtPct(Number(v))}
                style={{ fontSize: 10, fill: '#b25b37' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="chart-note mono">绿＝基础匹配 · 橙＝增强参考（含相关基础，上限 0.25/项）· 数据全部来自服务端匹配结果</p>
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
  const standaloneCount = items.filter(x => x.standalone).length;

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
      showToast('画像尚未确认，请先到「我的能力」确认后再生成建议', 'err');
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
      <>
        <div className="section-head"><div><p className="eyebrow">MATCH ENGINE</p><h2>看见你与岗位的距离</h2></div></div>
        <div className="card match-list">
          <EmptyState symbol="↗" title="先完成并确认能力画像">
            <p>到「我的能力」填写并点击「确认完整画像」后，这里会展示最多 5 个岗位推荐。零技能画像也可以确认，结果会展示为 0 分或待确认。</p>
            <button className="ghost-button" type="button" aria-label="去填写能力画像" onClick={onGoProfile}>去填写能力画像</button>
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">MATCH ENGINE</p>
          <h2>看见你与岗位的距离</h2>
        </div>
        <div className="toolbar">
          <button className="ghost-button" type="button" aria-label="刷新推荐" onClick={load} disabled={loading || notConfirmed}>刷新推荐</button>
        </div>
      </div>
      <div className="card filter-bar">
        <label>城市筛选
          <input value={city} maxLength={80} placeholder="留空则不筛选" aria-label="城市筛选" onChange={e => setCity(e.target.value)} />
        </label>
        <label>薪资下限（元）
          <input value={salaryMin} type="number" min={0} step={100} inputMode="numeric" placeholder="如 5000" aria-label="薪资下限"
            onChange={e => setSalaryMin(e.target.value)} />
        </label>
        <label>薪资上限（元）
          <input value={salaryMax} type="number" min={0} step={100} inputMode="numeric" placeholder="如 12000" aria-label="薪资上限"
            onChange={e => setSalaryMax(e.target.value)} />
        </label>
        <label>计薪周期
          <select value={salaryPeriod} aria-label="计薪周期" onChange={e => setSalaryPeriod(e.target.value as Filters['salary_period'])}>
            <option value="month">按月</option>
            <option value="day">按天</option>
          </select>
        </label>
        <label>必须包含技能
          <input value={skillText} maxLength={200} placeholder="逗号分隔，如 Java, MySQL" aria-label="必须包含技能"
            onChange={e => setSkillText(e.target.value)} />
        </label>
        <label>排序
          <select value={sortBy} aria-label="推荐排序" onChange={e => { setSortBy(e.target.value as 'basic' | 'enhanced'); }}>
            <option value="basic">按基础分</option>
            <option value="enhanced">按增强分</option>
          </select>
        </label>
        <div className="filter-actions">
          <button className="primary-button slim" type="button" aria-label="应用筛选" onClick={load} disabled={loading || notConfirmed}>应用筛选</button>
          <button className="ghost-button" type="button" aria-label="重置筛选" onClick={() => { setCity(''); setSalaryMin(''); setSalaryMax(''); setSalaryPeriod('month'); setSkillText(''); }}>
            重置
          </button>
        </div>
      </div>
      {filterError && <div className="error-box" role="alert"><p>{filterError}</p></div>}
      <p className="soft-note">
        招聘样本为赛题历史数据，仅用于条件筛选与来源展示；日薪与月薪分别筛选、不做换算；筛选过严会整体排除无匹配样本的岗位。
      </p>
      <div className="match-layout">
        <div className="card match-list">
          {loading ? (
            <Loading text="正在计算推荐…" />
          ) : loadError != null ? (
            <ErrorBox error={loadError} onRetry={load} retryLabel="重新计算推荐" />
          ) : items.length === 0 ? (
            meta ? (
              <EmptyState symbol="◌" title="暂时没有符合条件的岗位">
                <p>{meta.note}</p>
                <p>尝试清空城市或薪资筛选，或回「我的能力」确认更多标签。</p>
              </EmptyState>
            ) : null
          ) : (
            <>
              {meta && (
                <p className="list-note mono">
                  筛选：{meta.summary} · 共 {meta.count} 个岗位符合，展示前 {items.length - standaloneCount} 个推荐
                  {standaloneCount > 0 && ('，另含目标岗位单独计算 ' + standaloneCount + ' 项')} · {meta.note}
                </p>
              )}
              {notConfirmed && (
                <div className="stale-banner" role="status">画像已修改（未确认），以下结果已失效。请到「我的能力」重新确认后再刷新。</div>
              )}
              {!notConfirmed && matchesStale && (
                <div className="stale-banner" role="status">学生信息已修改，以下结果按旧输入计算，请点击「刷新推荐」。</div>
              )}
              {items.map((x, i) => (
                <button type="button" className={'recommend-card' + (i === activeIndex ? ' active' : '')}
                  key={x.job_id} aria-pressed={i === activeIndex} aria-label={'查看 ' + x.job_name + ' 匹配详情'}
                  onClick={() => { setActiveIndex(i); setReport(null); setReportMeta(null); setReportError(null); }}>
                  <div className="recommend-head">
                    <h3>{x.job_name}{x.standalone && <span className="pill">目标岗位</span>}</h3>
                    <span className="score">{fmtPct(x.match.basic)}</span>
                  </div>
                  <div className="bar"><i style={{ width: Math.min(100, x.match.basic ?? 0) + '%' }} /></div>
                  <p className="sub-score mono">
                    增强参考 {fmtPct(x.match.enhanced)}
                    {!x.standalone && <> · 样本 {x.matching_sample_count} 条
                      {x.matching_sample_count < 3 && <span className="pill warn">样本不足</span>}</>}
                  </p>
                  <p>{x.reason}</p>
                  {!x.standalone && x.samples.slice(0, 2).map(s => (
                    <p className="mono sample-line" key={s.id}>{s.company} · {s.city ?? '—'} · {s.salary?.raw || '薪资面议'}（历史样本）</p>
                  ))}
                </button>
              ))}
            </>
          )}
        </div>
        <aside className="card detail-card">
          {!m ? (
            <EmptyState symbol="◌" title="选择一个岗位">
              <p>查看满足项、差距项、分维度图表与可执行的职业建议。</p>
            </EmptyState>
          ) : (
            <div className="detail">
              <p className="eyebrow">MATCH READOUT</p>
              <h3>{m.job_name}{active?.standalone && <span className="pill">目标岗位</span>}</h3>
              <p className="mono detail-meta">
                分数与满足/差距项由程序计算 · 算法 {m.algorithm_version} · 数据 {m.data_version}
              </p>
              <div className="overall-row">
                <div className="overall"><strong>{m.basic == null ? '无法计算' : fmtPct(m.basic)}</strong><span>基础匹配</span></div>
                <div className="overall alt"><strong>{m.enhanced == null ? '—' : fmtPct(m.enhanced)}</strong><span>增强参考</span></div>
                <div className="overall"><strong>{m.satisfied}/{m.required}</strong><span>已满足 / 要求项</span></div>
              </div>
              {m.basic == null && (
                <div className="item pending">该岗位没有可用要求，基础分无法计算，已从推荐中排除。</div>
              )}
              {m.basic != null && <DimensionChart match={m} />}
              <div className="item-block">
                <h4>已满足 · {m.satisfied_items.length}</h4>
                {m.satisfied_items.length > 0
                  ? m.satisfied_items.map(x => <MatchItemRow key={x.dimension + x.tag_id} x={x} />)
                  : <div className="item pending">暂无已确认满足项</div>}
              </div>
              <div className="item-block">
                <h4>差距（已标记但未掌握）· {m.gap_items.length}</h4>
                {m.gap_items.length > 0
                  ? m.gap_items.map(x => <MatchItemRow key={x.dimension + x.tag_id} x={x} />)
                  : <div className="item ok">无</div>}
              </div>
              <div className="item-block">
                <h4>待确认（未知项，不计分）· {m.pending_items.length}</h4>
                {m.pending_items.length > 0
                  ? m.pending_items.map(x => <MatchItemRow key={x.dimension + x.tag_id} x={x} />)
                  : <div className="item ok">无</div>}
              </div>
              {versionStale && (
                <div className="stale-banner" role="status">
                  服务端算法/数据版本已更新（当前 {serverAlgorithm ?? '?'} / {serverDataVersion ?? '?'}），本结果按旧版本计算，请点击「刷新推荐」。
                </div>
              )}
              <div className="detail-actions">
                <button className="primary-button" type="button" aria-label="生成职业建议" onClick={generateReport} disabled={reportDisabled}
                  title={reportDisabled && !reportLoading ? '学生信息或服务端版本已变化，请先刷新推荐' : undefined}>
                  {reportLoading ? '正在生成…' : '生成职业建议'} <span>↗</span>
                </button>
              </div>
              {resultsStale && !reportLoading && (
                <p className="soft-note">结果已失效：请先刷新推荐，再生成建议。</p>
              )}
              {reportError != null && (
                <ErrorBox error={reportError} onRetry={generateReport} retryLabel="重试生成" />
              )}
              {report && (
                <ReportBlock report={report} stale={reportStale} onCopy={copyReport} onExport={exportReport} copyState={copyState} />
              )}
            </div>
          )}
        </aside>
      </div>
    </>
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
