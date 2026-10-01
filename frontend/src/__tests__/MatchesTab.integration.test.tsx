// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchesTab from '../components/MatchesTab';
import { apiPost } from '../api';
import { recommendationFor, recommendationsFor, report, student } from './componentFixtures';
import type { MatchItem } from '../types';

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, apiPost: vi.fn() };
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => { resolve = next; });
  return { promise, resolve };
}

function renderMatches(studentRev = 0, nextStudent = student) {
  const freshness = vi.fn();
  return {
    freshness,
    ...render(
    <MatchesTab
      isActive
      student={nextStudent}
      studentRev={studentRev}
      serverAlgorithm="matching-2.2"
      serverDataVersion="data-1"
      showToast={vi.fn()}
      onGoProfile={vi.fn()}
      onGoProfileFocus={vi.fn()}
      onFreshnessChange={freshness}
    />
    )
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('MatchesTab integration', () => {
  it('keeps the last submitted filter result when an earlier request completes late', async () => {
    const requests: Array<{ response: Deferred<ReturnType<typeof recommendationsFor>>; signal?: AbortSignal }> = [];
    vi.mocked(apiPost).mockImplementation((_path, _body, options) => {
      const response = deferred<ReturnType<typeof recommendationsFor>>();
      requests.push({ response, signal: options?.signal });
      return response.promise;
    });
    const user = userEvent.setup();

    renderMatches();
    expect(screen.getByRole('status')).toHaveTextContent('正在计算推荐…');
    await waitFor(() => expect(requests).toHaveLength(1));

    await user.click(screen.getByText(/调整岗位筛选条件/));
    await user.type(screen.getByLabelText('城市'), '上海');
    await user.click(screen.getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal?.aborted).toBe(true);

    await act(async () => { requests[1].response.resolve(recommendationsFor('上海前端工程师')); });
    expect((await screen.findAllByRole('heading', { name: '上海前端工程师' })).length).toBeGreaterThan(0);

    await act(async () => { requests[0].response.resolve(recommendationsFor('旧筛选岗位')); });
    await waitFor(() => expect(screen.queryByRole('heading', { name: '旧筛选岗位' })).not.toBeInTheDocument());
    expect(screen.getByText('城市 上海')).toBeInTheDocument();
    expect(screen.queryByText('正在计算推荐…')).not.toBeInTheDocument();
  });

  it('shows invalid filters without replacing the existing recommendations', async () => {
    vi.mocked(apiPost).mockResolvedValue(recommendationsFor());
    const user = userEvent.setup();

    renderMatches();
    expect((await screen.findAllByRole('heading', { name: '前端工程师' })).length).toBeGreaterThan(0);
    await user.click(screen.getByText(/调整岗位筛选条件/));
    await user.type(screen.getByLabelText('薪资下限'), '10000');
    await user.type(screen.getByLabelText('薪资上限'), '5000');
    await user.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(screen.getByText('薪资下限不能大于上限，请修正后重试。')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: '前端工程师' }).length).toBeGreaterThan(0);
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale recommendations through the in-page action after the profile revision changes', async () => {
    vi.mocked(apiPost).mockResolvedValue(recommendationsFor());
    const user = userEvent.setup();
    const { freshness, rerender } = renderMatches();
    expect((await screen.findAllByRole('heading', { name: '前端工程师' })).length).toBeGreaterThan(0);

    rerender(
      <MatchesTab
        isActive
        student={{ ...student, major: '软件工程' }}
        studentRev={1}
        serverAlgorithm="matching-2.2"
        serverDataVersion="data-1"
        showToast={vi.fn()}
        onGoProfile={vi.fn()}
        onGoProfileFocus={vi.fn()}
        onFreshnessChange={freshness}
      />
    );

    expect(await screen.findByText('简历或资料已变化；旧匹配与建议已过期，请刷新匹配结果。')).toBeInTheDocument();
    expect(freshness).toHaveBeenLastCalledWith('stale', 'not_generated');
    await user.click(screen.getByRole('button', { name: '更新过期结果' }));
    await waitFor(() => expect(freshness).toHaveBeenLastCalledWith('current', 'not_generated'));
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenLastCalledWith('/api/recommendations', expect.objectContaining({
      student: expect.objectContaining({ major: '软件工程' })
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.queryByRole('button', { name: '更新过期结果' })).not.toBeInTheDocument();
  });

  it('updates the overview and discards the previous report when another candidate is selected', async () => {
    const missing: MatchItem = {
      tag_id: 'vue', label: 'Vue', dimension: 'skills', required_level: 1,
      status: 'pending', pending_reason: 'not_provided', student_level: null, student_evidence: '',
      contribution: 0.25, enhancement_basis: 'related', related_only: false
    };
    const nextCandidate = recommendationFor('数据分析师');
    nextCandidate.job_id = 'data-analyst';
    nextCandidate.match = {
      ...nextCandidate.match, job_id: nextCandidate.job_id, input_version: 'input-2',
      basic: 50, enhanced: 62.5, required: 2, pending_items: [missing],
      items: [...nextCandidate.match.items, missing]
    };
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ ...recommendationsFor(), items: [recommendationFor(), nextCandidate], candidate_count: 2 })
      .mockResolvedValueOnce(report);
    const user = userEvent.setup();
    renderMatches();
    await screen.findByRole('button', { name: /数据分析师/ });
    await user.click(screen.getByRole('button', { name: '生成岗位建议' }));
    expect(await screen.findByRole('button', { name: '导出报告TXT' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /数据分析师/ }));
    const overview = screen.getByRole('region', { name: '岗位匹配概览' });
    expect(within(overview).getByRole('heading', { name: '数据分析师' })).toBeInTheDocument();
    expect(within(overview).getByText('50')).toBeInTheDocument();
    expect(within(overview).getByText('62.5')).toBeInTheDocument();
    expect(within(overview).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /数据分析师/, pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出报告TXT' })).not.toBeInTheDocument();
    expect(screen.queryByText(report.advice.fit_evaluation)).not.toBeInTheDocument();
  });

  it('opens and focuses the filters from the empty result action so the user can recover', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ ...recommendationsFor(), items: [], candidate_count: 0 })
      .mockResolvedValue(recommendationsFor());
    const user = userEvent.setup();
    renderMatches();
    await user.click(await screen.findByRole('button', { name: '调整筛选条件' }));
    expect(screen.getByLabelText('城市')).toBeVisible();
    expect(screen.getByLabelText('城市')).toHaveFocus();
    await user.type(screen.getByLabelText('城市'), '上海');
    await user.click(screen.getByRole('button', { name: '应用筛选' }));
    expect((await screen.findAllByRole('heading', { name: '前端工程师' })).length).toBeGreaterThan(0);
    expect(apiPost).toHaveBeenLastCalledWith('/api/recommendations', expect.objectContaining({
      filters: expect.objectContaining({ city: '上海' })
    }), expect.anything());
  });
});
