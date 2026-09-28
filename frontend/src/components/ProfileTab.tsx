import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPostForm, errMessage } from '../api';
import type { Ability, Dimension, JobSummary, ProfileResp, ResumeResp, StudentProfile, TagDef } from '../types';
import { levelLabel } from '../format';
import { EmptyState, ErrorBox } from './ui';
import { createResumeCandidates, mergeAcceptedResumeCandidates, resumeCandidateConflict, type CandidateDecision, type ResumeCandidate } from '../lib/resumeReview';
import type { ProfileFocusTarget } from '../types';

export interface DimensionConfig {
  key: Dimension;
  label: string;
  max: number;
  levels: boolean;
  placeholder: string;
}

export const DIM_CONFIGS: DimensionConfig[] = [
  { key: 'skills', label: '技能标签', max: 100, levels: true, placeholder: '输入技能后回车，例如 JavaScript' },
  { key: 'certificates', label: '证书', max: 50, levels: false, placeholder: '例如：软考程序员、CET-6' },
  { key: 'qualities', label: '通用素质', max: 50, levels: false, placeholder: '例如：客户沟通、文档编写' }
];

function TagEditor({ cfg, items, dict, onAdd, onPatch, onRemove, focusTarget, onFocusHandled }: {
  cfg: DimensionConfig;
  items: Ability[];
  dict: TagDef[];
  onAdd: (text: string) => void;
  onPatch: (index: number, patch: Partial<Ability>) => void;
  onRemove: (index: number) => void;
  focusTarget: ProfileFocusTarget | null;
  onFocusHandled: () => void;
}) {
  const [text, setText] = useState('');
  const [evOpen, setEvOpen] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const knownIds = new Set(dict.map(t => t.id));
  const listId = 'dict-' + cfg.key;
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  useEffect(() => {
    if (!focusTarget || focusTarget.dimension !== cfg.key) return;
    const existing = items.find(item => item.tag_id.toLowerCase() === focusTarget.tag_id.toLowerCase());
    if (!existing || focusTarget.reason === 'not_provided') {
      setText(focusTarget.label);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      const key = existing.tag_id;
      setEvOpen(open => ({ ...open, [key]: true }));
      window.setTimeout(() => {
        const evidence = document.getElementById('evidence-' + cfg.key + '-' + encodeURIComponent(key));
        evidence?.focus();
        evidence?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
    onFocusHandled();
  }, [cfg.key, focusTarget?.token]);
  return (
    <div className="tag-editor">
      <div className="editor-title">
        <span>{cfg.label}</span>
        <span className="mono">{items.length} / {cfg.max}</span>
      </div>
      <div className="tag-input">
        <input
          ref={inputRef}
          id={'ability-input-' + cfg.key}
          value={text}
          placeholder={cfg.placeholder}
          maxLength={100}
          list={listId}
          aria-label={'新增' + cfg.label}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <datalist id={listId}>
          {dict.map(t => (
            <option key={t.id} value={t.label}>{t.aliases.length ? '别名：' + t.aliases.join('、') : t.id}</option>
          ))}
        </datalist>
        <button type="button" onClick={submit} aria-label={'确认添加' + cfg.label}>添加</button>
      </div>
      <div className="tag-list" aria-live="polite">
        {items.length === 0 && <span className="tag-empty">暂无内容：可手动添加，或导入简历后确认</span>}
        {items.map((x, i) => {
          const known = knownIds.has(x.tag_id);
          const open = !!evOpen[x.tag_id];
          return (
            <div className={'tag-row' + (open ? ' expanded' : '')} key={x.tag_id + i}>
              <span className={'editable-tag' + (x.evidence ? ' has-evidence' : '')}>
                <span className="tag-label">{x.label}</span>
                {!known && (
                  <span className="pill warn" title="该标签不在岗位要求字典中，可能无法计入匹配分，建议改用字典中的标签">
                    未入字典
                  </span>
                )}
                {x.evidence && (
                  <span className="evidence-dot" tabIndex={0} role="img" aria-label="有原文证据" title={'原文证据：' + x.evidence}>◆</span>
                )}
                <span className={'pill ' + (x.confirmed && x.level === 0 ? 'warn' : x.confirmed && x.evidence.trim() ? 'ok' : 'pending')}>
                  {!x.confirmed ? '待确认' : x.level === 0 ? '已确认不具备' : !x.evidence.trim() ? '缺少证据' : '已确认有证据'}
                </span>
                {cfg.levels ? (
                  <select
                    value={x.level}
                    aria-label={x.label + ' 熟练度'}
                    onChange={e => onPatch(i, { level: Number(e.target.value) })}
                  >
                    {[0, 1, 2, 3].map(v => <option key={v} value={v}>{v} · {levelLabel(v)}</option>)}
                  </select>
                ) : (
                  <select
                    value={x.level >= 1 ? 1 : 0}
                    aria-label={x.label + ' 具备情况'}
                    onChange={e => onPatch(i, { level: Number(e.target.value) })}
                  >
                    <option value={1}>1 · 具备</option>
                    <option value={0}>0 · 不具备</option>
                  </select>
                )}
                <button
                  type="button"
                  className={'tag-evidence-toggle' + (open ? ' open' : '')}
                  aria-expanded={open}
                  aria-label={(open ? '收起 ' : '编辑 ') + x.label + ' 证据'}
                  onClick={() => setEvOpen(o => ({ ...o, [x.tag_id]: !o[x.tag_id] }))}
                >
                  证据
                </button>
                <button type="button" aria-label={'移除 ' + x.label} onClick={() => onRemove(i)}>×</button>
              </span>
              {open && (
                <div className="tag-evidence">
                  <input
                    id={'evidence-' + cfg.key + '-' + encodeURIComponent(x.tag_id)}
                    tabIndex={0}
                    value={x.evidence}
                    maxLength={3000}
                    placeholder="粘贴支持该能力的原文片段（可选），如项目、课程、获奖记录"
                    aria-label={x.label + ' 证据内容'}
                    onChange={e => onPatch(i, { evidence: e.target.value })}
                  />
                  <span className="mono">{x.evidence.length}/3000</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProfileTab({ student, resumeName, setResumeName, updateStudent, editStudent, replaceStudent, confirmProfile, revRef, jobs, analysis, setAnalysis, showToast, onGoMatches, onSetTargetJob, focusTarget, onFocusHandled }: {
  student: StudentProfile;
  resumeName: string;
  setResumeName: (name: string) => void;
  updateStudent: (fn: (s: StudentProfile) => StudentProfile) => void;
  editStudent: (fn: (s: StudentProfile) => { next: StudentProfile; notes?: string[] }) => string[];
  replaceStudent: (s: StudentProfile) => void;
  confirmProfile: () => void;
  revRef: { current: number };
  jobs: JobSummary[];
  analysis: ProfileResp['analysis'] | null;
  setAnalysis: (a: ProfileResp['analysis'] | null) => void;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
  onGoMatches: () => void;
  onSetTargetJob: (id: string, name: string) => void;
  focusTarget: ProfileFocusTarget | null;
  onFocusHandled: () => void;
}) {
  const [resumeStatus, setResumeStatus] = useState('支持文本型 PDF / DOCX / TXT（≤5MB）；导入后请整理能力标签与证据，带证据的能力才计分');
  const [resumeError, setResumeError] = useState<unknown>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitMsg, setSubmitMsg] = useState('');
  const [tags, setTags] = useState<TagDef[]>([]);
  const [sourceMode, setSourceMode] = useState<'resume' | 'manual'>('resume');
  const [resumeCandidates, setResumeCandidates] = useState<ResumeCandidate[]>([]);
  const [resumeDecisions, setResumeDecisions] = useState<Record<string, CandidateDecision>>({});
  const [focusNotice, setFocusNotice] = useState('');

  useEffect(() => {
    if (!focusTarget) return;
    const reasonText = focusTarget.reason === 'not_provided' ? '尚未填写；请先自评并补充该项。'
      : focusTarget.reason === 'unconfirmed' ? '尚未确认；请核对该项后确认档案。'
      : focusTarget.reason === 'missing_evidence' ? '缺少证据；请补充原文依据后确认档案。'
      : '已确认不具备；可查看成长路径安排补齐计划。';
    setFocusNotice('已定位「' + focusTarget.label + '」：' + reasonText);
  }, [focusTarget?.token]);

  useEffect(() => {
    let alive = true;
    apiGet<{ items: TagDef[] }>('/api/tags')
      .then(d => { if (alive) setTags(d.items); })
      .catch(() => { /* 字典加载失败时仍可手动添加；未知标签会显示"未入字典"提示 */ });
    return () => { alive = false; };
  }, []);

  async function handleResume(file: File) {
    if (submitBusy) {
      showToast('画像正在生成，请等它完成后再导入简历', 'err');
      return;
    }
    setResumeError(null);
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!['.pdf', '.docx', '.txt'].includes(ext)) {
      setResumeError(new Error('仅支持文本型 PDF、DOCX、TXT，请换用有效文件或手动填写。'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setResumeError(new Error('简历不能超过 5 MB，请精简后重试。'));
      return;
    }
    setResumeBusy(true);
    setResumeStatus('正在解析 ' + file.name + '…');
    try {
      const form = new FormData();
      form.append('file', file);
      const d = await apiPostForm<ResumeResp>('/api/resume/parse', form);
      const candidates = createResumeCandidates(d);
      setResumeCandidates(candidates);
      setResumeDecisions({});
      setResumeStatus(d.notice + '（解析 ' + d.text_length + ' 字符）；候选仅保存在当前会话，逐项审核并确认后才会合并。');
      showToast('简历已解析，请逐项审核候选内容');
    } catch (e) {
      setResumeError(e);
      setResumeStatus('解析失败：' + errMessage(e) + '（已填写内容保持不变，可重试或手动录入）');
      showToast('简历解析失败', 'err');
    } finally {
      setResumeBusy(false);
    }
  }

  function completeResumeReview() {
    if (!resumeCandidates.length || resumeCandidates.some(candidate => !resumeDecisions[candidate.id])) return;
    const accepted = resumeCandidates.filter(candidate => resumeDecisions[candidate.id] === 'accept');
    let notes: string[] = [];
    let mergedName: string | null = null;
    editStudent(current => {
      const result = mergeAcceptedResumeCandidates(current, resumeName, accepted);
      notes = result.notes;
      mergedName = result.resumeName;
      return { next: result.student };
    });
    if (mergedName) setResumeName(mergedName);
    setResumeCandidates([]);
    setResumeDecisions({});
    setResumeStatus('审核完成，已接受 ' + accepted.length + ' 项、跳过 ' + (resumeCandidates.length - accepted.length) + ' 项。' + (notes.length ? ' 冲突已保留档案现有值：' + notes.join('、') : ''));
    showToast('简历审核完成；新增能力仍需你核对并确认');
  }

  function addAbility(dim: Dimension, text: string) {
    const cfg = DIM_CONFIGS.find(c => c.key === dim)!;
    const key = text.toLowerCase();
    // 字典归一：命中 id / 展示名 / 别名时使用规范标签；未命中的保留原文并
    // 由界面标注"未入字典"，不冒充可计分的岗位要求标签。
    const hit = tags
      .filter(t => t.dimension === dim)
      .find(t => t.id.toLowerCase() === key || t.label.toLowerCase() === key || t.aliases.some(a => a.toLowerCase() === key));
    // 去重必须按规范 id：别名（如「Vue.js」）命中字典后写入的是 hit.id，
    // 用原始输入判断会漏掉与规范标签重复的情况。
    const normKey = hit ? hit.id.toLowerCase() : key;
    const notes = editStudent(s => {
      const list = s[dim];
      if (list.length >= cfg.max) return { next: s, notes: ['max'] };
      if (list.some(x => x.tag_id.toLowerCase() === normKey)) return { next: s, notes: ['dup'] };
      const entry: Ability = hit
        ? { tag_id: hit.id, label: hit.label, level: dim === 'skills' ? 2 : 1, confirmed: true, evidence: '' }
        : { tag_id: key.slice(0, 80), label: text.slice(0, 100), level: dim === 'skills' ? 2 : 1, confirmed: true, evidence: '' };
      return { next: { ...s, [dim]: [...list, entry] } };
    });
    if (notes.includes('max')) showToast(cfg.label + '已达上限 ' + cfg.max + ' 项', 'err');
    else if (notes.includes('dup')) showToast(cfg.label + '「' + (hit ? hit.label : text) + '」已存在', 'err');
  }

  function patchAbility(dim: Dimension, index: number, patch: Partial<Ability>) {
    updateStudent(s => {
      const list = s[dim].map((x, i) => (i === index ? { ...x, ...patch } : x));
      return { ...s, [dim]: list };
    });
  }

  function removeAbility(dim: Dimension, index: number) {
    updateStudent(s => ({ ...s, [dim]: s[dim].filter((_, i) => i !== index) }));
  }

  async function handleSubmit() {
    if (resumeBusy) {
      showToast('简历正在解析，请等解析完成后再生成画像', 'err');
      return;
    }
    setSubmitError(null);
    setSubmitBusy(true);
    setSubmitMsg('正在整理能力画像…模型未配置或网络异常时会在这里提示，你的输入不会丢失。');
    const reqRev = revRef.current;
    try {
      const d = await apiPost<ProfileResp>('/api/student/profile', student);
      if (revRef.current !== reqRev) {
        // 请求期间用户又编辑了输入：旧响应直接丢弃，绝不覆盖新输入。
        showToast('画像生成期间输入已修改，本次结果未应用，请重新生成', 'err');
        return;
      }
      replaceStudent(d.profile);
      setAnalysis(d.analysis);
      setSubmitMsg('画像已生成。请核对标签与证据，然后点击「确认完整画像」，确认后才能匹配。');
      showToast('能力画像已生成');
    } catch (err) {
      setSubmitError(err);
      setSubmitMsg('');
      showToast('画像生成失败：' + errMessage(err), 'err');
    } finally {
      setSubmitBusy(false);
    }
  }

  const abilityItems = [...student.skills, ...student.certificates, ...student.qualities];
  const waitingConfirmation = abilityItems.filter(item => !item.confirmed).length;
  const missingEvidence = abilityItems.filter(item => item.confirmed && item.level > 0 && !item.evidence.trim()).length;
  const confirmedAbsent = abilityItems.filter(item => item.confirmed && item.level === 0).length;
  const verified = abilityItems.filter(item => item.confirmed && item.level > 0 && item.evidence.trim()).length;
  const total = abilityItems.length;

  return (
    <div className="profile-stitch">
      <section className="profile-stitch-hero">
        <h2>我的能力档案与凭证核验</h2>
        <div className="profile-meta-line">
          <span>专业 · {student.major || '待填写'}</span>
          <label className="profile-target-select">目标岗位（可选）<select value={student.intention.target_job_id} onChange={e => onSetTargetJob(e.target.value, jobs.find(j => j.id === e.target.value)?.name || '未选择')}><option value="">先建档，之后可选</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
          <span>档案 · {student.confirmed ? '已确认' : '待确认'}</span>
        </div>
        <div className="profile-stitch-progress" aria-label="能力画像流程">
          <div className="is-current"><b>01</b><span>导入简历</span></div>
          <div className={total > 0 ? 'is-current' : ''}><b>02</b><span>整理能力</span></div>
          <div className={analysis ? 'is-current' : ''}><b>03</b><span>完成能力画像</span></div>
        </div>
      </section>
      <form className="profile-flow" onSubmit={e => { e.preventDefault(); void handleSubmit(); }} noValidate aria-label="能力画像表单">
        <section className="profile-step profile-source-step">
          <header><p>第 1 步 · 导入简历与项目经历</p><h3>导入简历与项目经历</h3></header>
          <div className="profile-source-actions" role="tablist" aria-label="资料录入方式">
            <button className={sourceMode === 'resume' ? 'is-active' : ''} type="button" role="tab" aria-selected={sourceMode === 'resume'} onClick={() => setSourceMode('resume')}>导入现有简历</button>
            <button className={sourceMode === 'manual' ? 'is-active' : ''} type="button" role="tab" aria-selected={sourceMode === 'manual'} onClick={() => setSourceMode('manual')}>手动录入资料</button>
          </div>
          <input type="file" accept=".pdf,.docx,.txt" hidden id="resumeFile" onChange={e => { const f = e.target.files?.[0]; if (f) handleResume(f); e.target.value = ''; }} />
          {sourceMode === 'resume' ? <>
            <button type="button" className="profile-upload-card" disabled={resumeBusy || submitBusy} onClick={() => document.getElementById('resumeFile')?.click()}>
              <span className="profile-upload-icon">⇧</span><strong>{resumeBusy ? '正在解析简历…' : '点击此区域选择简历文件'}</strong><small>支持 PDF、DOCX、TXT 格式（≤5MB）。系统会提取可识别的姓名、经历、技能、证书与通用素质。</small><i>{resumeBusy ? '处理中' : '选择文件解析'}</i>
            </button>
            <label className="profile-name-field">简历姓名
              <input aria-label="简历姓名" value={resumeName} maxLength={80} placeholder="未识别时可手动填写" onChange={e => setResumeName(e.target.value)} />
              <small>请核对或修改；仅保存在当前会话，不参与画像评分或报告。</small>
            </label>
            <p className="profile-resume-status">{resumeStatus}</p>
            {resumeCandidates.length > 0 && <section className="resume-review" aria-label="简历候选审核">
              <header><h4>逐项审核简历候选</h4><p>接受或跳过每项后，再确认合并。审核清单只保存在当前会话。</p></header>
              <div className="resume-review-list">{resumeCandidates.map(candidate => {
                const conflict = resumeCandidateConflict(candidate, student, resumeName);
                const label = candidate.kind === 'name' ? '简历姓名' : candidate.kind === 'major' ? '专业' : candidate.kind === 'experiences' ? '项目 / 实习经历' : DIM_CONFIGS.find(config => config.key === candidate.dimension)!.label;
                const content = candidate.kind === 'ability'
                  ? candidate.value.label + ' · 建议等级 ' + candidate.value.level + ' · ' + (candidate.value.evidence || '没有提取到证据')
                  : candidate.value;
                return <article key={candidate.id} className="resume-review-item"><div><b>{label}</b><p>{content}</p>{conflict && <small className="resume-conflict">冲突：{conflict}</small>}{candidate.kind === 'name' && <small>仅保存在当前会话，不写入本机草稿。</small>}</div><div className="resume-review-actions"><button type="button" className={resumeDecisions[candidate.id] === 'accept' ? 'selected' : ''} aria-pressed={resumeDecisions[candidate.id] === 'accept'} onClick={() => setResumeDecisions(d => ({ ...d, [candidate.id]: 'accept' }))}>接受</button><button type="button" className={resumeDecisions[candidate.id] === 'skip' ? 'selected' : ''} aria-pressed={resumeDecisions[candidate.id] === 'skip'} onClick={() => setResumeDecisions(d => ({ ...d, [candidate.id]: 'skip' }))}>跳过</button></div></article>;
              })}</div>
              <button type="button" className="primary-button" disabled={resumeCandidates.some(candidate => !resumeDecisions[candidate.id])} onClick={completeResumeReview}>确认并合并已接受项（{Object.values(resumeDecisions).filter(value => value === 'accept').length}）</button>
            </section>}
            {resumeError != null && <ErrorBox error={resumeError} />}
            <p className="profile-source-hint">已导入的内容会保留在当前画像中；需要修改专业、城市或经历时，切换到“手动录入资料”即可继续编辑。</p>
          </> : <div className="profile-manual-panel">
            <p className="profile-source-hint">直接填写你的背景信息，完成后在下方整理能力标签。已导入的简历内容不会被清空。</p>
            <div className="profile-basic-grid">
              <label>专业<input value={student.major} maxLength={120} placeholder="例如：计算机科学与技术" onChange={e => updateStudent(s => ({ ...s, major: e.target.value }))} /></label>
              <label>意向城市<input value={student.intention.city} maxLength={80} placeholder="例如：上海" onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, city: e.target.value } }))} /></label>
              <label className="wide">项目 / 实习经历<textarea rows={5} maxLength={12000} placeholder="写下你做过什么、承担了什么、产出了什么…" value={student.experiences} onChange={e => updateStudent(s => ({ ...s, experiences: e.target.value }))} /></label>
            </div>
          </div>}
        </section>
        <section className="profile-step profile-skill-step">
          <header><p>第 2 步 · 整理能力与证据</p><h3>选择你掌握的核心能力</h3><span>已录入 {abilityItems.length} 项 · 有证据且已确认 {verified} 项</span></header>
          {focusNotice && <p className="profile-focus-notice" role="status">{focusNotice}</p>}
          <div className="profile-state-counts" aria-label="档案项目状态"><span>待确认 <b>{waitingConfirmation}</b></span><span>缺少证据 <b>{missingEvidence}</b></span><span>已确认不具备 <b>{confirmedAbsent}</b></span></div>
          <p className="profile-step-copy">列表中的能力就是你准备纳入画像的内容；请补充熟练度和证据，最后统一确认整份画像。</p>
          <div className="profile-editor-stack">{DIM_CONFIGS.map(cfg => <TagEditor key={cfg.key} cfg={cfg} items={student[cfg.key]} dict={tags.filter(t => t.dimension === cfg.key)} onAdd={text => addAbility(cfg.key, text)} onPatch={(i, patch) => patchAbility(cfg.key, i, patch)} onRemove={i => removeAbility(cfg.key, i)} focusTarget={focusTarget} onFocusHandled={onFocusHandled} />)}</div>
          {tags.length === 0 && <p className="soft-note">标签字典未加载：新加标签可能无法与岗位要求对应，刷新页面可重试。</p>}
        </section>
        <section className="profile-step profile-result-step">
          <header><p>第 3 步 · 个人能力画像</p><h3>能力状态与画像摘要</h3><span>请分别处理未确认、缺少证据和不具备项目</span></header>
          <div className="profile-assessment-card">
            <div className="profile-score-column"><span>能力整理状态</span><p>已确认且有证据：{verified} 项</p><p>待确认：{waitingConfirmation} 项</p><p>缺少证据：{missingEvidence} 项</p><p>已确认不具备：{confirmedAbsent} 项</p><p>岗位要求中尚未填写的项目会在匹配结果中单独列出。</p></div>
            <div className="profile-radar" aria-label="能力画像维度示意，不参与匹配分计算"><div className="radar-grid"><i /><i /><i /></div><div className="radar-shape" /><span className="r1">专业技能</span><span className="r2">项目经验</span><span className="r3">通用素质</span><span className="r4">证书凭证</span><span className="r5">目标清晰度</span></div>
          </div>
          {total === 0 && !analysis ? <EmptyState symbol="◎" title="你的能力雷达还在等待"><p>填写资料或导入简历后生成能力画像。</p></EmptyState> : <div className="profile-analysis-list">{analysis?.summary.map((s, i) => <div className="profile-analysis-item" key={i}><b>{String(i + 1).padStart(2, '0')}</b><span>{s}</span></div>)}{student.advantages.map((s, i) => <div className="profile-analysis-item" key={'a' + i}><b>✓</b><span>{s}</span></div>)}{student.improvements.map((s, i) => <div className="profile-analysis-item is-gap" key={'g' + i}><b>!</b><span>{s}</span></div>)}</div>}
          {analysis && analysis.evidence_quotes.length > 0 && <details className="profile-evidence"><summary>查看 AI 使用的原文依据 · {analysis.evidence_quotes.length} 条</summary>{analysis.evidence_quotes.map((q, i) => <blockquote key={i}>「{q}」</blockquote>)}</details>}
          {submitError != null && <ErrorBox error={submitError} onRetry={() => void handleSubmit()} retryLabel="重试生成画像" />}<p className="form-message" aria-live="polite">{submitMsg}</p>
        </section>
        <div className="profile-action-dock"><div><i className={student.confirmed ? 'ok' : ''} /><span><b>{student.confirmed ? '能力档案已确认' : '能力档案待确认'}</b><small>{student.confirmed ? '可以查看岗位推荐；没有目标岗位也可继续' : '核对档案后确认，即可查看推荐和匹配'}</small></span></div><button className="ghost-button" type="submit" disabled={submitBusy || resumeBusy}>{submitBusy ? '正在整理…' : '生成能力画像'}</button><button className="ghost-button" type="button" disabled={student.confirmed || submitBusy || resumeBusy} onClick={confirmProfile}>确认完整画像</button><button className="primary-button" type="button" disabled={!student.confirmed} onClick={onGoMatches}>查看岗位匹配 <span>→</span></button></div>
      </form>
    </div>
  );
}
