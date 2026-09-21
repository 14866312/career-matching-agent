"""Committed fictional documents must work with the production extractor."""
from pathlib import Path
import json
import pytest
from backend.app.resume import extract_text
from backend.app.models import StudentProfile
ROOT = Path(__file__).resolve().parents[1] / 'samples'
@pytest.mark.parametrize('extension', ['txt', 'docx', 'pdf'])
def test_fictional_resume_extracts(extension):
    path = ROOT / ('虚构简历.' + extension)
    text = extract_text(path.name, path.read_bytes())
    assert '虚构' in text and 'Java' in text and 'SQL' in text
    assert '软件工程' in text and '团队协作' in text
@pytest.mark.parametrize('name', ['zero', 'partial', 'pending', 'related', 'levels'])
def test_student_sample_contract(name):
    filenames = {
        'zero': '学生-零技能.json',
        'partial': '学生-部分匹配.json',
        'pending': '学生-待确认.json',
        'related': '学生-关联技能.json',
        'levels': '学生-等级案例.json',
    }
    student = StudentProfile.model_validate(json.loads((ROOT / filenames[name]).read_text(encoding='utf-8')))
    assert student.confirmed
