import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPostForm, errMessage } from '../api';
import type { Ability, Dimension, JobSummary, ProfileResp, ResumeResp, StudentProfile, TagDef } from '../types';
import { EmptyState, ErrorBox } from './ui';
import { mergeResumeProfile } from '../lib/resumeImport';
import { DIM_CONFIGS, type DimensionConfig } from '../lib/profileConfig';
import type { ProfileFocusTarget } from '../types';

function TagEditor({ cfg, items, dict, onAdd, onRename, onRemove, focusTarget, onFocusHandled }: {
  cfg: DimensionConfig;
  items: Ability[];
  dict: TagDef[];
  onAdd: (text: string) => void;
  onRename: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  focusTarget: ProfileFocusTarget | null;
  onFocusHandled: () => void;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = 'dict-' + cfg.key;
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  useEffect(() => {
    if (!focusTarget || focusTarget.dimension !== cfg.key) return;
    setText(focusTarget.label);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    onFocusHandled();
  }, [cfg.key, focusTarget, onFocusHandled]);
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
        {items.length === 0 && <span className="tag-empty">暂无内容，可从简历提取或手动添加。</span>}
        {items.map((x, i) => {
          return (
            <div className="tag-row" key={x.tag_id + i}>
              {editing === i ? <div className="tag-row-edit">
                <input autoFocus value={editText} maxLength={100} aria-label={'修改 ' + x.label}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onRename(i, editText); setEditing(null); } if (e.key === 'Escape') setEditing(null); }} />
                <button type="button" onClick={() => { onRename(i, editText); setEditing(null); }}>保存</button>
                <button type="button" onClick={() => setEditing(null)}>取消</button>
              </div> : <div className="editable-tag">
                <span className="tag-label" title={x.evidence || undefined}>{x.label}</span>
                <small>{x.source === 'resume' ? '简历提取' : '手动补充'}</small>
                <button type="button" aria-label={'修改 ' + x.label} onClick={() => { setEditing(i); setEditText(x.label); }}>修改</button>
                <button type="button" aria-label={'删除 ' + x.label} onClick={() => onRemove(i)}>删除</button>
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProfileTab({ student, resumeName, setResumeName, updateStudent, editStudent, replaceStudent, revRef, jobs, analysis, setAnalysis, showToast, onGoMatches, onSetTargetJob, sourceModeRequest, onSourceModeRequestHandled, focusTarget, onFocusHandled }: {
  student: StudentProfile;
  resumeName: string;
  setResumeName: (name: string) => void;
  updateStudent: (fn: (s: StudentProfile) => StudentProfile) => void;
  editStudent: (fn: (s: StudentProfile) => { next: StudentProfile; notes?: string[] }) => string[];
  replaceStudent: (s: StudentProfile) => void;
  revRef: { current: number };
  jobs: JobSummary[];
  analysis: ProfileResp['analysis'] | null;
  setAnalysis: (a: ProfileResp['analysis'] | null) => void;
  showToast: (msg: string, kind?: 'ok' | 'err') => void;
  onGoMatches: () => void;
  onSetTargetJob: (id: string, name: string) => void;
  sourceModeRequest: { mode: 'resume' | 'manual'; token: number } | null;
  onSourceModeRequestHandled: () => void;
  focusTarget: ProfileFocusTarget | null;
  onFocusHandled: () => void;
}) {
  const [resumeStatus, setResumeStatus] = useState('支持文本型 PDF / DOCX / TXT（≤5MB）；导入后可补充或修改提取结果。');
  const [resumeError, setResumeError] = useState<unknown>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitMsg, setSubmitMsg] = useState('');
  const [tags, setTags] = useState<TagDef[]>([]);
  const [sourceMode, setSourceMode] = useState<'resume' | 'manual'>('resume');
  const [focusNotice, setFocusNotice] = useState('');

  useEffect(() => {
    if (!focusTarget) return;
    setFocusNotice('岗位要求提到「' + focusTarget.label + '」。若你具备这项技能，可在这里补充。');
  }, [focusTarget]);

  useEffect(() => {
    if (!sourceModeRequest) return;
    setSourceMode(sourceModeRequest.mode);
    const timer = window.setTimeout(() => {
      const target = sourceModeRequest.mode === 'resume'
        ? document.querySelector<HTMLElement>('.profile-upload-card')
        : document.querySelector<HTMLElement>('.profile-basic-grid input');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus();
      onSourceModeRequestHandled();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [onSourceModeRequestHandled, sourceModeRequest]);

  useEffect(() => {
    let alive = true;
    apiGet<{ items: TagDef[] }>('/api/tags')
      .then(d => { if (alive) setTags(d.items); })
      .catch(() => { /* 字典加载失败时仍可手动添加；未知标签会显示"未入字典"提示 */ });
    return () => { alive = false; };
  }, []);

  async function handleResume(file: File) {
    if (submitBusy) {
      showToast('个人报告正在生成，请等它完成后再导入简历', 'err');
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
      let applied = 0;
      let notes: string[] = [];
      editStudent(current => {
        const result = mergeResumeProfile(current, d);
        applied = result.appliedCount;
        notes = result.notes;
        return { next: result.student };
      });
      setResumeName(d.name || '');
      setResumeStatus(d.notice + '（解析 ' + d.text_length + ' 字符），已更新 ' + applied + ' 项。请检查并按需修改。' + (notes.length ? ' ' + notes.join('；') + '。' : ''));
      showToast('简历提取结果已更新，可直接修改');
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
        ? { tag_id: hit.id, label: hit.label, level: 1, confirmed: true, evidence: '', source: 'manual' }
        : { tag_id: key.slice(0, 80), label: text.slice(0, 100), level: 1, confirmed: true, evidence: '', source: 'manual' };
      return { next: { ...s, [dim]: [...list, entry] } };
    });
    if (notes.includes('max')) showToast(cfg.label + '已达上限 ' + cfg.max + ' 项', 'err');
    else if (notes.includes('dup')) showToast(cfg.label + '「' + (hit ? hit.label : text) + '」已存在', 'err');
  }

  function renameAbility(dim: Dimension, index: number, text: string) {
    const label = text.trim();
    if (!label) return;
    const key = label.toLowerCase();
    const hit = tags.filter(t => t.dimension === dim).find(t => t.id.toLowerCase() === key || t.label.toLowerCase() === key || t.aliases.some(a => a.toLowerCase() === key));
    const tagId = hit?.id ?? key.slice(0, 80);
    if (student[dim].some((item, i) => i !== index && item.tag_id.toLowerCase() === tagId.toLowerCase())) {
      showToast('该项目已存在', 'err');
      return;
    }
    updateStudent(s => {
      const list = s[dim].map((x, i) => (i === index ? { ...x, tag_id: tagId, label: hit?.label ?? label.slice(0, 100), level: Math.max(1, x.level), source: 'manual' as const } : x));
      return { ...s, [dim]: list };
    });
  }

  function removeAbility(dim: Dimension, index: number) {
    updateStudent(s => ({ ...s, [dim]: s[dim].filter((_, i) => i !== index) }));
  }

  async function handleSubmit() {
    if (resumeBusy) {
      showToast('简历正在解析，请等解析完成后再生成个人分析', 'err');
      return;
    }
    setSubmitError(null);
    setSubmitBusy(true);
    setSubmitMsg('正在生成个人分析报告…');
    const reqRev = revRef.current;
    try {
      const d = await apiPost<ProfileResp>('/api/student/profile', student);
      if (revRef.current !== reqRev) {
        // 请求期间用户又编辑了输入：旧响应直接丢弃，绝不覆盖新输入。
        showToast('资料在生成期间已修改，本次结果未应用，请重新生成', 'err');
        return;
      }
      replaceStudent(d.profile);
      setAnalysis(d.analysis);
      setSubmitMsg('个人分析报告已根据当前资料更新。');
      showToast('个人分析报告已生成');
    } catch (err) {
      setSubmitError(err);
      setSubmitMsg('');
      showToast('个人分析报告生成失败：' + errMessage(err), 'err');
    } finally {
      setSubmitBusy(false);
    }
  }

  const abilityItems = [...student.skills, ...student.certificates, ...student.qualities];
  const total = abilityItems.filter(item => item.level > 0).length;

  return (
    <div className="profile-stitch">
      <section className="profile-stitch-hero">
        <h2>简历分析与个人报告</h2>
        <div className="profile-meta-line">
          <span>专业 · {student.major || '待填写'}</span>
          <label className="profile-target-select">目标岗位（可选）<select value={student.intention.target_job_id} onChange={e => onSetTargetJob(e.target.value, jobs.find(j => j.id === e.target.value)?.name || '未选择')}><option value="">先建档，之后可选</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select></label>
          <span>已整理 {total} 项能力信息</span>
        </div>
        <div className="profile-stitch-progress" aria-label="简历分析流程">
          <div className="is-current"><b>01</b><span>导入简历</span></div>
          <div className={total > 0 ? 'is-current' : ''}><b>02</b><span>整理能力</span></div>
          <div className={analysis ? 'is-current' : ''}><b>03</b><span>个人分析报告</span></div>
        </div>
      </section>
      <form className="profile-flow" onSubmit={e => { e.preventDefault(); void handleSubmit(); }} noValidate aria-label="简历分析表单">
        <section id="profile-source" className="profile-step profile-source-step">
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
              <small>请核对或修改；仅保存在当前会话，不参与匹配计算。</small>
            </label>
            <p className="profile-resume-status">{resumeStatus}</p>
            {resumeError != null && <ErrorBox error={resumeError} />}
            <p className="profile-source-hint">提取结果已填入下方技能清单。专业、城市或经历可在“手动录入资料”中修改；重新导入会更新简历提取项，并保留手动补充内容。</p>
          </> : <div className="profile-manual-panel">
            <p className="profile-source-hint">直接填写你的背景信息，完成后在下方整理能力标签。已导入的简历内容不会被清空。</p>
            <div className="profile-basic-grid">
              <label>专业<input value={student.major} maxLength={120} placeholder="例如：计算机科学与技术" onChange={e => updateStudent(s => ({ ...s, major: e.target.value, major_source: 'manual' }))} /></label>
              <label>意向城市<input value={student.intention.city} maxLength={80} placeholder="例如：上海" onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, city: e.target.value } }))} /></label>
              <label className="wide">项目 / 实习经历<textarea rows={5} maxLength={12000} placeholder="写下你做过什么、承担了什么、产出了什么…" value={student.experiences} onChange={e => updateStudent(s => ({ ...s, experiences: e.target.value, experiences_source: 'manual' }))} /></label>
            </div>
          </div>}
        </section>
        <section className="profile-step profile-skill-step">
          <header><p>第 2 步 · 整理技能信息</p><h3>检查提取结果，按需补充</h3><span>当前资料包含 {total} 项技能、证书与通用素质</span></header>
          {focusNotice && <p className="profile-focus-notice" role="status">{focusNotice}</p>}
          <p className="profile-step-copy">简历未提及的能力不等于不具备。发现遗漏时直接添加；发现不准确时修改或删除。</p>
          <div className="profile-editor-stack">{DIM_CONFIGS.map(cfg => <TagEditor key={cfg.key} cfg={cfg} items={student[cfg.key]} dict={tags.filter(t => t.dimension === cfg.key)} onAdd={text => addAbility(cfg.key, text)} onRename={(i, text) => renameAbility(cfg.key, i, text)} onRemove={i => removeAbility(cfg.key, i)} focusTarget={focusTarget} onFocusHandled={onFocusHandled} />)}</div>
          {tags.length === 0 && <p className="soft-note">标签字典未加载：新加标签可能无法与岗位要求对应，刷新页面可重试。</p>}
        </section>
        <section id="profile-report" className="profile-step profile-result-step">
          <header><p>第 3 步 · 个人分析</p><h3>个人分析报告</h3><span>整理当前资料中的技能、经历与提升方向；岗位契合度在下一步单独计算</span></header>
          {analysis ? <div className="profile-analysis-list" aria-label="个人分析结果">
            <article className="profile-analysis-group">
              <h4>当前资料</h4>
              {student.major && <p>专业：{student.major}</p>}
              {student.experiences && <p>项目 / 实习经历：{student.experiences}</p>}
              {!student.major && !student.experiences && <p>尚未填写专业或项目经历，可随时补充。</p>}
            </article>
            <article className="profile-analysis-group">
              <h4>技能清单</h4>
              {DIM_CONFIGS.map(cfg => student[cfg.key].length > 0 && <p key={cfg.key}>{cfg.label}：{student[cfg.key].map(item => item.label).join('、')}</p>)}
              {total === 0 && <p>当前资料尚未提及技能、证书或通用素质；这不代表你不具备。</p>}
            </article>
            <article className="profile-analysis-group">
              <h4>可展示的优势</h4>
              {student.advantages.length > 0 ? student.advantages.map((item, i) => <p key={i}>{item}</p>) : <p>当前资料尚不足以归纳展示重点，可补充真实经历后重新生成。</p>}
            </article>
            <article className="profile-analysis-group">
              <h4>下一步提升</h4>
              {student.improvements.length > 0 ? student.improvements.map((item, i) => <p key={i}>{item}</p>) : <p>本次没有生成具体学习建议。</p>}
            </article>
            <p className="soft-note">{analysis.notice}</p>
          </div> : <EmptyState symbol="◎" title="根据你的资料生成分析"><p>填写或导入资料后点击“生成个人分析报告”。没有模型配置时，仍可直接查看岗位匹配。</p></EmptyState>}
          {analysis && analysis.evidence_quotes.length > 0 && <details className="profile-evidence"><summary>查看相关简历原文 · {analysis.evidence_quotes.length} 条</summary>{analysis.evidence_quotes.map((q, i) => <blockquote key={i}>「{q}」</blockquote>)}</details>}
          {submitError != null && <ErrorBox error={submitError} onRetry={() => void handleSubmit()} retryLabel="重试生成个人报告" />}<p className="form-message" aria-live="polite">{submitMsg}</p>
        </section>
        <div className="profile-action-dock"><div><span><b>资料可随时修改</b><small>修改后重新生成个人报告或刷新岗位匹配即可。</small></span></div><button className="ghost-button" type="submit" disabled={submitBusy || resumeBusy}>{submitBusy ? '正在生成…' : '生成个人分析报告'}</button><button className="primary-button" type="button" onClick={onGoMatches}>查看岗位匹配</button></div>
      </form>
    </div>
  );
}
