import { useEffect, useState } from 'react';
import { apiGet, errMessage } from '../api';
import type { CareerPaths, PathNode } from '../types';
import { EmptyState, ErrorBox, Loading } from './ui';

const COL_W = 128;
const NODE_W = 112;
const NODE_H = 48;
const ROW_H = 128;
const TOP = 26;
const STAGE_LABELS = ['起步阶段', '进阶阶段', '资深阶段'];

interface LayoutNode extends PathNode {
  col: number;
  x: number;
  y: number;
  cx: number;
}

function buildLayout(nodes: PathNode[], jobs: Array<{ id: string; name: string }>): LayoutNode[] {
  const jobIndex = new Map(jobs.map((j, i) => [j.id, i]));
  return nodes.map(n => {
    const col = jobIndex.get(n.job_id) ?? 0;
    return { ...n, col, x: col * COL_W + 8, y: TOP + n.stage * ROW_H, cx: col * COL_W + 8 + NODE_W / 2 };
  });
}

function promotePath(a: LayoutNode, b: LayoutNode): string {
  const y1 = a.y + NODE_H;
  const y2 = b.y;
  const mid = (y1 + y2) / 2;
  return `M ${a.cx} ${y1} L ${a.cx} ${mid - 6} M ${a.cx - 5} ${mid - 12} L ${a.cx} ${mid - 4} L ${a.cx + 5} ${mid - 12} M ${a.cx} ${mid - 4} L ${a.cx} ${y2}`;
}

function transitionPath(a: LayoutNode, b: LayoutNode): string {
  const y = a.y + NODE_H;
  const dip = y + 26;
  const x1 = a.cx;
  const x2 = b.cx;
  return `M ${x1} ${y} C ${x1} ${dip}, ${x2} ${dip}, ${x2} ${y}`;
}

export default function PathsTab({ active, jobs, showToast }: {
  active: boolean;
  jobs: Array<{ id: string; name: string }>;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
}) {
  const [data, setData] = useState<CareerPaths | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    if (active && !data && !loading && error == null) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<CareerPaths>('/api/career-paths');
      setData(d);
    } catch (e) {
      setError(e);
      showToast('路径加载失败：' + errMessage(e), 'err');
    } finally {
      setLoading(false);
    }
  }

  if (!active && data) return null;
  if (error != null) {
    return (
      <div className="panel-section">
        <div className="section-head"><div><p className="eyebrow">CAREER MAP</p><h2>路径与换岗</h2></div></div>
        <ErrorBox error={error} onRetry={load} retryLabel="重新加载路径" />
      </div>
    );
  }
  if (loading) {
    return <div className="panel-section"><Loading text="正在加载职业路径…" /></div>;
  }
  if (!data) {
    return (
      <div className="panel-section">
        <div className="section-head"><div><p className="eyebrow">CAREER MAP</p><h2>路径与换岗</h2></div></div>
        <EmptyState symbol="↝" title="路径图尚未加载">
          <button className="ghost-button" type="button" onClick={load}>加载职业路径</button>
        </EmptyState>
      </div>
    );
  }

  const layout = buildLayout(data.nodes, jobs);
  const nodeById = new Map(layout.map(n => [n.id, n]));
  const jobName = new Map(jobs.map(j => [j.id, j.name]));
  const selectedEdge = data.edges.find(e => e.id === selectedEdgeId) ?? null;
  const width = COL_W * Math.max(jobs.length, 1);
  const height = TOP + 3 * ROW_H;
  const transitions = data.edges.filter(e => e.type === 'transition');
  const promotions = data.edges.filter(e => e.type === 'promotion');

  return (
    <div className="panel-section">
      <div className="section-head">
        <div>
          <p className="eyebrow">CAREER MAP</p>
          <h2>晋升与换岗路线</h2>
        </div>
        <span className="count-badge">{promotions.length} PROMOTIONS · {transitions.length} TRANSITIONS</span>
      </div>
      <div className="path-legend">
        <span><i className="legend-dot" />晋升（同岗位向上）</span>
        <span><i className="legend-dot transition" />换岗（跨岗位移动）</span>
        <span className="mono">点击节点或连线查看说明</span>
      </div>
      <div className="card path-card">
        <svg className="path-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="职业路径图：6 个岗位三阶段，绿实线为晋升，橙虚线为换岗">
          {STAGE_LABELS.map((s, i) => (
            <text key={s} x={2} y={TOP + i * ROW_H - 8} className="path-stage-label">{s}</text>
          ))}
          {data.edges.map(e => {
            const a = nodeById.get(e.source);
            const b = nodeById.get(e.target);
            if (!a || !b) return null;
            const sel = e.id === selectedEdgeId;
            const cls = 'path-edge ' + e.type + (sel ? ' selected' : '');
            const label = e.type === 'promotion'
              ? `晋升到 ${b.label}`
              : `换岗到 ${b.label}`;
            return (
              <g key={e.id}>
                <path
                  className={cls}
                  d={e.type === 'promotion' ? promotePath(a, b) : transitionPath(a, b)}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onClick={() => setSelectedEdgeId(e.id)}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedEdgeId(e.id); } }}
                />
              </g>
            );
          })}
          {layout.map(n => (
            <g
              key={n.id}
              className="path-node-group"
              tabIndex={0}
              role="button"
              aria-label={`${n.label}（${STAGE_LABELS[n.stage] ?? '阶段 ' + n.stage}）`}
              onClick={() => showToast(n.label + '：' + (jobName.get(n.job_id) ?? '') + ' · ' + (STAGE_LABELS[n.stage] ?? ''))}
              onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showToast(n.label + '：' + (jobName.get(n.job_id) ?? '') + ' · ' + (STAGE_LABELS[n.stage] ?? '')); } }}
            >
              <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={8} className={'path-rect' + (n.stage === 0 ? ' base' : n.stage === 2 ? ' senior' : '')} />
              <text x={n.x + NODE_W / 2} y={n.y + NODE_H / 2 - 3} className="path-node-title" textAnchor="middle">{n.label}</text>
              <text x={n.x + NODE_W / 2} y={n.y + NODE_H / 2 + 13} className="path-node-sub" textAnchor="middle">{STAGE_LABELS[n.stage] ?? ''}</text>
            </g>
          ))}
        </svg>
        {selectedEdge && (
          <div className="path-detail" role="status">
            <h4>
              {selectedEdge.type === 'promotion' ? '晋升路径' : '换岗路径'}：
              {nodeById.get(selectedEdge.source)?.label ?? selectedEdge.source}
              →
              {nodeById.get(selectedEdge.target)?.label ?? selectedEdge.target}
            </h4>
            <p><b>可迁移能力：</b>{selectedEdge.transferable.join('、') || '无'}</p>
            <p><b>需要补齐：</b>{selectedEdge.gaps.join('、') || '无'}</p>
            <p><b>建议活动：</b>{selectedEdge.activity || '—'}</p>
            <p className="mono">{selectedEdge.source_type}</p>
          </div>
        )}
      </div>
      <div className="card transition-card">
        <h4>换岗路径清单 · {transitions.length} 条</h4>
        <p className="soft-note">换岗路径基于岗位能力重叠推导，只作参考建议；点击图中连线或下方条目可查看迁移能力与差距。</p>
        {transitions.map(e => (
          <button
            type="button"
            key={e.id}
            className={'transition-item' + (e.id === selectedEdgeId ? ' selected' : '')}
            onClick={() => setSelectedEdgeId(e.id)}
          >
            <b>{nodeById.get(e.source)?.label} → {nodeById.get(e.target)?.label}</b>
            <span>迁移：{e.transferable.join('、') || '—'} · 差距：{e.gaps.join('、') || '—'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
