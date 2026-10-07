// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiGet, apiPost } from '../api';
import { AUTOSAVE_STORAGE_KEY, DRAFT_STORAGE_KEY, createLocalDraft } from '../lib/localDraft';
import { ONBOARDING_STORAGE_KEY } from '../lib/onboarding';
import { jobs, recommendationsFor, report, student } from './componentFixtures';

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiPostForm: vi.fn() };
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '#jobs');
  window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, 'true');
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
    version: 1, outcome: 'completed', savedAt: '2026-10-01T00:00:00.000Z'
  }));
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(createLocalDraft(student, 'profile', null, '2026-10-01T00:00:00.000Z')));
  vi.mocked(apiGet).mockImplementation(path => {
    if (path === '/api/health') return Promise.resolve({
      status: 'ok', data_version: 'data-1', algorithm_version: 'matching-2.2',
      llm_configured: false, llm_model: '', source_file: 'fixture'
    });
    if (path === '/api/jobs') return Promise.resolve({ items: jobs });
    if (path === '/api/tags') return Promise.resolve({ items: [] });
    if (path === '/api/career-paths') return Promise.resolve({ nodes: [], edges: [] });
    return Promise.reject(new Error('Unexpected GET ' + path));
  });
  vi.mocked(apiPost).mockImplementation(path => {
    if (path === '/api/recommendations') return Promise.resolve(recommendationsFor());
    if (path === '/api/reports') return Promise.resolve(report);
    return Promise.reject(new Error('Unexpected POST ' + path));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('App integration', () => {
  it('starts without an active workflow step and highlights only the selected step', async () => {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    const user = userEvent.setup();
    render(<App />);
    const guide = screen.getByRole('complementary', { name: '流程导航' });
    const steps = within(guide).getAllByRole('button').slice(0, 4);
    expect(guide.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    for (const step of steps) {
      await user.click(step);
      expect(step).toHaveAttribute('aria-current', 'step');
      expect(guide.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    }

    for (const name of ['成长路径', '职业探索']) {
      await user.click(screen.getByRole('tab', { name: new RegExp(name) }));
      expect(guide.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    }
    await user.click(within(guide).getByRole('button', { name: '下一步：导入简历或填写资料' }));
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
  });

  it('does not activate a step when restoring a draft or opening a page directly', async () => {
    const app = render(<App />);
    await waitFor(() => expect(document.querySelector('.exploration-pages')).toHaveAttribute('data-active-page', 'profile'));
    expect(document.querySelectorAll('.workflow-guide [aria-current="step"]')).toHaveLength(0);
    app.unmount();
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, 'false');
    window.history.replaceState(null, '', '#matches');
    render(<App />);
    expect(document.querySelectorAll('.workflow-guide [aria-current="step"]')).toHaveLength(0);
  });

  it('switches between dark and eye-friendly light themes and remembers the selection', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    const shell = document.querySelector('.exploration-shell');

    expect(shell).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: '切换到白色护眼模式' }));
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('career-planning-theme')).toBe('light');

    app.unmount();
    render(<App />);
    expect(document.querySelector('.exploration-shell')).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: '切换到深色模式' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores a local draft and marks matching plus advice stale after the profile changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    const profilePanel = document.getElementById('page-profile');
    expect(profilePanel).not.toBeNull();
    expect(await within(profilePanel!).findByText('专业 · 计算机科学与技术')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /匹配报告/ }));
    expect((await screen.findAllByRole('heading', { name: '前端工程师' })).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '生成岗位建议' }));
    expect(await screen.findByText('当前资料已覆盖岗位的核心要求。')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /简历与个人报告/ }));
    await user.click(within(profilePanel!).getByRole('tab', { name: '手动填写' }));
    await user.clear(within(profilePanel!).getByLabelText('专业'));
    await user.type(within(profilePanel!).getByLabelText('专业'), '软件工程');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '3. 岗位匹配：已过期' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '4. 行动建议：已过期' })).toBeInTheDocument();
    });
  });

  it('can navigate back to matching after clearing a session from that tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    const pages = document.querySelector('.exploration-pages');
    expect(pages).not.toBeNull();
    await user.click(screen.getByRole('tab', { name: /匹配报告/ }));
    await waitFor(() => expect(pages).toHaveAttribute('data-active-page', 'matches'));

    await user.click(screen.getByRole('button', { name: '设置' }));
    const settings = await screen.findByRole('dialog', { name: '本机数据设置' });
    await user.click(within(settings).getByRole('button', { name: '清除草稿并重置' }));
    await waitFor(() => expect(pages).toHaveAttribute('data-active-page', 'jobs'));
    expect(document.querySelectorAll('.workflow-guide [aria-current="step"]')).toHaveLength(0);

    await user.click(screen.getByRole('tab', { name: /匹配报告/ }));
    await waitFor(() => expect(pages).toHaveAttribute('data-active-page', 'matches'));
  });
});
