"""E2E-only launch: real application plus a deterministic replacement for model JSON.
Never imported by the production entry point. Does not read or send real credentials.
"""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from backend.app import llm
from backend.app.main import app

async def fake_json(instruction, payload):
    if 'confirmed_tags' in payload:
        return {'strength_tag_ids':payload['confirmed_tags'][:3], 'improvements':['通过一个课程练习补充可核对的作品证据。']}
    if 'candidate_tags' in payload:
        return {'focus':'补充证据', 'activities':[{'tag_id':tag,'steps':['完成一次课程练习，并记录步骤与结果。']} for tag in payload['candidate_tags'][:3]]}
    text = payload['resume_text']
    return {'major':'软件工程' if '软件工程' in text else '', 'experiences':'',
            'skills':[{'tag_id':tag,'evidence':quote} for tag,quote in [('java','了解Java'),('sql','了解SQL')] if quote in text],
            'certificates':[], 'qualities':[]}
llm.call_json = fake_json
if __name__ == '__main__':
    print('TEST ONLY: AI JSON is simulated; matching, validation and document parsing are real.', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ.get('E2E_PORT','8011')), access_log=False)

