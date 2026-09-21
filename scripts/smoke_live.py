"""Real API acceptance only. Never prints credentials, resume text or upstream responses."""
import argparse
import json
import sys
from pathlib import Path
import httpx
ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    args = parser.parse_args()
    outcomes = []
    def check(name, response):
        if response.status_code != 200:
            try: code = response.json().get('error', {}).get('code', 'HTTP_ERROR')
            except ValueError: code = 'HTTP_ERROR'
            outcomes.append({'step': name, 'status': 'failed', 'http_status': response.status_code, 'code': code})
            print(json.dumps(outcomes, ensure_ascii=False, indent=2))
            raise SystemExit(1)
        data = response.json()
        outcomes.append({'step': name, 'status': 'passed'})
        return data
    try:
        with httpx.Client(base_url=args.url, timeout=100, follow_redirects=False) as client:
            health = check('health', client.get('/api/health'))
            if not health.get('llm_configured'):
                print(json.dumps({'status': 'not_verified', 'reason': 'Local model configuration missing. Configure .env and restart; P2/P5 remain unpassed.'}))
                return 2
            student = json.loads((ROOT / 'samples/学生-部分匹配.json').read_text(encoding='utf-8'))
            profile = check('live_profile', client.post('/api/student/profile', json=student))
            assert profile['mode'] == 'live' and profile['profile']['confirmed'] is False
            for ext in ('txt', 'docx', 'pdf'):
                p = ROOT / ('samples/虚构简历.' + ext)
                data = check('live_resume_' + ext, client.post('/api/resume/parse', files={'file': (p.name, p.read_bytes())}))
                assert data['mode'] == 'live' and data['text_length'] > 0
                assert data['profile']['confirmed'] is False
            check('match', client.post('/api/matches', json={'student': student, 'job_id':'java'}))
            report = check('live_report', client.post('/api/reports', json={'student': student, 'job_id':'java'}))
            assert report['mode'] == 'live' and report['status'] == 'complete' and report['export_text']
            outcomes.append({'step':'versions', 'data':health['data_version'], 'algorithm':health['algorithm_version']})
            print(json.dumps(outcomes, ensure_ascii=False, indent=2))
            return 0
    except httpx.HTTPError:
        print(json.dumps({'status':'failed','reason':'Local service unavailable or timed out; no upstream details logged.'}))
        return 1
    except (KeyError, AssertionError):
        print(json.dumps({'status':'failed','reason':'Application response contract failed.'}))
        return 1
if __name__ == '__main__':
    sys.exit(main())

