from dotenv import dotenv_values, load_dotenv
import pytest

from backend.app import llm


def test_saved_config_survives_restart_and_preserves_other_settings(tmp_path, monkeypatch):
    path = tmp_path / '.env'
    path.write_text('OTHER_SETTING=keep\n', encoding='utf-8')
    for name in ('LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_ADAPTER'):
        monkeypatch.delenv(name, raising=False)
    snapshot = llm.update_config(
        'https://example.invalid/v1', 'test-model', 'fictional-key', config_path=path,
    )
    assert snapshot['has_api_key']
    assert 'fictional-key' not in str(snapshot)
    llm.update_config('https://example.invalid/v1', 'new-model', config_path=path)
    assert dotenv_values(path)['OTHER_SETTING'] == 'keep'
    assert dotenv_values(path)['LLM_API_KEY'] == 'fictional-key'
    for name in ('LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_ADAPTER'):
        monkeypatch.delenv(name, raising=False)
    load_dotenv(path)
    assert llm.config_snapshot()['model'] == 'new-model'
    assert llm.config_snapshot()['configured']


def test_failed_save_does_not_change_running_config(tmp_path, monkeypatch):
    monkeypatch.setenv('LLM_MODEL', 'original')
    monkeypatch.setenv('LLM_BASE_URL', 'https://example.invalid/v1')
    with pytest.raises(llm.AIError, match='配置保存失败'):
        llm.update_config(
            'https://example.invalid/v1', 'new', 'fictional-key',
            config_path=tmp_path / 'missing' / '.env',
        )
    assert llm.config_snapshot()['model'] == 'original'
