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
                <label className="tag-confirm">
                  <input type="checkbox" checked={x.confirmed} aria-label={'确认 ' + x.label} onChange={e => onPatch(i, { confirmed: e.target.checked })} />
                  已确认
                </label>
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
  const [resumeStatus, setResumeStatus] = useState('支持文本型 PDF / DOCX / TXT（≤5MB）；导入后请逐项确认并补充证据，确认且带证据才计分');
  const [resumeError, setResumeError] = useState<unknown>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitMsg, setSubmitMsg] = useState('');
  const [tags, setTags] = useState<TagDef[]>([]);

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
      showToast('简历已预填，请逐项确认标签与证据');
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
        ? { tag_id: hit.id, label: hit.label, level: dim === 'skills' ? 2 : 1, confirmed: false, evidence: '' }
        : { tag_id: key.slice(0, 80), label: text.slice(0, 100), level: dim === 'skills' ? 2 : 1, confirmed: false, evidence: '' };
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

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">YOUR SIGNALS</p>
          <h2>把经历翻译成能力</h2>
        </div>
        <span className="soft-note">只有勾选「已确认」且填写证据的标签才计入基础匹配分</span>
      </div>
      <div className="profile-layout">
        <form className="card form-card" onSubmit={e => { e.preventDefault(); void handleSubmit(); }} noValidate aria-label="能力画像表单">
          <label>
            专业
            <input value={student.major} maxLength={120} placeholder="例如：计算机科学与技术" aria-label="专业"
              onChange={e => updateStudent(s => ({ ...s, major: e.target.value }))} />
          </label>
          <label>
            项目 / 实习经历
            <textarea rows={5} maxLength={12000} placeholder="写下你做过什么、承担了什么、产出了什么…"
              aria-label="项目 / 实习经历"
              value={student.experiences}
              onChange={e => updateStudent(s => ({ ...s, experiences: e.target.value }))} />
          </label>
          <div className="form-row">
            <label>
              意向城市
              <input value={student.intention.city} maxLength={80} placeholder="例如：上海" aria-label="意向城市"
                onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, city: e.target.value } }))} />
            </label>
            <label>
              目标岗位
              <select value={student.intention.target_job_id} aria-label="目标岗位"
                onChange={e => updateStudent(s => ({ ...s, intention: { ...s.intention, target_job_id: e.target.value } }))}>
                <option value="">先浏览岗位</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </label>
          </div>
          <div className="upload-zone">
            <input type="file" accept=".pdf,.docx,.txt" hidden id="resumeFile"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleResume(f); e.target.value = ''; }} />
            <button type="button" className="ghost-button" disabled={resumeBusy || submitBusy} aria-label="导入简历"
              onClick={() => document.getElementById('resumeFile')?.click()}>
              {resumeBusy ? '解析中…' : '＋ 导入简历'}
            </button>
            <span>{resumeStatus}</span>
          </div>
          {resumeError != null && <ErrorBox error={resumeError} />}
          {DIM_CONFIGS.map(cfg => (
            <TagEditor
              key={cfg.key}
              cfg={cfg}
              items={student[cfg.key]}
              dict={tags.filter(t => t.dimension === cfg.key)}
              onAdd={text => addAbility(cfg.key, text)}
              onPatch={(i, patch) => patchAbility(cfg.key, i, patch)}
              onRemove={i => removeAbility(cfg.key, i)}
            />
          ))}
          {tags.length === 0 && (
            <p className="soft-note">标签字典未加载：新加标签可能无法与岗位要求对应，刷新页面可重试。</p>
          )}
          <div className="confirm-row" role="status" aria-label="画像确认状态">
            <span className={'confirm-badge' + (student.confirmed ? ' ok' : '')}>
              {student.confirmed ? '画像已确认 ✓' : '画像未确认'}
            </span>
            <button
              type="button"
              className="ghost-button"
              disabled={student.confirmed || submitBusy || resumeBusy}
              aria-label="确认完整画像"
              onClick={confirmProfile}
            >
              确认完整画像
            </button>
            <span className="soft-note">
              {student.confirmed
                ? '匹配与建议将使用当前画像；编辑任何内容会自动撤销确认。'
                : '确认后才能计算匹配与生成建议；编辑任何内容会自动撤销确认。' + (total === 0 ? '当前没有任何标签：零技能画像也可以确认，结果会展示为 0 分或待确认。' : '')}
            </span>
          </div>
          <button className="primary-button" type="submit" disabled={submitBusy || resumeBusy} aria-label="生成能力画像">
            {submitBusy ? '正在整理…' : '生成能力画像'} <span>↗</span>
          </button>
          {submitError != null && <ErrorBox error={submitError} onRetry={() => void handleSubmit()} retryLabel="重试生成画像" />}
          <p className="form-message" aria-live="polite">{submitMsg}</p>
        </form>
        <aside className="card profile-preview">
          {total === 0 && !analysis ? (
            <EmptyState symbol="◎" title="你的能力雷达还在等待">
              <p>填写左侧信息，或导入一份简历。画像只会整理原文依据，不会替你假设"已经掌握"。</p>
            </EmptyState>
          ) : (
            <div className="profile-summary">
              <p className="eyebrow">STRUCTURED SIGNALS</p>
              <h3>你的能力画像</h3>
              <div className="stat-row">
                <div className="stat"><strong>{confirmedCount}</strong><span>确认+证据（计分）</span></div>
                <div className="stat"><strong>{total}</strong><span>标签总数</span></div>
                <div className="stat"><strong>{student.experiences.length}</strong><span>经历字符</span></div>
              </div>
              {analysis && analysis.summary.length > 0 && (
                <div className="item-block">
                  <h4>AI 整理 · 优势参考</h4>
                  {analysis.summary.map((s, i) => <div className="item" key={i}>{s}</div>)}
                  {analysis.evidence_quotes.length > 0 && (
                    <details className="req-item">
                      <summary><b>原文依据</b><span className="mono">{analysis.evidence_quotes.length} 条</span></summary>
                      {analysis.evidence_quotes.map((q, i) => <blockquote className="req-quote" key={i}>「{q}」</blockquote>)}
                    </details>
                  )}
                  <p className="soft-note">{analysis.notice}</p>
                </div>
              )}
              {student.advantages.length > 0 && (
                <div className="item-block">
                  <h4>已确认优势</h4>
                  {student.advantages.map((s, i) => <div className="item" key={i}>✓ {s}</div>)}
                </div>
              )}
              {student.improvements.length > 0 && (
                <div className="item-block">
                  <h4>待提升方向</h4>
                  {student.improvements.map((s, i) => <div className="item gap" key={i}>{s}</div>)}
                </div>
              )}
              <div className="detail-actions">
                <button className="primary-button" type="button" onClick={onGoMatches} aria-label="查看匹配推荐">
                  查看匹配推荐 <span>↗</span>
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
