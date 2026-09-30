import { useEffect, useState } from 'react';
import { apiGet, apiPost, errMessage } from '../api';
import type { LLMConfig } from '../types';

type Provider = LLMConfig['provider'];
type Adapter = LLMConfig['adapter'];

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1');
  } catch {
    return false;
  }
}

const PRESETS: Record<Provider, { label: string; description: string; baseUrl: string; model: string; adapter: Adapter }> = {
  deepseek: {
    label: 'DeepSeek',
    description: '适合中文简历解析与职业建议',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    adapter: 'chat-completions'
  },
  openai: {
    label: 'OpenAI 兼容接口',
    description: '支持 OpenAI 格式的自定义服务',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    adapter: 'chat-completions'
  }
};

export default function AIConfigPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [adapter, setAdapter] = useState<Adapter>(PRESETS.deepseek.adapter);
  const [baseUrl, setBaseUrl] = useState(PRESETS.deepseek.baseUrl);
  const [model, setModel] = useState(PRESETS.deepseek.model);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [savedBaseUrl, setSavedBaseUrl] = useState('');
  const [configured, setConfigured] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  useEffect(() => {
    let alive = true;
    apiGet<LLMConfig>('/api/llm/config')
      .then(config => {
        if (!alive) return;
        setProvider(config.provider);
        setAdapter(config.adapter || PRESETS[config.provider].adapter);
        setBaseUrl(config.base_url || PRESETS[config.provider].baseUrl);
        setModel(config.model || PRESETS[config.provider].model);
        setHasKey(config.has_api_key);
        setSavedBaseUrl(config.base_url || '');
        setConfigured(config.configured);
      })
      .catch(err => {
        if (alive) setError(errMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  function chooseProvider(next: Provider) {
    setProvider(next);
    setAdapter(PRESETS[next].adapter);
    setBaseUrl(PRESETS[next].baseUrl);
    setModel(PRESETS[next].model);
    setDirty(true);
    setConnectionTested(false);
    setError('');
  }

  async function save() {
    setError('');
    const baseChanged = Boolean(savedBaseUrl) && normalizeBaseUrl(savedBaseUrl) !== normalizeBaseUrl(baseUrl);
    const localAddressChange = isLoopbackHttpUrl(savedBaseUrl) && isLoopbackHttpUrl(baseUrl);
    if (baseChanged && hasKey && !localAddressChange && !apiKey.trim()) {
      setError('修改接口地址时必须重新输入 API 密钥。');
      return;
    }
    setBusy(true);
    try {
      const config = await apiPost<LLMConfig>('/api/llm/config', {
        provider,
        adapter,
        base_url: baseUrl,
        model,
        api_key: apiKey.trim() || undefined
      });
      setHasKey(config.has_api_key);
      setSavedBaseUrl(config.base_url || baseUrl);
      setConfigured(config.configured);
      setDirty(false);
      setConnectionTested(false);
      onSaved();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setError('');
    setBusy(true);
    setConnectionTested(false);
    try {
      await apiPost<{ connected: boolean }>('/api/llm/test', {});
      setConnectionTested(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function markDirty() {
    setDirty(true);
    setConnectionTested(false);
    setError('');
  }

  return (
    <div className="ai-config-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="ai-config-panel" role="dialog" aria-modal="true" aria-labelledby="ai-config-title">
        <button className="ai-config-close" type="button" aria-label="关闭 AI 模型配置" onClick={onClose} disabled={busy}>×</button>
        <p className="ai-config-kicker">MODEL CONNECTION</p>
        <h2 id="ai-config-title">AI 模型配置</h2>
        <p className="ai-config-lead">配置用于简历解析、个人分析报告和岗位建议的模型接口。可选择 Chat Completions 或 Responses 协议；测试连接只发送一条不含个人资料的短请求，密钥只发送到本机后端，不会回显。</p>

        <div className="ai-provider-grid" aria-label="模型服务预设">
          {(Object.keys(PRESETS) as Provider[]).map(key => (
            <button key={key} type="button" className={provider === key ? 'active' : ''} onClick={() => chooseProvider(key)} disabled={busy}>
              <strong>{PRESETS[key].label}</strong>
              <span>{PRESETS[key].description}</span>
            </button>
          ))}
        </div>

        <label>接口地址<input value={baseUrl} maxLength={500} placeholder="https://…" onChange={event => { setBaseUrl(event.target.value); markDirty(); }} disabled={busy} /></label>
        <label>模型名称<input value={model} maxLength={160} placeholder="例如 deepseek-chat" onChange={event => { setModel(event.target.value); markDirty(); }} disabled={busy} /></label>
        <label>适配器
          <select value={adapter} onChange={event => { setAdapter(event.target.value as Adapter); markDirty(); }} disabled={busy}>
            <option value="openai-responses">openai-responses</option>
            <option value="chat-completions">chat-completions</option>
          </select>
        </label>
        <label>API 密钥{hasKey && <span className="ai-config-label-note">已配置，留空表示保留现有密钥</span>}<input type="password" value={apiKey} maxLength={1000} placeholder={hasKey ? '留空以保留现有密钥' : '请输入 API 密钥'} autoComplete="new-password" onChange={event => { setApiKey(event.target.value); markDirty(); }} disabled={busy} /></label>

        <p className={'ai-config-state' + (connectionTested ? ' ready' : '')} role="status"><i />{loading ? '正在读取当前配置…' : connectionTested ? '模型连接验证成功' : dirty ? '配置有未保存修改，请先保存后测试连接' : configured ? '配置已保存，连接尚未验证' : '模型配置不完整，请填写并保存后测试连接'}</p>
        {error && <p className="ai-config-error" role="alert">{error}</p>}
        <div className="ai-config-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="ghost-button" type="button" onClick={() => void testConnection()} disabled={busy || loading || dirty || !configured}>{busy ? '正在处理…' : '测试连接'}</button>
          <button className="primary-button" type="button" onClick={() => void save()} disabled={busy || loading}>{busy ? '正在处理…' : '保存配置'}</button>
        </div>
      </section>
    </div>
  );
}
