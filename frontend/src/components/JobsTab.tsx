import { useMemo, useRef, useState } from 'react';
import { apiGet } from '../api';
import { skillDescription } from '../lib/skillDescriptions';
import type { JobDetail, JobSummary, Requirement } from '../types';
import { EmptyState, ErrorBox, JobModal, Loading } from './ui';

const DIM_GROUPS: Array<{ key: 'skills' | 'certificates' | 'qualities'; label: string }> = [
  { key: 'skills', label: '核心技能' },
  { key: 'certificates', label: '证书要求' },
  { key: 'qualities', label: '通用素质' }
];

function RequirementItem({ r }: { r: Requirement }) {
  return (
    <article className="req-item">
      <h5>{r.label}</h5>
      <p className="req-description">{skillDescription(r.label)}</p>
    </article>
  );
}

function JobDetailBody({ job, onSetTarget }: { job: JobDetail; onSetTarget: (id: string, name: string) => void }) {
  return (
    <div className="job-detail">
      <header className="job-detail-head">
        <p className="eyebrow">职业需要的技能</p>
        <h3>{job.name}</h3>
        <p className="detail-summary">{job.summary}</p>
      </header>
      <div className="job-detail-layout">
        <section className="job-detail-main" aria-label="岗位能力要求">
          {DIM_GROUPS.map(g => {
            const items = (job.requirements ?? []).filter(r => r.dimension === g.key);
            if (items.length === 0) return null;
            return (
              <div className="item-block job-detail-group" key={g.key}>
                <h4>{g.label}</h4>
                <div className="job-detail-items">
                  {items.map(r => <RequirementItem key={r.tag_id} r={r} />)}
                </div>
              </div>
            );
          })}
          {(job.preferred ?? []).length > 0 && (
            <div className="item-block job-detail-group">
              <h4>拓展技能</h4>
              <p className="preferred-description">还可以进一步学习{job.preferred.map(r => r.label).join('、')}。</p>
            </div>
          )}
        </section>
      </div>
      <div className="detail-actions">
        <button className="primary-button" type="button" onClick={() => onSetTarget(job.id, job.name)}>
          设为目标岗位
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
        <h2>岗位目录</h2>
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
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索岗位或技能" />
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
                <span className="jobs-card-link">查看详情 <b>↗</b></span>
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

