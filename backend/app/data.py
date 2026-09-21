import json
from functools import lru_cache
from pathlib import Path

# The generated dataset lives beside the application package under backend/data.
ROOT = Path(__file__).resolve().parents[1]


@lru_cache
def dataset():
    return json.loads((ROOT / 'data' / 'career-data.json').read_text(encoding='utf-8'))


def get_job(job_id):
    return next((j for j in dataset()['jobs'] if j['id'] == job_id), None)


def tag_map():
    return {t['id']: t for t in dataset()['tags']}
