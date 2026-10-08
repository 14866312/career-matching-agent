// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import careerData from '../../../backend/data/career-data.json';
import { apiGet } from '../api';
import PathsTab from '../components/PathsTab';
import type { CareerPaths } from '../types';
import type { PathSelection } from '../lib/localDraft';

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, apiGet: vi.fn() };
});

const paths = careerData.paths as CareerPaths;
const jobs = careerData.jobs.map(({ id, name }) => ({ id, name }));
const nodeById = new Map(paths.nodes.map(node => [node.id, node]));

function renderPaths(savedSelection: PathSelection | null = null) {
  const props = {
    active: true, jobs, targetJobId: 'frontend', focusRequest: null, savedSelection,
    showToast: vi.fn(), onSelectionChange: vi.fn(),
    onClearSelection: vi.fn(), onSaveSelection: vi.fn(),
  };
  return { props, ...render(<PathsTab {...props} />) };
}

beforeEach(() => {
  vi.mocked(apiGet).mockResolvedValue(paths);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PathsTab integration', () => {
  it('keeps a concise five-stage overview and includes standards at the final stage', async () => {
    const user = userEvent.setup();
    const { container } = renderPaths();
    const overview = await screen.findByRole('list', { name: '岗位成长阶段' });
    expect(within(overview).getAllByRole('listitem')).toHaveLength(5);
    for (const disclosure of container.querySelectorAll('.path-disclosure')) {
      expect(disclosure).not.toHaveAttribute('open');
    }
    await user.click(screen.getByText('成长阶段', { exact: true }));
    const stages = container.querySelectorAll<HTMLElement>('.timeline-stage');
    expect(stages).toHaveLength(5);
    expect(within(stages[0]).getByText(nodeById.get('frontend')!.activity)).toBeVisible();
    const finalNode = nodeById.get('frontend-2')!;
    const finalStage = within(stages[4]);
    expect(finalStage.getByRole('heading', { name: finalNode.stage_label })).toBeVisible();
    expect(finalStage.getByText(finalNode.goal)).toBeVisible();
    for (const item of [...finalNode.standards, ...finalNode.criteria]) {
      expect(finalStage.getByText(item)).toBeVisible();
    }
    expect(finalStage.getByText('阶段验收')).toBeVisible();
    expect(finalStage.queryAllByRole('button')).toHaveLength(0);
  });

  it('connects a selected next-stage task with its standards and the source-stage conditions', async () => {
    const user = userEvent.setup();
    const { props, container } = renderPaths();
    await screen.findByRole('list', { name: '岗位成长阶段' });
    await user.click(container.querySelectorAll<HTMLButtonElement>('.path-route-options button')[1]);
    const edge = paths.edges.find(item => item.id === 'frontend-promotion-0')!;
    const source = nodeById.get(edge.source)!;
    const target = nodeById.get(edge.target)!;
    const plan = screen.getByRole('region', { name: '当前成长计划' });
    expect(plan).toHaveFocus();
    expect(within(plan).getByRole('heading', { name: `${source.stage_label} → ${target.stage_label}` })).toBeVisible();
    expect(within(plan).getByText(edge.activity)).toBeVisible();
    const lists = within(plan).getAllByRole('list');
    expect(within(lists[0]).getAllByRole('listitem').map(item => item.textContent)).toEqual(target.standards);
    expect(within(lists[1]).getAllByRole('listitem').map(item => item.textContent)).toEqual(source.criteria);
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      jobId: 'frontend', edgeId: edge.id, savedAt: null, targetJobId: 'frontend',
    });
    await user.click(within(plan).getByRole('button', { name: '保存路线' }));
    expect(props.onSaveSelection).toHaveBeenCalledWith({ jobId: 'frontend', edgeId: edge.id, savedAt: null });
  });

  it.each(['frontend-promotion-0', 'frontend-promotion-1'])('restores the historical goal for %s', async edgeId => {
    const edge = paths.edges.find(item => item.id === edgeId)!;
    const source = nodeById.get(edge.source)!;
    const target = nodeById.get(edge.target)!;
    const { props } = renderPaths({
      jobId: 'frontend', edgeId, savedAt: '2026-10-08T01:00:00Z', targetJobId: 'frontend',
    });
    await screen.findByRole('heading', { name: `${source.stage_label} → ${target.stage_label}` });
    expect(within(screen.getByRole('region', { name: '当前成长计划' })).getByText(edge.activity)).toBeVisible();
    expect(screen.getByRole('button', { name: '更新路线' })).toBeVisible();
    expect(props.onSelectionChange).not.toHaveBeenCalled();
  });

  it('switches to role-specific guidance and clears the previous route', async () => {
    const user = userEvent.setup();
    const { props, container } = renderPaths({
      jobId: 'frontend', edgeId: 'frontend-promotion-0', savedAt: null, targetJobId: 'frontend',
    });
    await screen.findByRole('list', { name: '岗位成长阶段' });
    await user.selectOptions(screen.getByRole('combobox', { name: '聚焦岗位' }), 'testing');
    const overview = screen.getByRole('list', { name: '岗位成长阶段' });
    const testingNodes = paths.nodes.filter(node => node.job_id === 'testing');
    for (const node of testingNodes) {
      expect(within(overview).getByText(node.goal)).toBeVisible();
    }
    expect(container.querySelector('.path-selected-detail')).toBeNull();
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({
      jobId: 'testing', edgeId: null, savedAt: null, targetJobId: 'frontend',
    });
    expect(container.querySelectorAll('.path-route-options button')).toHaveLength(4);
  });
});
