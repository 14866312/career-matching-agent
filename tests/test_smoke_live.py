"""Contract tests for scripts/smoke_live.py. The model JSON is stubbed; this is not live evidence."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import llm, main

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('smoke_live', ROOT / 'scripts' / 'smoke_live.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
MATCH_FACT_FIELDS = ('input_version', 'basic', 'enhanced', 'basic_display', 'enhanced_display')


async def fake_json(instruction, payload, **_options):
    if 'known_tags' in payload:
        return {'strength_tag_ids': payload['known_tags'][:2], 'improvements': ['完成一次课程练习并记录结果。']}
    if 'candidate_tags' in payload:
        return {'focus': '补充证据', 'activities': [{'tag_id': tag, 'steps': ['完成一次课程练习，并记录步骤与结果。']} for tag in payload['candidate_tags'][:2]]}
    text = payload['resume_text']
    return {'name': smoke.PROBE_NAME if smoke.PROBE_NAME in text else '', 'major': '软件工程', 'experiences': '',
            'skills': [{'tag_id': 'java', 'evidence': '了解Java'}], 'certificates': [], 'qualities': []}


def run_smoke(monkeypatch, configured=True, model=fake_json):
    monkeypatch.setattr(llm, 'call_json', model)
    monkeypatch.setattr(main, 'configured', lambda: configured)
    lines = []
    code = smoke.run(TestClient(main.app), out=lines.append)
    return code, '\n'.join(lines)


def rewrite_match_responses(monkeypatch, urls, rewrite):
    original = TestClient.post

    def rewritten_response(client, url, *args, **kwargs):
        response = original(client, url, *args, **kwargs)
        if url not in urls or response.status_code != 200:
            return response
        data = response.json()
        match = data['match'] if url == '/api/reports' else data
        rewrite(match)
        return httpx.Response(response.status_code, json=data)

    monkeypatch.setattr(TestClient, 'post', rewritten_response)


def assert_report_facts_fail(monkeypatch):
    code, output = run_smoke(monkeypatch)
    assert code == 1, output
    outcomes = {step['step']: step for step in json.loads(output)['steps']}
    assert outcomes['report_uses_match_facts']['status'] == 'failed'


def test_missing_configuration_exits_2(monkeypatch):
    code, output = run_smoke(monkeypatch, configured=False)
    assert code == 2 and 'not_verified' in output


def test_cli_missing_configuration_exits_2_before_connecting(monkeypatch, capsys):
    monkeypatch.setattr(smoke, 'local_model_configured', lambda: False)
    monkeypatch.setattr(smoke.sys, 'argv', ['smoke_live.py'])
    assert smoke.main() == 2
    assert 'not_verified' in capsys.readouterr().out


def test_all_applicable_steps_pass_without_printing_names(monkeypatch):
    code, output = run_smoke(monkeypatch)
    assert code == 0, output
    outcomes = {step['step']: step for step in json.loads(output)['steps']}
    for step in ('live_resume_pdf_empty_name', 'name_returned', 'name_not_in_profile', 'name_rejected_by_scoring', 'name_not_in_report'):
        assert outcomes[step]['status'] == 'passed'
    assert outcomes['name_edit']['status'] == 'not_applicable'
    assert 'browser' in outcomes['name_edit']['reason']
    assert smoke.PROBE_NAME not in output and smoke.EDITED_NAME not in output
    assert '图书借阅' not in output  # no resume text


@pytest.mark.parametrize('field', MATCH_FACT_FIELDS)
def test_report_fact_drift_fails_with_exit_1(monkeypatch, field):
    def drift_fact(match):
        value = match[field]
        match[field] = value + '-drift' if isinstance(value, str) else value + 1

    rewrite_match_responses(monkeypatch, {'/api/reports'}, drift_fact)
    assert_report_facts_fail(monkeypatch)


def test_missing_match_facts_in_both_responses_fail_with_exit_1(monkeypatch):
    def remove_facts(match):
        for field in MATCH_FACT_FIELDS:
            del match[field]

    rewrite_match_responses(monkeypatch, {'/api/matches', '/api/reports'}, remove_facts)
    assert_report_facts_fail(monkeypatch)


async def missed_name(instruction, payload, **_options):
    value = await fake_json(instruction, payload)
    if 'resume_text' in payload:
        value['name'] = ''
    return value


def test_name_leak_into_export_fails_with_exit_1(monkeypatch):
    original = main.export_report
    monkeypatch.setattr(main, 'export_report', lambda *a: original(*a) + smoke.PROBE_NAME)
    code, output = run_smoke(monkeypatch)
    assert code == 1 and '"step": "name_not_in_report",\n      "status": "failed"' in output
    assert smoke.PROBE_NAME not in output


def test_missed_name_fails_with_exit_1(monkeypatch):
    code, output = run_smoke(monkeypatch, model=missed_name)
    assert code == 1 and '"step": "name_returned",\n      "status": "failed"' in output


def test_upstream_error_code_is_reported_without_details(monkeypatch):
    async def broken(instruction, payload, **_options):
        raise llm.AIError('LLM_UPSTREAM', '上游错误：secret-detail', True)
    code, output = run_smoke(monkeypatch, model=broken)
    assert code == 1 and 'LLM_UPSTREAM' in output and 'secret-detail' not in output
