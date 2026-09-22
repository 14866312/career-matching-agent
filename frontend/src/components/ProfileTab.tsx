import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPostForm, errMessage } from '../api';
import type { Ability, Dimension, JobSummary, ProfileResp, ResumeResp, StudentProfile, TagDef } from '../types';
import { levelLabel } from '../format';
import { EmptyState, ErrorBox } from './ui';

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

// 简历解析结果以不可变方式合并进现有画像：
// - 已有条目保留用户填写的熟练度与确认状态，只补缺失的证据；
// - 专业/经历仅在为空时填充，已有内容保留并返回提示；
// - 全程创建新对象，不修改 React 状态中的旧引用。
function mergeResume(s: StudentProfile, p: StudentProfile): { next: StudentProfile; notes: string[] } {
  const notes: string[] = [];
  const next: StudentProfile = { ...s };
  if (p.major) {
    if (s.major.trim()) notes.push('专业（已保留你填写的内容）');
    else next.major = p.major;
  }
  if (p.experiences) {
    if (s.experiences.trim()) notes.push('经历（已保留你填写的内容）');
    else next.experiences = p.experiences;
  }
  for (const cfg of DIM_CONFIGS) {
    const list = [...s[cfg.key]];
    for (const a of p[cfg.key]) {
      const idx = list.findIndex(x => x.tag_id.toLowerCase() === a.tag_id.toLowerCase());
      if (idx >= 0) {
        const cur = list[idx];
        if (!cur.evidence && a.evidence) list[idx] = { ...cur, evidence: a.evidence };
      } else if (list.length < cfg.max) {
        list.push({ ...a });
      }
    }
    next[cfg.key] = list;
  }
  return { next, notes };
}

function TagEditor({ cfg, items, dict, onAdd, onPatch, onRemove }: {
  cfg: DimensionConfig;
  items: Ability[];
  dict: TagDef[];
  onAdd: (text: string) => void;
  onPatch: (index: number, patch: Partial<Ability>) => void;
  onRemove: (index: number) => void;
}) {
  const [text, setText] = useState('');
  const [evOpen, setEvOpen] = useState<Record<string, boolean>>({});
  const knownIds = new Set(dict.map(t => t.id));
  const listId = 'dict-' + cfg.key;
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <div className="tag-editor">
      <div className="editor-title">
        <span>{cfg.label}</span>
        <span className="mono">{items.length} / {cfg.max}</span>
      </div>
      <div className="tag-input">
        <input
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
                    value={x.evidence}
                    maxLength={3000}
                    placeholder="粘贴能证明该能力的原文片段（可选），如项目、课程、获奖记录"
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

export default function ProfileTab({ student, updateStudent, editStudent, replaceStudent, confirmProfile, revRef, jobs, analysis, setAnalysis, showToast, onGoMatches }: {
  student: StudentProfile;
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
}) {
  const [resumeStatus, setResumeStatus] = useState('支持文本型 PDF / DOCX / TXT（≤5MB）；导入后请整理能力标签与证据，带证据的能力才计分');
  const [resumeError, setResumeError] = useState<unknown>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitMsg, setSubmitMsg] = useState('');
  const [tags, setTags] = useState<TagDef[]>([]);
  const [sourceMode, setSourceMode] = useState<'resume' | 'manual'>('resume');

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
      // 合并始终基于最新画像（editStudent 内部取当前值），解析期间的手动编辑不会被覆盖。
      const { next, notes } = mergeResume(student, d.profile);
      let applied = false;
      editStudent(s => {
        // 若解析期间用户已编辑（s !== student），仍以最新状态重新合并一次。
        const r = s === student ? { next, notes } : mergeResume(s, d.profile);
        applied = true;
        return r;
      });
      if (!applied) return;
      const noteParts = [d.notice + '（解析 ' + d.text_length + ' 字符）'];
      if (notes.length) noteParts.push('已保留你填写的内容：' + notes.join('、'));
      setResumeStatus(noteParts.join(' '));
      showToast('简历已预填，请整理能力标签与证据');
    } catch (e) {
      setResumeError(e);
      setResumeStatus('解析失败：' + errMessage(e) + '（已填写内容保持不变，可重试或手动录入）');
      showToast('简历解析失败', 'err');
    } finally {
      setResumeBusy(false);
    }
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

  const total = student.skills.length + student.certificates.length + student.qualities.length;
  // 与后端 matching.py 一致：confirmed 且证据非空且 level>0 才满足要求并计分。
  const confirmedCount =
    student.skills.filter(x => x.confirmed && x.level > 0 && x.evidence.trim().length > 0).length +
    student.certificates.filter(x => x.confirmed && x.level > 0 && x.evidence.trim().length > 0).length +
    student.qualities.filter(x => x.confirmed && x.level > 0 && x.evidence.trim().length > 0).length;
  const profileScore = total === 0 ? 0 : Math.round((confirmedCount / total) * 100);

  return (
    <div className="profile-stitch">
      <section className="profile-stitch-hero">
        <h2>我的能力档案与凭证核验</h2>
        <div className="profile-meta-line">
          <span>专业 · {student.major || '待填写'}</span>
          <span>目标 · {jobs.find(j => j.id === student.intention.target_job_id)?.name || '待选择'}</span>
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
              <span className="profile-upload-icon">⇧</span><strong>{resumeBusy ? '正在解析简历…' : '点击此区域选择简历文件'}</strong><small>支持 PDF、DOCX、TXT 格式（≤5MB）。系统会提取可识别的经历、技能、证书与通用素质。</small><i>{resumeBusy ? '处理中' : '选择文件解析'}</i>
            </button>
            <p className="profile-resume-status">{resumeStatus}</p>
            {resumeError != null && <ErrorBox error={resumeError} />}
            <p className="profile-source-hint">已导入的内容会保留在当前画像中；需要修改专业、城市或经历时，切换到“手动录入资料”即可继续编辑。</p>
          </> : <div className="profile-manual-panel">
            <p className="profile-source-hint">直接填写你的背景信息，完成后在下方整理能力标签。已导入的简历内容不会被清空。</p>
            <div className="profile-basic-grid">
              <label>专业<input value={student.major} maxLength={120} placeholder="例如：计算机科学与技术" onChange={e => updateStudent(s => ({ ...s, major: e.target.value }))} /></label>
              <label>意向城市<input value={student.intention.city} maxLength={80} placeholder="例如：上海" onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, city: e.target.value } }))} /></label>
              <label>目标岗位<select value={student.intention.target_job_id} onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, target_job_id: e.target.value } }))}><option value="">先浏览岗位</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
              <label className="wide">项目 / 实习经历<textarea rows={5} maxLength={12000} placeholder="写下你做过什么、承担了什么、产出了什么…" value={student.experiences} onChange={e => updateStudent(s => ({ ...s, experiences: e.target.value }))} /></label>
            </div>
          </div>}
        </section>
        <section className="profile-step profile-skill-step">
          <header><p>第 2 步 · 整理能力与证据</p><h3>选择你掌握的核心能力</h3><span>已纳入 {total} 项 · 有效证据 {confirmedCount} 项</span></header>
          <p className="profile-step-copy">列表中的能力就是你准备纳入画像的内容；请补充熟练度和证据，最后统一确认整份画像。</p>
          <div className="profile-editor-stack">{DIM_CONFIGS.map(cfg => <TagEditor key={cfg.key} cfg={cfg} items={student[cfg.key]} dict={tags.filter(t => t.dimension === cfg.key)} onAdd={text => addAbility(cfg.key, text)} onPatch={(i, patch) => patchAbility(cfg.key, i, patch)} onRemove={i => removeAbility(cfg.key, i)} />)}</div>
          {tags.length === 0 && <p className="soft-note">标签字典未加载：新加标签可能无法与岗位要求对应，刷新页面可重试。</p>}
        </section>
        <section className="profile-step profile-result-step">
          <header><p>第 3 步 · 个人能力画像</p><h3>能力凭证覆盖与画像摘要</h3><span>画像完整度 {profileScore}%</span></header>
          <div className="profile-assessment-card">
            <div className="profile-score-column"><span>能力证据覆盖 / EVIDENCE COVERAGE</span><strong>{profileScore}<small>%</small></strong><i><b style={{ width: profileScore + '%' }} /></i><p>{confirmedCount} 项能力具备有效证据，另有 {Math.max(0, total - confirmedCount)} 项待核验。</p><span>经历填写进度（600 字参考）</span><strong className="secondary">{Math.min(100, Math.round((student.experiences.length / 600) * 100))}<small>%</small></strong></div>
            <div className="profile-radar" aria-label="能力画像维度示意，不参与匹配分计算"><div className="radar-grid"><i /><i /><i /></div><div className="radar-shape" /><span className="r1">专业技能</span><span className="r2">项目经验</span><span className="r3">通用素质</span><span className="r4">证书凭证</span><span className="r5">目标清晰度</span></div>
          </div>
          {total === 0 && !analysis ? <EmptyState symbol="◎" title="你的能力雷达还在等待"><p>填写资料或导入简历后生成能力画像。</p></EmptyState> : <div className="profile-analysis-list">{analysis?.summary.map((s, i) => <div className="profile-analysis-item" key={i}><b>{String(i + 1).padStart(2, '0')}</b><span>{s}</span></div>)}{student.advantages.map((s, i) => <div className="profile-analysis-item" key={'a' + i}><b>✓</b><span>{s}</span></div>)}{student.improvements.map((s, i) => <div className="profile-analysis-item is-gap" key={'g' + i}><b>!</b><span>{s}</span></div>)}</div>}
          {analysis && analysis.evidence_quotes.length > 0 && <details className="profile-evidence"><summary>查看 AI 使用的原文依据 · {analysis.evidence_quotes.length} 条</summary>{analysis.evidence_quotes.map((q, i) => <blockquote key={i}>「{q}」</blockquote>)}</details>}
          {submitError != null && <ErrorBox error={submitError} onRetry={() => void handleSubmit()} retryLabel="重试生成画像" />}<p className="form-message" aria-live="polite">{submitMsg}</p>
        </section>
        <div className="profile-action-dock"><div><i className={student.confirmed ? 'ok' : ''} /><span><b>能力档案完整度 {profileScore}%</b><small>{student.confirmed ? '当前画像已确认，可用于匹配' : '确认后才能生成匹配报告'}</small></span></div><button className="ghost-button" type="submit" disabled={submitBusy || resumeBusy}>{submitBusy ? '正在整理…' : '生成能力画像'}</button><button className="ghost-button" type="button" disabled={student.confirmed || submitBusy || resumeBusy} onClick={confirmProfile}>确认完整画像</button><button className="primary-button" type="button" disabled={!student.confirmed} onClick={onGoMatches}>生成深度匹配报告 <span>→</span></button></div>
      </form>
    </div>
  );
}
