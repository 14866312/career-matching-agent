// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPostForm } from '../api';
import ProfileTab from '../components/ProfileTab';
import { createLocalDraft } from '../lib/localDraft';
import type { StudentProfile } from '../types';
import { jobs, resumeResponse, student } from './componentFixtures';

vi.mock('../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, apiGet: vi.fn(), apiPostForm: vi.fn() };
});

function ProfileHarness() {
  const [profile, setProfile] = useState<StudentProfile>(student);
  const [resumeName, setResumeName] = useState('');
  const revRef = useRef(0);
  const apply = (next: StudentProfile) => {
    revRef.current += 1;
    setProfile(next);
  };

  return <>
    <ProfileTab
      student={profile}
      resumeName={resumeName}
      setResumeName={setResumeName}
      updateStudent={fn => apply(fn(profile))}
      editStudent={fn => {
        const result = fn(profile);
        if (result.next !== profile) apply(result.next);
        return result.notes ?? [];
      }}
      replaceStudent={apply}
      revRef={revRef}
      jobs={jobs}
      analysis={null}
      setAnalysis={vi.fn()}
      showToast={vi.fn()}
      onGoMatches={vi.fn()}
      onSetTargetJob={vi.fn()}
      sourceModeRequest={null}
      onSourceModeRequestHandled={vi.fn()}
      focusTarget={null}
      onFocusHandled={vi.fn()}
    />
    <output aria-label="当前资料">{JSON.stringify(profile)}</output>
    <output aria-label="本机草稿">{JSON.stringify(createLocalDraft(profile, 'profile', null, '2026-10-01T00:00:00.000Z'))}</output>
  </>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfileTab integration', () => {
  it('keeps a parsed resume name in the session while profile and local draft stay name-free', async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [] });
    vi.mocked(apiPostForm).mockResolvedValue(resumeResponse);
    const user = userEvent.setup();

    render(<ProfileHarness />);
    const resume = new File(['模拟简历内容'], 'resume.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('选择简历文件'), resume);

    await waitFor(() => expect(screen.getByLabelText('简历姓名')).toHaveValue('王同学'));
    expect(screen.getByLabelText('当前资料')).toHaveTextContent('React');
    expect(screen.getByLabelText('当前资料')).not.toHaveTextContent('王同学');
    expect(screen.getByLabelText('本机草稿')).not.toHaveTextContent('王同学');
  });
});
