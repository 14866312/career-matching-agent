"""Real API acceptance only. Never prints credentials, names, resume text or upstream responses.

Exit codes: 0 all applicable API checks passed, 1 a step failed, 2 local model configuration missing.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import httpx
ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER_KEYS = {'replace-with-your-local-key', 'your-api-key', 'YOUR_API_KEY'}
# Fictional names used only to probe session-name isolation. They are never printed.
PROBE_NAME = '林晓'
EDITED_NAME = '周述安'


class StepFailed(Exception):
    pass


def local_model_configured():
    load_dotenv(ROOT / '.env')
    values = [os.environ.get(key, '').strip() for key in ('LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY')]
    return all(values) and values[2] not in PLACEHOLDER_KEYS


def _contains(value, *names):
    text = json.dumps(value, ensure_ascii=False)
    return any(name in text for name in names)


def run(client, out=print):
    outcomes = []

    def report(status='passed', **extra):
        out(json.dumps({'status': status, 'steps': outcomes, **extra}, ensure_ascii=False, indent=2))

    def fail(name, reason):
        outcomes.append({'step': name, 'status': 'failed', 'reason': reason})
        raise StepFailed

    def check(name, response):
        if response.status_code != 200:
            try:
                code = response.json().get('error', {}).get('code', 'HTTP_ERROR')
            except ValueError:
                code = 'HTTP_ERROR'
            outcomes.append({'step': name, 'status': 'failed', 'http_status': response.status_code, 'code': code})
            raise StepFailed
        outcomes.append({'step': name, 'status': 'passed'})
        return response.json()

    def expect(name, condition, reason):
        if not condition:
            fail(name, reason)
        outcomes.append({'step': name, 'status': 'passed'})

    try:
        health = check('health', client.get('/api/health'))
        if not health.get('llm_configured'):
            report('not_verified', reason='Local model configuration missing. Configure .env and restart; live acceptance remains unpassed.')
            return 2
        student = json.loads((ROOT / 'samples/学生-部分匹配.json').read_text(encoding='utf-8'))
        profile = check('live_profile', client.post('/api/student/profile', json=student))
        expect('live_profile_contract', profile.get('mode') == 'live' and isinstance(profile.get('analysis', {}).get('summary'), list), 'profile response contract')

        for ext in ('txt', 'docx', 'pdf'):
            p = ROOT / ('samples/虚构简历.' + ext)
            data = check('live_resume_' + ext, client.post('/api/resume/parse', files={'file': (p.name, p.read_bytes())}))
            expect('live_resume_' + ext + '_contract', data.get('mode') == 'live' and data.get('text_length', 0) > 0 and isinstance(data.get('profile'), dict), 'resume response contract')
            # The fictional samples carry no name, so the name must fall back to empty.
            expect('live_resume_' + ext + '_empty_name', data.get('name') == '', 'name must be empty when the resume has none')

        base_text = (ROOT / 'samples/虚构简历.txt').read_text(encoding='utf-8')
        named = ('姓名：' + PROBE_NAME + '\n' + base_text).encode('utf-8')
        parsed = check('live_resume_named', client.post('/api/resume/parse', files={'file': ('虚构简历-姓名.txt', named)}))
        expect('name_returned', parsed.get('name') == PROBE_NAME, 'explicit fictional name was not returned')
        resume_profile = parsed['profile']
        expect('name_not_in_profile', 'name' not in resume_profile and not _contains(resume_profile, PROBE_NAME), 'name leaked into StudentProfile fields')
        outcomes.append({
            'step': 'name_edit', 'status': 'not_applicable',
            'reason': 'Frontend name editing and refresh require browser acceptance.',
        })

        target = {'student': resume_profile, 'job_id': 'java'}
        expect('name_not_in_scoring_input', not _contains(target, PROBE_NAME, EDITED_NAME), 'name present in scoring input')
        # An edited session name smuggled into StudentProfile must be rejected, never scored.
        smuggled = client.post('/api/matches', json={'student': {**resume_profile, 'name': EDITED_NAME}, 'job_id': 'java'})
        expect('name_rejected_by_scoring', smuggled.status_code == 422, 'StudentProfile accepted a name field')
        match = check('match', client.post('/api/matches', json=target))
        expect('name_not_in_match', not _contains(match, PROBE_NAME, EDITED_NAME), 'name present in match result')
        live_report = check('live_report', client.post('/api/reports', json=target))
        expect('live_report_contract', live_report.get('mode') == 'live' and live_report.get('status') == 'complete' and bool(live_report.get('export_text')), 'report response contract')
        expect('name_not_in_report', not _contains(live_report, PROBE_NAME, EDITED_NAME), 'name present in report or export_text')
        report_match = live_report['match']
        match_fields = ('input_version', 'basic', 'enhanced', 'basic_display', 'enhanced_display')
        expect(
            'report_uses_match_facts',
            all(field in match and field in report_match and report_match[field] == match[field]
                for field in match_fields),
            'report facts missing or different from deterministic match',
        )

        outcomes.append({'step': 'versions', 'data': health.get('data_version'), 'algorithm': health.get('algorithm_version')})
        report()
        return 0
    except StepFailed:
        report('failed')
        return 1
    except httpx.HTTPError:
        report('failed', reason='Local service unavailable or timed out; no upstream details logged.')
        return 1
    except (KeyError, TypeError, ValueError):
        report('failed', reason='Application response contract failed.')
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    args = parser.parse_args()
    if not local_model_configured():
        print(json.dumps({'status': 'not_verified', 'reason': 'Local model configuration missing. Configure .env and restart; live acceptance remains unpassed.'}))
        return 2
    try:
        with httpx.Client(base_url=args.url, timeout=100, follow_redirects=False) as client:
            return run(client)
    except httpx.HTTPError:
        print(json.dumps({'status': 'failed', 'reason': 'Local service unavailable or timed out; no upstream details logged.'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
