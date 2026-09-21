import { useRef, useState } from 'react';
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
      <p className="eyebrow">JOB PROFILE</p>
      <h3>{job.name}</h3>
      <p className="mono detail-meta">{job.family} · {job.level} · 数据版本 {job.version}</p>
      <p className="detail-summary">{job.summary}</p>
      {DIM_GROUPS.map(g => {
        const items = (job.requirements ?? []).filter(r => r.dimension === g.key);
        if (g.key !== 'certificates' && items.length === 0) return null;
        return (
          <div className="item-block" key={g.key}>
            <h4>{g.label} · {items.length}</h4>
            {items.length > 0
              ? items.map(r => <RequirementItem key={r.tag_id} r={r} />)
              : <div className="item pending">样本中未提及该维度要求（未提及不等于无要求）</div>}
            {g.key === 'certificates' && job.certificate_note && <p className="soft-note">{job.certificate_note}</p>}
          </div>
        );
      })}
      {(job.preferred ?? []).length > 0 && (
        <div className="item-block">
          <h4>优先项 · {job.preferred.length}（只作补充建议，不计入基础分）</h4>
          {job.preferred.map(r => (
            <div className="item pending" key={r.tag_id}>＋ {r.label}{r.required_level ? <span className="mono"> · 建议等级 {r.required_level}</span> : null}</div>
          ))}
        </div>
      )}
      <div className="item-block">
        <h4>来源样本 · 共 {samples.length} 条（显示前 3 条）</h4>
        <p className="soft-note">以下为赛题历史招聘样本，仅用于能力基线整理与条件筛选，不代表当前有效招聘。</p>
        {samples.slice(0, 3).map(s => (
          <div className="sample-row" key={s.id}>
            <b>{s.company}</b>
            <span>{s.city ?? '—'} · {s.salary?.raw || '薪资面议'}</span>
            <span className="mono">{s.updated_raw ?? ''}</span>
          </div>
        ))}
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
  const openIdRef = useRef<string | null>(null);

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
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">ROLE ATLAS</p>
          <h2>六种起点，六条能力基线</h2>
        </div>
        <span className="count-badge">{jobs.length} ROLES</span>
      </div>
      <p className="soft-note">
        岗位画像整理自赛题历史招聘样本：「要求等级」来自样本原文措辞统计或画像整理默认，二元证书要求只看具备与否，并非每条招聘广告的统一硬门槛。点击卡片查看技能、证书、通用素质与来源样本。
      </p>
      {error != null ? (
        <ErrorBox error={error} onRetry={onRetry} retryLabel="重新加载岗位" />
      ) : loading ? (
        <Loading text="正在加载岗位画像…" />
      ) : jobs.length === 0 ? (
        <EmptyState symbol="◌" title="暂无岗位数据">后端返回了空列表，请检查数据文件后刷新。</EmptyState>
      ) : (
        <div className="job-grid">
          {jobs.map(j => (
            <button type="button" className="job-card" key={j.id} onClick={() => openJob(j.id)} aria-label={'查看 ' + j.name + ' 详情'}>
              <div className="job-top">
                <span className="monogram" style={{ background: j.color }}>{j.monogram}</span>
                <span className="mono">{j.level}</span>
              </div>
              <h3>{j.name}{j.id === targetJobId && <span className="target-flag">已设为目标</span>}</h3>
              <p>{j.summary}</p>
              <div className="pills">
                {j.requirements.slice(0, 4).map(r => <span className="pill" key={r.tag_id}>{r.label}</span>)}
                {j.requirements.length > 4 && <span className="pill">+{j.requirements.length - 4}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      <JobModal open={openId != null} onClose={() => setOpenId(null)} title={openJobName}>
        {detailLoading ? (
          <Loading text="正在加载岗位详情…" />
        ) : detailError != null ? (
          <ErrorBox error={detailError} onRetry={() => openJob(openId!)} retryLabel="重新加载" />
        ) : detail ? (
          <JobDetailBody job={detail} onSetTarget={(id, name) => { onSetTarget(id, name); setOpenId(null); }} />
        ) : null}
      </JobModal>
    </>
  );
}

