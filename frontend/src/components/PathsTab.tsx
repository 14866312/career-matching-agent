import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiGet, errMessage } from '../api';
import type { CareerPaths, CareerEdge, PathNode } from '../types';
import { EmptyState, ErrorBox, Loading } from './ui';
import type { PathSelection } from '../lib/localDraft';

const STAGE_LABELS = ['当前阶段', '中期目标', '最终目标'];
const PHASE_LABELS = ['阶段 01 · 基础能力建立', '阶段 02 · 核心能力进阶', '阶段 03 · 资深能力纵深'];

export default function PathsTab({ active, jobs, showToast, targetJobId, focusRequest, savedSelection, onSelectionChange, onClearSelection, onSaveSelection }: {
  active: boolean;
  jobs: Array<{ id: string; name: string }>;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
  targetJobId: string;
  focusRequest: { jobId: string; token: number } | null;
  savedSelection: PathSelection | null;
  onSelectionChange: (selection: PathSelection) => void;
  onClearSelection: () => void;
  onSaveSelection: (selection: PathSelection) => void;
}) {
  const savedSelectionForTarget = useMemo(() => (
    savedSelection && (!targetJobId || savedSelection.targetJobId === targetJobId)
      ? savedSelection
      : null
  ), [savedSelection, targetJobId]);
  const [data, setData] = useState<CareerPaths | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selectedJobId, setSelectedJobId] = useState(() => savedSelectionForTarget?.jobId || targetJobId || '');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(() => savedSelectionForTarget?.edgeId ?? null);
  const [planFocusRequest, setPlanFocusRequest] = useState(0);
  const userSelected = useRef(false);
  const handledFocusToken = useRef<number | null>(null);
  const previousTargetJobId = useRef(targetJobId);
  const currentPlanRef = useRef<HTMLElement>(null);
  // 最新值引用：恢复本机草稿时 targetJobId / savedSelection 同时变化，
  // 读旧闭包会把已保存的路径覆盖成未保存的默认聚焦。
  const savedSelectionRef = useRef(savedSelection);
  savedSelectionRef.current = savedSelection;
  const selectedJobIdRef = useRef(selectedJobId);
  selectedJobIdRef.current = selectedJobId;

  useLayoutEffect(() => {
    if (planFocusRequest === 0) return;
    currentPlanRef.current?.focus({ preventScroll: true });
    currentPlanRef.current?.scrollIntoView({ block: 'start' });
  }, [planFocusRequest]);

  function savedSelectionFor(target: string): PathSelection | null {
    const saved = savedSelectionRef.current;
    return saved && (!target || saved.targetJobId === target) ? saved : null;
  }

  useEffect(() => {
    if (active && !data && !loading && error == null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (previousTargetJobId.current !== targetJobId) {
      previousTargetJobId.current = targetJobId;
      userSelected.current = false;
      // 刷新后草稿里的路径与目标岗位一致：保留已保存的路线，不写入默认聚焦。
      const restored = savedSelectionFor(targetJobId);
      if (restored) {
        setSelectedJobId(restored.jobId);
        setSelectedEdgeId(restored.edgeId);
        return;
      }
      const preferredId = targetJobId && data?.nodes.some(node => node.job_id === targetJobId)
        ? targetJobId
        : jobs.find(job => data?.nodes.some(node => node.job_id === job.id))?.id || data?.nodes[0]?.job_id || '';
      setSelectedJobId(preferredId);
      setSelectedEdgeId(null);
      if (preferredId) onSelectionChange({ jobId: preferredId, edgeId: null, savedAt: null, targetJobId });
      return;
    }
    if (focusRequest && handledFocusToken.current !== focusRequest.token) {
      if (!data) return;
      handledFocusToken.current = focusRequest.token;
      if (!userSelected.current && data.nodes.some(node => node.job_id === focusRequest.jobId)) {
        setSelectedJobId(focusRequest.jobId);
        setSelectedEdgeId(null);
        onSelectionChange({ jobId: focusRequest.jobId, edgeId: null, savedAt: null, targetJobId });
      }
      return;
    }
    if (userSelected.current) return;
    if (savedSelectionForTarget) {
      setSelectedJobId(savedSelectionForTarget.jobId);
      setSelectedEdgeId(savedSelectionForTarget.edgeId);
    } else if (targetJobId && data?.nodes.some(node => node.job_id === targetJobId)) {
      setSelectedJobId(targetJobId);
      setSelectedEdgeId(null);
    }
  }, [data, focusRequest, jobs, onSelectionChange, savedSelectionForTarget, targetJobId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<CareerPaths>('/api/career-paths');
      setData(d);
      // 用 ref 读取最新草稿与当前聚焦：请求返回时可能刚刚恢复了本机草稿。
      const saved = savedSelectionFor(targetJobId);
      const preferredId = saved?.jobId || targetJobId;
      const preferredHasPath = preferredId && d.nodes.some(node => node.job_id === preferredId);
      const fallbackId = (preferredHasPath ? preferredId : '') || jobs.find(job => d.nodes.some(node => node.job_id === job.id))?.id || d.nodes[0]?.job_id || '';
      setSelectedJobId(current => current || fallbackId);
      if (!saved && !selectedJobIdRef.current && fallbackId) onSelectionChange({ jobId: fallbackId, edgeId: null, savedAt: null, targetJobId });
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
  const promotionOptions = focusNodes.flatMap(node => {
    const edge = promotionBySource.get(node.id);
    return edge ? [edge] : [];
  });
  const selectedEdge = data?.edges.find(edge => edge.id === selectedEdgeId &&
    (nodeById.get(edge.source)?.job_id === focusJobId || nodeById.get(edge.target)?.job_id === focusJobId)) ?? null;

  function selectJob(jobId: string) {
    userSelected.current = true;
    setSelectedJobId(jobId);
    setSelectedEdgeId(null);
    onSelectionChange({ jobId, edgeId: null, savedAt: null, targetJobId });
  }

  function selectEdge(edgeId: string) {
    userSelected.current = true;
    setSelectedEdgeId(edgeId);
    onSelectionChange({ jobId: focusJobId, edgeId, savedAt: null, targetJobId });
    setPlanFocusRequest(request => request + 1);
  }

  function clearSavedPath() {
    onClearSelection();
    setSelectedEdgeId(null);
    userSelected.current = false;
    const preferred = jobs.some(job => job.id === targetJobId && data?.nodes.some(node => node.job_id === targetJobId))
      ? targetJobId
      : jobs.find(job => data?.nodes.some(node => node.job_id === job.id))?.id || data?.nodes[0]?.job_id || '';
    setSelectedJobId(preferred);
  }

  const selectionSaved = Boolean(savedSelection && savedSelection.jobId === focusJobId && savedSelection.edgeId === (selectedEdge?.id ?? null) && savedSelection.savedAt);

  if (!active && data) return null;
  if (error != null) return <div className="paths-stitch"><ErrorBox error={error} onRetry={load} retryLabel="重新加载路径" /></div>;
  if (loading) return <div className="paths-stitch"><Loading text="正在加载职业路径…" /></div>;
  if (!data) return <div className="paths-stitch"><EmptyState symbol="↝" title="路径图尚未加载"><button className="ghost-button" type="button" onClick={load}>加载职业路径</button></EmptyState></div>;

  return (
    <div className="paths-stitch">
      <section className="paths-hero">
        <h2>成长路径</h2>
        <label className="path-job-select">聚焦岗位<select value={focusJobId} onChange={e => selectJob(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
        <div className="path-overview"><div><small>{STAGE_LABELS[0]}</small><b>{focusNodes[0]?.label || jobName.get(focusJobId) || '起步岗位'}</b></div><span>→</span><div><small>{STAGE_LABELS[1]}</small><b>{focusNodes[1]?.label || '能力进阶'}</b></div><span>→</span><div><small>{STAGE_LABELS[2]}</small><b>{focusNodes[2]?.label || '资深岗位'}</b></div><em>↗</em></div>
      </section>

      <div className="path-flow">
        <section ref={currentPlanRef} className="path-current-plan" tabIndex={-1} aria-label="当前成长计划">
          <header><p>当前成长计划</p><h2>{selectedEdge ? '已选路线' : '选择路线'}</h2></header>
          {selectedEdge ? <EdgeDetail edge={selectedEdge} nodeById={nodeById} /> : <>
            <p className="path-plan-intro">选择成长阶段，查看行动建议。</p>
            <div className="path-route-options">{promotionOptions.map(edge => <button type="button" key={edge.id} onClick={() => selectEdge(edge.id)}>{nodeById.get(edge.source)?.label} → {nodeById.get(edge.target)?.label}<span aria-hidden="true">↗</span></button>)}</div>
            {promotionOptions.length === 0 && <p className="path-plan-intro">暂无晋升路线，可查看转岗和活动。</p>}
          </>}
          <div className="path-action-hub"><div><h3>保存当前规划</h3><p>{selectionSaved ? '已保存于 ' + new Date(savedSelection!.savedAt!).toLocaleString() : '保存岗位与路线；本机留存需开启自动保存。'}</p></div><div className="path-save-actions"><button type="button" className="ghost-button" onClick={() => { onSaveSelection({ jobId: focusJobId, edgeId: selectedEdge?.id ?? null, savedAt: null }); showToast('当前岗位与成长路线已保存到本机草稿'); }}>{selectionSaved ? '更新路线' : '保存路线'}</button>{savedSelection && <button type="button" className="ghost-button" onClick={clearSavedPath}>清除路线</button>}</div></div>
        </section>

        <details className="path-disclosure path-ladder"><summary><span><strong>成长阶段</strong><small>查看各阶段能力要求</small></span><b>{focusNodes.length} 个阶段</b></summary><div className="path-disclosure-body"><div className="path-timeline">{focusNodes.map((node, index) => <TimelineStage key={node.id} node={node} index={index} edge={promotionBySource.get(node.id)} selected={promotionBySource.get(node.id)?.id === selectedEdgeId} onSelect={selectEdge} />)}</div></div></details>

        <details className="path-disclosure path-branches"><summary><span><strong>转岗路线</strong><small>查看其他职业方向</small></span><b>{transitions.length} 条路线</b></summary><div className="path-disclosure-body path-branch-grid">{transitions.length === 0 ? <EmptyState symbol="◌" title="暂无横向路径"><p>当前数据集中没有与该岗位相连的转岗边。</p></EmptyState> : transitions.map((edge, index) => { const a=nodeById.get(edge.source); const b=nodeById.get(edge.target); const target=a?.job_id===focusJobId?b:a; return <button type="button" key={edge.id} className={edge.id===selectedEdgeId?'active':''} aria-pressed={edge.id===selectedEdgeId} onClick={() => selectEdge(edge.id)}><span>方向 {String(index + 1).padStart(2, '0')}</span><h3>{target?.label || '相邻岗位'}</h3><p>{edge.activity || '通过可迁移能力完成岗位切换。'}</p><small>可迁移：{edge.transferable.slice(0,3).join('、') || '待分析'}</small><em aria-hidden="true">↗</em></button>; })}</div></details>

        <details className="path-disclosure path-sprints"><summary><span><strong>实践活动</strong><small>查看学习和实践任务</small></span><b>{actionEdges.length} 项活动</b></summary><div className="path-disclosure-body sprint-list">{actionEdges.length === 0 ? <EmptyState symbol="◌" title="暂无实战任务"><p>当前岗位的路径数据中还没有可执行活动。</p></EmptyState> : actionEdges.map((edge,index) => <button type="button" key={edge.id} aria-pressed={edge.id === selectedEdgeId} onClick={() => selectEdge(edge.id)}><b>{String(index+1).padStart(2,'0')}</b><span><strong>{edge.activity}</strong><small>{edge.type === 'promotion' ? '纵向晋升活动' : '横向转岗活动'} · 待积累：{edge.gaps.join('、') || '综合能力'}</small></span><em>{edge.id === selectedEdgeId ? '已选路线' : '查看路线'}</em></button>)}</div></details>
      </div>
    </div>
  );
}

function TimelineStage({ node, index, edge, selected, onSelect }: { node: PathNode; index: number; edge?: CareerEdge; selected: boolean; onSelect: (id: string) => void }) {
  return <article className={'timeline-stage ' + (index % 2 ? 'reverse' : '')}><div className="timeline-copy"><span>{PHASE_LABELS[index] || '阶段 ' + String(index + 1).padStart(2, '0')}</span><h3>{node.label}</h3><p>{index === 0 ? '夯实岗位基础能力，建立可验证的项目与实践证据。' : index === 1 ? '提升独立交付、复杂问题诊断与跨模块协作能力。' : '形成系统设计、技术决策和团队影响力。'}</p></div><button type="button" className={'timeline-node ' + (selected ? 'active' : '')} disabled={!edge} aria-label={'选择 ' + node.label + ' 的下一阶段路线'} aria-pressed={selected} onClick={() => edge && onSelect(edge.id)}>{String(index + 1).padStart(2, '0')}</button><button type="button" className={'timeline-card ' + (selected ? 'active' : '')} disabled={!edge} aria-pressed={selected} onClick={() => edge && onSelect(edge.id)}><span>{index === 0 ? '基础能力' : index === 1 ? '进阶要求' : '长期成长'}</span>{edge ? <><p><b>可迁移能力</b>{edge.transferable.join('、') || '按当前阶段积累'}</p><p><b>待积累能力</b>{edge.gaps.join('、') || '暂无明确项'}</p><small>{edge.activity || '继续积累真实项目证据'}</small></> : <p>已到路线终点，可探索转岗。</p>}</button></article>;
}

function EdgeDetail({ edge, nodeById }: { edge: CareerEdge; nodeById: Map<string, PathNode> }) {
  return <div className="path-selected-detail"><span>{edge.type === 'promotion' ? '纵向晋升路径' : '横向转岗路径'}</span><h3>{nodeById.get(edge.source)?.label || edge.source} → {nodeById.get(edge.target)?.label || edge.target}</h3><div className="path-next-task"><b>对应建议活动</b><p>{edge.activity || '当前路线尚未提供具体活动。'}</p></div><p><b>可迁移能力：</b>{edge.transferable.join('、') || '暂无明确项'}</p><p><b>待积累能力：</b>{edge.gaps.join('、') || '暂无明确项'}</p><small>路线建议不代表个人能力判断。</small></div>;
}
