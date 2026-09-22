import { useEffect, useMemo, useState } from 'react';
import { apiGet, errMessage } from '../api';
import type { CareerPaths, CareerEdge, PathNode } from '../types';
import { EmptyState, ErrorBox, Loading } from './ui';

const STAGE_LABELS = ['当前阶段', '中期目标', '最终目标'];
const PHASE_LABELS = ['PHASE 01 · 基础能力建立', 'PHASE 02 · 核心能力进阶', 'PHASE 03 · 资深能力纵深'];

export default function PathsTab({ active, jobs, showToast }: {
  active: boolean;
  jobs: Array<{ id: string; name: string }>;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
}) {
  const [data, setData] = useState<CareerPaths | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (active && !data && !loading && error == null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<CareerPaths>('/api/career-paths');
      setData(d);
      setSelectedJobId(current => current || jobs[0]?.id || d.nodes[0]?.job_id || '');
    } catch (e) {
      setError(e);
      showToast('路径加载失败：' + errMessage(e), 'err');
    } finally {
      setLoading(false);
    }
  }

  const jobName = useMemo(() => new Map(jobs.map(j => [j.id, j.name])), [jobs]);
  const focusJobId = selectedJobId || jobs[0]?.id || data?.nodes[0]?.job_id || '';
  const focusNodes = useMemo(() => (data?.nodes ?? []).filter(n => n.job_id === focusJobId).sort((a, b) => a.stage - b.stage), [data, focusJobId]);
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map(n => [n.id, n])), [data]);
  const promotionBySource = useMemo(() => new Map((data?.edges ?? []).filter(e => e.type === 'promotion').map(e => [e.source, e])), [data]);
  const transitions = useMemo(() => (data?.edges ?? []).filter(e => e.type === 'transition' && (nodeById.get(e.source)?.job_id === focusJobId || nodeById.get(e.target)?.job_id === focusJobId)), [data, nodeById, focusJobId]);
  const actionEdges = useMemo(() => (data?.edges ?? []).filter(edge =>
    edge.activity && (nodeById.get(edge.source)?.job_id === focusJobId || nodeById.get(edge.target)?.job_id === focusJobId)
  ).slice(0, 6), [data, nodeById, focusJobId]);
  const selectedEdge = data?.edges.find(e => e.id === selectedEdgeId) ?? null;

  if (!active && data) return null;
  if (error != null) return <div className="paths-stitch"><ErrorBox error={error} onRetry={load} retryLabel="重新加载路径" /></div>;
  if (loading) return <div className="paths-stitch"><Loading text="正在加载职业路径…" /></div>;
  if (!data) return <div className="paths-stitch"><EmptyState symbol="↝" title="路径图尚未加载"><button className="ghost-button" type="button" onClick={load}>加载职业路径</button></EmptyState></div>;

  return (
    <div className="paths-stitch">
      <section className="paths-hero">
        <h2>明确你的职业成长路径</h2>
        <label className="path-job-select">聚焦岗位<select value={focusJobId} onChange={e => { setSelectedJobId(e.target.value); setSelectedEdgeId(null); }}>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
        <div className="path-overview"><div><small>{STAGE_LABELS[0]}</small><b>{focusNodes[0]?.label || jobName.get(focusJobId) || '起步岗位'}</b></div><span>→</span><div><small>{STAGE_LABELS[1]}</small><b>{focusNodes[1]?.label || '能力进阶'}</b></div><span>→</span><div><small>{STAGE_LABELS[2]}</small><b>{focusNodes[2]?.label || '资深岗位'}</b></div><em>↗</em></div>
      </section>

      <main className="path-flow">
        <section className="path-section path-ladder"><header><p>ACT 01 · 核心能力演进</p><h2>核心技术纵深阶梯</h2><span>点击阶段卡片，查看可迁移能力、需要补齐的差距与建议活动</span></header><div className="path-timeline">{focusNodes.map((node, index) => <TimelineStage key={node.id} node={node} index={index} edge={promotionBySource.get(node.id)} selected={promotionBySource.get(node.id)?.id === selectedEdgeId} onSelect={setSelectedEdgeId} />)}</div></section>

        <section className="path-section path-branches"><header><p>ACT 02 · 交叉学科扩展</p><h2>横向转岗与分支延展路线</h2><span>基于当前岗位的能力重叠，展示可以继续探索的相邻岗位</span></header><div className="path-branch-grid">{transitions.length === 0 ? <EmptyState symbol="◌" title="暂无横向路径"><p>当前数据集中没有与该岗位相连的转岗边。</p></EmptyState> : transitions.map((edge, index) => { const a=nodeById.get(edge.source); const b=nodeById.get(edge.target); const target=a?.job_id===focusJobId?b:a; return <button type="button" key={edge.id} className={edge.id===selectedEdgeId?'active':''} onClick={() => setSelectedEdgeId(edge.id)}><span>DIRECTION {String.fromCharCode(65 + index)}</span><h3>{target?.label || '相邻岗位'}</h3><p>{edge.activity || '通过可迁移能力完成岗位切换。'}</p><small>可迁移：{edge.transferable.slice(0,3).join('、') || '待分析'}</small><em>↗</em></button>; })}</div>{selectedEdge && <EdgeDetail edge={selectedEdge} nodeById={nodeById} />}</section>

        <section className="path-section path-sprints"><header><p>ACT 03 · 实战落地</p><h2>季度冲刺实战任务清单</h2><span>把当前岗位相关的能力差距转成可执行的项目、学习与验证动作</span></header><div className="sprint-list">{actionEdges.length === 0 ? <EmptyState symbol="◌" title="暂无实战任务"><p>当前岗位的路径数据中还没有可执行活动。</p></EmptyState> : actionEdges.map((edge,index) => <button type="button" key={edge.id} onClick={() => setSelectedEdgeId(edge.id)}><b>{String(index+1).padStart(2,'0')}</b><span><strong>{edge.activity}</strong><small>{edge.type === 'promotion' ? '纵向晋升任务' : '横向转岗任务'} · 补齐 {edge.gaps.join('、') || '综合能力'}</small></span><em>{index===0?'RECOMMENDED':index<3?'CORE SPRINT':'PLANNED'}</em></button>)}</div></section>

        <section className="path-action-hub"><div><span>CAREER ACTION HUB</span><h3>保存你的个人职业规划路径</h3><p>路径数据来自当前岗位能力图谱，后续可结合匹配报告持续调整。</p></div><button type="button" className="ghost-button" onClick={() => showToast('当前路径已保留在本次会话中')}>保存当前路径</button></section>
      </main>
    </div>
  );
}

function TimelineStage({ node, index, edge, selected, onSelect }: { node: PathNode; index: number; edge?: CareerEdge; selected: boolean; onSelect: (id: string) => void }) {
  return <article className={'timeline-stage ' + (index % 2 ? 'reverse' : '')}><div className="timeline-copy"><span>{PHASE_LABELS[index] || 'PHASE ' + String(index + 1).padStart(2, '0')}</span><h3>{node.label}</h3><p>{index === 0 ? '夯实岗位基础能力，建立可验证的项目与实践证据。' : index === 1 ? '提升独立交付、复杂问题诊断与跨模块协作能力。' : '形成系统设计、技术决策和团队影响力。'}</p></div><button type="button" className={'timeline-node ' + (selected ? 'active' : '')} disabled={!edge} onClick={() => edge && onSelect(edge.id)}>{String(index + 1).padStart(2, '0')}</button><button type="button" className={'timeline-card ' + (selected ? 'active' : '')} disabled={!edge} onClick={() => edge && onSelect(edge.id)}><span>{index === 0 ? 'CORE CAPABILITIES MATRIX' : index === 1 ? 'STAGE REQUIREMENTS' : 'LONG-TERM STRATEGY'}</span>{edge ? <><p><b>可迁移能力</b>{edge.transferable.join('、') || '按当前阶段积累'}</p><p><b>需要补齐</b>{edge.gaps.join('、') || '暂无明确缺口'}</p><small>{edge.activity || '继续积累真实项目证据'}</small></> : <p>当前阶段已是该岗位路径的终点，可继续探索横向转型路线。</p>}</button></article>;
}

function EdgeDetail({ edge, nodeById }: { edge: CareerEdge; nodeById: Map<string, PathNode> }) {
  return <div className="path-selected-detail"><span>{edge.type === 'promotion' ? '纵向晋升路径' : '横向转岗路径'}</span><h3>{nodeById.get(edge.source)?.label || edge.source} → {nodeById.get(edge.target)?.label || edge.target}</h3><p><b>可迁移能力：</b>{edge.transferable.join('、') || '无'}</p><p><b>需要补齐：</b>{edge.gaps.join('、') || '无'}</p><p><b>建议活动：</b>{edge.activity || '—'}</p><small>{edge.source_type}</small></div>;
}
