import { useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import type { JobDetail, JobSummary, Requirement } from '../types';
import { EmptyState, ErrorBox, JobModal, Loading } from './ui';

const DIM_GROUPS: Array<{ key: 'skills' | 'certificates' | 'qualities'; label: string }> = [
  { key: 'skills', label: '核心技能' },
  { key: 'certificates', label: '证书要求' },
  { key: 'qualities', label: '通用素质' }
];

function levelSummary(r: Requirement): string {
  if (r.level_source === 'binary_requirement') return '二元要求 · 具备即可';
  if (r.required_level == null) return '要求等级未标注';
  if (r.level_source === 'level_rule') return '要求等级 ' + r.required_level + ' · 样本原文措辞';
  if (r.level_source === 'default_baseline') return '要求等级 ' + r.required_level + ' · 画像整理默认';
  return '要求等级 ' + r.required_level;
}

function RequirementItem({ r }: { r: Requirement }) {
  return (
    <details className="req-item">
      <summary>
        <b>{r.label}</b>
        <span className="mono">{levelSummary(r)}</span>
      </summary>
      {r.level_basis && <p className="req-basis">{r.level_basis}</p>}
      {r.selection_basis && <p className="req-basis">{r.selection_basis}</p>}
      {r.evidence && r.evidence.length > 0 && (
        <>
          {r.evidence.slice(0, 2).map((q, i) => (
            <blockquote key={i} className="req-quote">
              「{q.quote}」<cite>样本 {q.source_id}</cite>
            </blockquote>
          ))}
          {r.evidence.length > 2 && <p className="req-basis">其余 {r.evidence.length - 2} 条证据从略。</p>}
        </>
      )}
    </details>
  );
}

function JobDetailBody({ job, onSetTarget }: { job: JobDetail; onSetTarget: (id: string, name: string) => void }) {
  const samples = job.samples ?? [];
  return (
    <div className="job-detail">
      <header className="job-detail-head">
        <p className="eyebrow">JOB PROFILE</p>
        <h3>{job.name}</h3>
        <p className="mono detail-meta">{job.family} · {job.level} · 数据版本 {job.version}</p>
        <p className="detail-summary">{job.summary}</p>
      </header>
      <div className="job-detail-layout">
        <section className="job-detail-main" aria-label="岗位能力要求">
          {DIM_GROUPS.map(g => {
            const items = (job.requirements ?? []).filter(r => r.dimension === g.key);
            if (g.key !== 'certificates' && items.length === 0) return null;
            return (
              <div className="item-block job-detail-group" key={g.key}>
                <h4>{g.label} · {items.length}</h4>
                <div className="job-detail-items">
                  {items.length > 0
                    ? items.map(r => <RequirementItem key={r.tag_id} r={r} />)
                    : <div className="item pending">样本中未提及该维度要求（未提及不等于无要求）</div>}
                </div>
                {g.key === 'certificates' && job.certificate_note && <p className="soft-note">{job.certificate_note}</p>}
              </div>
            );
          })}
        </section>
        <aside className="job-detail-aside" aria-label="岗位补充信息">
          {(job.preferred ?? []).length > 0 && (
            <div className="item-block">
              <h4>优先项 · {job.preferred.length}<span>只作补充建议，不计入基础分</span></h4>
              {job.preferred.map(r => (
                <div className="item pending" key={r.tag_id}>＋ {r.label}{r.required_level ? <span className="mono"> · 建议等级 {r.required_level}</span> : null}</div>
              ))}
            </div>
          )}
          <div className="item-block job-detail-samples">
            <h4>来源样本 · 共 {samples.length} 条<span>显示前 3 条</span></h4>
            <p className="soft-note">以下为历史招聘样本，仅用于能力基线整理与条件筛选。</p>
            {samples.slice(0, 3).map(s => (
              <div className="sample-row" key={s.id}>
                <b>{s.company}</b>
                <span>{s.city ?? '—'} · {s.salary?.raw || '薪资面议'}</span>
                <span className="mono">{s.updated_raw ?? ''}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <div className="detail-actions">
        <button className="primary-button" type="button" onClick={() => onSetTarget(job.id, job.name)}>
          设为目标岗位 <span>↗</span>
        </button>
      </div>
    </div>
  );
}

export default function JobsTab({ jobs, loading, error, onRetry, onSetTarget, targetJobId }: {
  jobs: JobSummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSetTarget: (id: string, name: string) => void;
  targetJobId: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState('');
  const openIdRef = useRef<string | null>(null);

  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return jobs;
    return jobs.filter(job =>
      [job.name, job.family, job.level, job.summary, ...job.requirements.map(x => x.label)]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
  }, [jobs, query]);

  const requirementCount = jobs.reduce((total, job) => total + job.requirements.length, 0);
  const maxRequirementCount = Math.max(1, ...jobs.map(job => job.requirements.length));

  async function openJob(id: string) {
    openIdRef.current = id;
    setOpenId(id);
    setDetailError(null);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await apiGet<JobDetail>('/api/jobs/' + encodeURIComponent(id));
      if (openIdRef.current === id) setDetail(d);
    } catch (e) {
      if (openIdRef.current === id) setDetailError(e);
    } finally {
      if (openIdRef.current === id) setDetailLoading(false);
    }
  }

  const openJobName = jobs.find(j => j.id === openId)?.name ?? '';

  return (
    <div className="jobs-stitch">
      <section className="jobs-stitch-hero">
        <h2>精选适合你的职业岗位</h2>
        <div className="jobs-stitch-stats" aria-label="岗位数据概览">
          <div><span>目标岗位</span><strong className="is-text">{targetJobId ? '已选择' : '待选择'}</strong><em>{targetJobId ? '可前往能力档案继续' : '从岗位详情中设为目标'}</em></div>
          <div><span>精选岗位</span><strong>{jobs.length}<small>个</small></strong><em>来自当前岗位样本库</em></div>
          <div><span>能力要求</span><strong>{requirementCount}<small>项</small></strong><em>技能、证书与通用素质</em></div>
          <div className="jobs-stats-action"><span>数据已完成结构化，可继续查看岗位详情</span><a href="#curated-roles">开始探索 <b>↓</b></a></div>
        </div>
      </section>

      <section className="jobs-stitch-section" id="curated-roles">
        <div className="jobs-stitch-section-head">
          <div>
            <div className="jobs-stitch-kicker">CURATED POSITIONS</div>
            <h3>推荐岗位详情</h3>
            <p>点击岗位卡片，查看核心技能、证书要求、通用素质和来源样本。</p>
          </div>
          <label className="jobs-stitch-search">
            <span className="sr-only">搜索岗位</span>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索岗位、方向或技能" />
          </label>
        </div>
        <p className="jobs-stitch-note">
          数据来自当前项目岗位样本。要求等级用于能力基线整理，不代表每条招聘广告的统一硬门槛。
        </p>
      {error != null ? (
        <ErrorBox error={error} onRetry={onRetry} retryLabel="重新加载岗位" />
      ) : loading ? (
        <Loading text="正在加载岗位画像…" />
      ) : jobs.length === 0 ? (
        <EmptyState symbol="◌" title="暂无岗位数据">后端返回了空列表，请检查数据文件后刷新。</EmptyState>
      ) : visibleJobs.length === 0 ? (
        <EmptyState symbol="⌕" title="没有找到匹配岗位">换一个岗位名称、方向或技能关键词试试。</EmptyState>
      ) : (
        <div className="jobs-stitch-list">
          {visibleJobs.map(j => (
            <button type="button" className={'jobs-stitch-card' + (j.id === targetJobId ? ' is-target' : '')} key={j.id} onClick={() => openJob(j.id)} aria-label={'查看 ' + j.name + ' 详情'}>
              <div className="jobs-card-main">
                <div className="jobs-stitch-card-top">
                  <span className="jobs-stitch-family">{j.id === targetJobId ? 'TARGET ROLE' : j.family}</span>
                  <span className="jobs-stitch-level">{j.level}</span>
                </div>
                <div className="jobs-stitch-title-row"><h4>{j.name}</h4></div>
                <p>{j.summary}</p>
              </div>
              <div className="jobs-card-score"><strong>{j.requirements.length}<small>项</small></strong><span>核心能力要求</span><i><b style={{ width: `${(j.requirements.length / maxRequirementCount) * 100}%` }} /></i></div>
              <div className="jobs-stitch-divider" />
              <div className="jobs-card-metrics">
                <span><b>{j.requirements.length}</b> 项核心要求</span>
                <span><b>{j.preferred.length}</b> 项加分能力</span>
                <span><b>{j.version}</b> 数据版本</span>
              </div>
              <div className="jobs-card-footer">
                <div className="jobs-stitch-pills">
                  {j.requirements.slice(0, 4).map(r => <span key={r.tag_id}>{r.label}</span>)}
                  {j.requirements.length > 4 && <span>+{j.requirements.length - 4}</span>}
                </div>
                <span className="jobs-card-link">{j.id === targetJobId ? '目标岗位 ✓' : '了解岗位要求'} <b>↗</b></span>
              </div>
            </button>
          ))}
        </div>
      )}
      </section>
      <JobModal open={openId != null} onClose={() => setOpenId(null)} title={openJobName}>
        {detailLoading ? (
          <Loading text="正在加载岗位详情…" />
        ) : detailError != null ? (
          <ErrorBox error={detailError} onRetry={() => openJob(openId!)} retryLabel="重新加载" />
        ) : detail ? (
          <JobDetailBody job={detail} onSetTarget={(id, name) => { onSetTarget(id, name); setOpenId(null); }} />
        ) : null}
      </JobModal>
    </div>
  );
}

