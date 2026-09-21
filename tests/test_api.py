"""HTTP contract and privacy regression tests. AI functions are explicitly stubbed."""
from io import BytesIO
import pytest
from fastapi.testclient import TestClient
from backend.app import main
from backend.app.models import StudentProfile
from backend.app.resume import MAX_BYTES


@pytest.fixture
def client():
    return TestClient(main.app)


def student():
    return {'major': '软件工程', 'confirmed': True, 'skills': [{'tag_id': 'java', 'label': 'Java', 'confirmed': True, 'level': 2, 'evidence': 'Java课程项目'}], 'intention': {'target_job_id': 'java', 'city': '北京'}}


@pytest.mark.parametrize('route,payload', [('/api/matches', {'job_id': 'java', 'student': {}}), ('/api/recommendations', {'student': {}}), ('/api/reports', {'job_id': 'java', 'student': {}})])
def test_confirmation_gate(client, route, payload):
    r = client.post(route, json=payload)
    assert r.status_code == 400
    assert r.json()['error']['code'] == 'PROFILE_UNCONFIRMED'
    assert r.headers['x-request-id'] == r.json()['error']['request_id']


@pytest.mark.parametrize('body', [{'student': {'private-resume-secret': 'secret-text'}, 'job_id': 'java'}, {'student': {'skills': [{'tag_id': 'java', 'label': 'Java', 'level': 99}]}, 'job_id': 'java'}])
def test_invalid_inputs_are_safe(client, body):
    r = client.post('/api/matches', json=body)
    assert r.status_code == 422
    assert set(r.json()['error']) == {'code', 'message', 'retryable', 'request_id'}
    assert 'secret-text' not in r.text


def test_health_jobs_sources(client):
    health = client.get('/api/health')
    assert health.status_code == 200 and 'API_KEY' not in health.text
    assert 'no-store' in health.headers['cache-control']
    jobs = client.get('/api/jobs').json()['items']
    assert len(jobs) == 6
    source_id = jobs[0]['requirements'][0]['evidence'][0]['source_id']
    assert client.get('/api/sources/' + source_id).json()['row'] > 1
    assert client.get('/api/tags').json()['items']
    assert client.get('/api/jobs/missing').status_code == 404


def test_calculation_and_recommendation_consistent(client):
    r = client.post('/api/matches', json={'job_id': 'java', 'student': student()}).json()
    rec = client.post('/api/recommendations', json={'student': student()}).json()
    java = next(x for x in rec['items'] if x['job_id'] == 'java')
    assert java['match']['basic'] == r['basic']
    assert java['match']['input_version'] == r['input_version']
    changed = student()
    changed['major'] = '计算机科学'
    again = client.post('/api/matches', json={'job_id': 'java', 'student': changed}).json()
    assert again['input_version'] != r['input_version']


def test_report_recalculates_and_exports_server_facts(client, monkeypatch):
    async def advice(s, j, m):
        return {'fit_evaluation': '测试用建议', 'learning_directions': ['SQL'], 'learning_steps': ['编写查询脚本']}
    monkeypatch.setattr(main, 'generate_advice', advice)
    r = client.post('/api/reports', json={'job_id': 'java', 'student': student()})
    assert r.status_code == 200
    report = r.json()
    m = report['match']
    assert f"{m['basic']:.1f}%" in report['export_text']
    assert m['input_version'] in report['export_text']
    assert '北京' in report['export_text'] and '编写查询脚本' in report['export_text']
    assert report['status'] == 'complete'
    assert client.post('/api/reports', json={'job_id': 'java', 'student': student(), 'basic': 100}).status_code == 422


def test_upload_stays_in_memory_and_releases(client, monkeypatch):
    import starlette.formparsers
    original = starlette.formparsers.SpooledTemporaryFile
    tracked = []
    def spy(*a, **kw):
        result = original(*a, **kw)
        tracked.append(result)
        return result
    monkeypatch.setattr(starlette.formparsers, 'SpooledTemporaryFile', spy)
    async def resume(text):
        return {'profile': StudentProfile().model_dump(), 'notice': 'test stub', 'mode': 'test'}
    monkeypatch.setattr(main, 'extract_resume', resume)
    # DOCX/PDF may be >1MB but extracted text is bounded. Use extract_text stub to
    # isolate multipart buffering, not to claim a valid two-megabyte TXT resume.
    monkeypatch.setattr(main, 'extract_text', lambda *a: 'Java课程项目实习经历')
    r = client.post('/api/resume/parse', files={'file': ('resume.pdf', b'a' * (2 * 1024 * 1024), 'application/pdf')})
    assert r.status_code == 200
    assert tracked and all(x.closed and not x._rolled for x in tracked)


def test_upload_boundary(client):
    r = client.post('/api/resume/parse', files={'file': ('large.txt', b'x' * (MAX_BYTES + 100000))})
    assert r.status_code == 413 and r.json()['error']['code'] == 'FILE_TOO_LARGE'


def test_export_uses_same_half_up_display_as_chart():
    from backend.app.matching import match_student
    from backend.app.models import Ability
    tags = ['java', 'sql', 'html', 'css', 'javascript', 'vue', 'linux', 'mysql']
    job = {'id': 'rounding', 'name': 'Rounding', 'requirements': [
        {'tag_id': tag, 'dimension': 'skills', 'required_level': 2, 'required': True} for tag in tags]}
    s = StudentProfile(confirmed=True, skills=[Ability(tag_id=tag, label=tag, level=1 if i == 0 else 0, confirmed=True, evidence='course exercise') for i, tag in enumerate(tags)])
    m = match_student(s, job)
    assert m['enhanced'] == 6.25
    assert m['enhanced_display'] == 6.3
    report = main.export_report(s, job, m, {'fit_evaluation': 'test', 'learning_directions': [], 'learning_steps': []})
    assert '增强匹配度：6.3%' in report


def test_generic_failure_never_echoes_secret(client, monkeypatch, caplog):
    def crash(*a):
        raise RuntimeError('secret resume body API key')
    monkeypatch.setattr(main, 'match_student', crash)
    r = client.post('/api/matches', json={'job_id': 'java', 'student': student()})
    assert r.status_code == 500
    assert 'secret resume body' not in r.text and 'secret resume body' not in caplog.text
