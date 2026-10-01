// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MatchesTab from '../components/MatchesTab';
import { apiPost } from '../api';
import { recommendationsFor, student } from './componentFixtures';

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

  it('marks recommendations stale after the profile revision changes', async () => {
    vi.mocked(apiPost).mockResolvedValue(recommendationsFor());
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
  });
});
