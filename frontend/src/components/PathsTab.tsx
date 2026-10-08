import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiGet, errMessage } from '../api';
import type { CareerPaths, CareerEdge, PathNode } from '../types';
import { EmptyState, ErrorBox, Loading } from './ui';
import type { PathSelection } from '../lib/localDraft';

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

  const focusJobId = selectedJobId || jobs[0]?.id || data?.nodes[0]?.job_id || '';
  const focusNodes = useMemo(() => (data?.nodes ?? []).filter(n => n.job_id === focusJobId).sort((a, b) => a.stage - b.stage), [data, focusJobId]);
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map(n => [n.id, n])), [data]);
  const promotionBySource = useMemo(() => new Map((data?.edges ?? []).filter(e => e.type === 'promotion').map(e => [e.source, e])), [data]);
  const transitions = useMemo(() => (data?.edges ?? []).filter(e => e.type === 'transition' && (nodeById.get(e.source)?.job_id === focusJobId || nodeById.get(e.target)?.job_id === focusJobId)), [data, nodeById, focusJobId]);
  const actionEdges = useMemo(() => (data?.edges ?? []).filter(edge =>
    edge.activity && (nodeById.get(edge.source)?.job_id === focusJobId || nodeById.get(edge.target)?.job_id === focusJobId)
  ), [data, nodeById, focusJobId]);
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
        <ol className="path-overview path-overview-stages" aria-label="岗位成长阶段">
          {focusNodes.map((node, index) => <li key={node.id}>
            <small>阶段 {String(index + 1).padStart(2, '0')}</small>
            <b>{node.stage_label}</b>
            <p>{node.goal}</p>
          </li>)}
        </ol>
      </section>

      <div className="path-flow">
        <section ref={currentPlanRef} className="path-current-plan" tabIndex={-1} aria-label="当前成长计划">
          <header><p>当前成长计划</p><h2>{selectedEdge ? '已选路线' : '选择路线'}</h2></header>
          {selectedEdge ? <EdgeDetail edge={selectedEdge} nodeById={nodeById} /> : <>
            <p className="path-plan-intro">选择下一步，查看实践任务与进阶条件。</p>
            <div className="path-route-options">{promotionOptions.map(edge => <button type="button" key={edge.id} onClick={() => selectEdge(edge.id)}>
              <span className="path-route-copy"><b>{nodeById.get(edge.source)?.stage_label} → {nodeById.get(edge.target)?.stage_label}</b><small>{nodeById.get(edge.target)?.goal}</small></span>
              <span aria-hidden="true">↗</span>
            </button>)}</div>
            {promotionOptions.length === 0 && <p className="path-plan-intro">暂无晋升路线，可查看转岗和活动。</p>}
          </>}
          <div className="path-action-hub"><div><h3>保存当前规划</h3><p>{selectionSaved ? '已保存于 ' + new Date(savedSelection!.savedAt!).toLocaleString() : '保存岗位与路线；本机留存需开启自动保存。'}</p></div><div className="path-save-actions"><button type="button" className="ghost-button" onClick={() => { onSaveSelection({ jobId: focusJobId, edgeId: selectedEdge?.id ?? null, savedAt: null }); showToast('当前岗位与成长路线已保存到本机草稿'); }}>{selectionSaved ? '更新路线' : '保存路线'}</button>{savedSelection && <button type="button" className="ghost-button" onClick={clearSavedPath}>清除路线</button>}</div></div>
        </section>

        <details className="path-disclosure path-ladder">
          <summary><span><strong>成长阶段</strong><small>查看目标、标准与进阶条件</small></span><b>{focusNodes.length} 个阶段</b></summary>
          <div className="path-disclosure-body">
            <p className="path-guidance-note">{data.note}</p>
            <div className="path-timeline">{focusNodes.map((node, index) => <TimelineStage key={node.id} node={node} index={index} edge={promotionBySource.get(node.id)} selected={promotionBySource.get(node.id)?.id === selectedEdgeId} onSelect={selectEdge} />)}</div>
          </div>
        </details>

        <details className="path-disclosure path-branches"><summary><span><strong>转岗路线</strong><small>查看其他职业方向</small></span><b>{transitions.length} 条路线</b></summary><div className="path-disclosure-body path-branch-grid">{transitions.length === 0 ? <EmptyState symbol="◌" title="暂无横向路径"><p>当前数据集中没有与该岗位相连的转岗边。</p></EmptyState> : transitions.map((edge, index) => { const a=nodeById.get(edge.source); const b=nodeById.get(edge.target); const target=a?.job_id===focusJobId?b:a; return <button type="button" key={edge.id} className={edge.id===selectedEdgeId?'active':''} aria-pressed={edge.id===selectedEdgeId} onClick={() => selectEdge(edge.id)}><span>方向 {String(index + 1).padStart(2, '0')}</span><h3>{target?.label || '相邻岗位'}</h3><p>{edge.activity || '通过可迁移能力完成岗位切换。'}</p><small>可迁移：{edge.transferable.slice(0,3).join('、') || '待分析'}</small><em aria-hidden="true">↗</em></button>; })}</div></details>

        <details className="path-disclosure path-sprints"><summary><span><strong>实践活动</strong><small>查看学习和实践任务</small></span><b>{actionEdges.length} 项活动</b></summary><div className="path-disclosure-body sprint-list">{actionEdges.length === 0 ? <EmptyState symbol="◌" title="暂无实战任务"><p>当前岗位的路径数据中还没有可执行活动。</p></EmptyState> : actionEdges.map((edge,index) => <button type="button" key={edge.id} aria-pressed={edge.id === selectedEdgeId} onClick={() => selectEdge(edge.id)}><b>{String(index+1).padStart(2,'0')}</b><span><strong>{edge.activity}</strong><small>{edge.type === 'promotion' ? '阶段实践 · ' + nodeById.get(edge.target)?.stage_label : '转岗实践 · ' + (nodeById.get(edge.source)?.job_id === focusJobId ? nodeById.get(edge.target)?.label : nodeById.get(edge.source)?.label)}</small></span><em>{edge.id === selectedEdgeId ? '已选路线' : '查看路线'}</em></button>)}</div></details>
      </div>
    </div>
  );
}

function TimelineStage({ node, index, edge, selected, onSelect }: { node: PathNode; index: number; edge?: CareerEdge; selected: boolean; onSelect: (id: string) => void }) {
  const number = String(index + 1).padStart(2, '0');
  return <article className={'timeline-stage ' + (index % 2 ? 'reverse' : '')}>
    <div className="timeline-copy"><span>阶段 {number}</span><h3>{node.stage_label}</h3><p>{node.goal}</p><p className="timeline-practice"><b>实践：</b>{node.activity}</p></div>
    {edge ? <button type="button" className={'timeline-node ' + (selected ? 'active' : '')} aria-label={'选择 ' + node.stage_label + ' 的下一阶段路线'} aria-pressed={selected} onClick={() => onSelect(edge.id)}>{number}</button> : <span className="timeline-node">{number}</span>}
    <div className={'timeline-card ' + (selected ? 'active' : '')}>
      <GuidanceList label="能力标准" items={node.standards} />
      <GuidanceList label={edge ? '进阶条件' : '阶段验收'} items={node.criteria} />
      {edge ? <button type="button" className="timeline-next-step" aria-label={'从' + node.stage_label + '规划下一步'} aria-pressed={selected} onClick={() => onSelect(edge.id)}>规划下一步 ↗</button> : <small>持续实践，深化专业影响</small>}
    </div>
  </article>;
}

function EdgeDetail({ edge, nodeById }: { edge: CareerEdge; nodeById: Map<string, PathNode> }) {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  const promotion = edge.type === 'promotion';
  return <div className="path-selected-detail">
    <span>{promotion ? '阶段进阶路线' : '横向转岗路线'}</span>
    <h3>{(promotion ? source?.stage_label : source?.label) || edge.source} → {(promotion ? target?.stage_label : target?.label) || edge.target}</h3>
    {promotion && target && <p className="path-target-goal"><b>核心目标：</b>{target.goal}</p>}
    <div className="path-next-task"><b>下一步实践</b><p>{edge.activity || '当前路线尚未提供具体活动。'}</p></div>
    {promotion && source && target ? <div className="path-plan-standards">
      <GuidanceList label={target.stage_label + ' · 能力标准'} items={target.standards} />
      <GuidanceList label={'进阶条件 · 完成' + source.stage_label} items={source.criteria} />
    </div> : <>
      <p><b>可迁移能力：</b>{edge.transferable.join('、') || '暂无明确项'}</p>
      <p><b>建议积累：</b>{edge.gaps.join('、') || '暂无明确项'}</p>
    </>}
    <small>路线建议不代表个人能力判断或晋升承诺。</small>
  </div>;
}

function GuidanceList({ label, items }: { label: string; items: string[] }) {
  return <div className="path-guidance-list"><b>{label}</b><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>;
}
