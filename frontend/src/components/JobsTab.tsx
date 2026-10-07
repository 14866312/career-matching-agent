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
  if (r.level_source === 'binary_requirement') return '具备即可';
  if (r.required_level == null) return '等级未标注';
  const label = ['未标注', '了解', '熟悉', '熟练'][r.required_level] ?? '等级 ' + r.required_level;
  return label + (r.level_source === 'default_baseline' ? ' · 默认基线' : '');
}

function RequirementItem({ r }: { r: Requirement }) {
  return (
    <details className="req-item">
      <summary>
        <b>{r.label}</b>
        <span className="req-level">{levelSummary(r)}<span className="req-chevron" aria-hidden="true">⌄</span></span>
      </summary>
      <div className="req-content">
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
        {(r.level_basis || r.selection_basis) && (
          <details className="req-method">
            <summary>查看整理依据</summary>
            {r.level_basis && <p className="req-basis">{r.level_basis}</p>}
            {r.selection_basis && <p className="req-basis">{r.selection_basis}</p>}
          </details>
        )}
      </div>
    </details>
  );
}

function JobDetailBody({ job, onSetTarget }: { job: JobDetail; onSetTarget: (id: string, name: string) => void }) {
  const samples = job.samples ?? [];
  return (
    <div className="job-detail">
      <header className="job-detail-head">
        <p className="eyebrow">职业需要的技能</p>
        <h3>{job.name}</h3>
        <p className="detail-meta">{job.level}</p>
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
                    : <p className="soft-note">样本未提及证书要求，不代表无要求。</p>}
                </div>
                {g.key === 'certificates' && job.certificate_note && (
                  <details className="job-detail-note">
                    <summary>证书要求说明</summary>
                    <p className="soft-note">{job.certificate_note}</p>
                  </details>
                )}
              </div>
            );
          })}
        </section>
        <aside className="job-detail-aside" aria-label="岗位补充信息">
          {(job.preferred ?? []).length > 0 && (
            <div className="item-block">
              <h4>优先项 · {job.preferred.length}<span>只作补充建议，不计入基础分和增强分</span></h4>
              {job.preferred.map(r => (
                <div className="item pending" key={r.tag_id}>＋ {r.label}{r.required_level ? <span className="mono"> · 建议等级 {r.required_level}</span> : null}</div>
              ))}
            </div>
          )}
          <details className="item-block job-detail-samples">
            <summary>来源样本 · {samples.length} 条</summary>
            <p className="soft-note">历史招聘样本，仅用于整理能力基线；以下展示前 3 条。数据版本 {job.version}。</p>
            {samples.slice(0, 3).map(s => (
              <div className="sample-row" key={s.id}>
                <b>{s.company}</b>
                <span>{s.city ?? '—'} · {s.salary?.raw || '薪资面议'}</span>
                <span className="mono">{s.updated_raw ?? ''}</span>
              </div>
            ))}
          </details>
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
  const targetJobName = jobs.find(job => job.id === targetJobId)?.name;

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
        <h2>探索职业岗位</h2>
        <div className="jobs-stitch-stats" aria-label="岗位数据概览">
          <div><span>目标岗位</span><strong className="is-text">{targetJobName || (targetJobId ? '已选择' : '待选择')}</strong></div>
          <div><span>岗位目录</span><strong>{jobs.length}<small>个</small></strong></div>
          <div><span>能力要求</span><strong>{requirementCount}<small>项</small></strong></div>
        </div>
      </section>

      <section className="jobs-stitch-section" id="curated-roles">
        <div className="jobs-stitch-section-head">
          <div>
            <h3>岗位目录</h3>
          </div>
          <label className="jobs-stitch-search">
            <span className="sr-only">搜索岗位</span>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索岗位、方向或技能" />
          </label>
        </div>
        <p className="jobs-stitch-note">
          目录供探索，个性化推荐见匹配报告；能力基线不代表统一招聘门槛。
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
                  {j.id === targetJobId && <span className="jobs-stitch-family">目标岗位 ✓</span>}
                  <span className="jobs-stitch-level">{j.level}</span>
                </div>
                <div className="jobs-stitch-title-row"><h4>{j.name}</h4></div>
                <p>{j.summary}</p>
              </div>
              <div className="jobs-card-footer">
                <div className="jobs-stitch-pills">
                  {j.requirements.slice(0, 4).map(r => <span key={r.tag_id}>{r.label}</span>)}
                  {j.requirements.length > 4 && <span>+{j.requirements.length - 4}</span>}
                </div>
                <span className="jobs-card-link">查看岗位详情 <b>↗</b></span>
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

