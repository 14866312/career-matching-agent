import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartParser

from .data import dataset, get_job
from .llm import AIError, extract_resume, generate_advice, generate_profile, configured
from .matching import ALGORITHM_VERSION, match_student, recommendations
from .models import MatchRequest, RecommendationRequest, StudentProfile
from .resume import MAX_BYTES, extract_text

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
logging.basicConfig(level=logging.INFO)
logging.getLogger('httpx').setLevel(logging.WARNING)
logger = logging.getLogger('career')
# The bounded request is rejected before multipart parsing. Accepted files stay in memory.
UPLOAD_LIMIT = MAX_BYTES + 65536
MultiPartParser.spool_max_size = UPLOAD_LIMIT + 1
app = FastAPI(title='Career Compass', version='1.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'], allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


def error(request, code, message, status=400, retryable=False):
    request_id = getattr(request.state, 'request_id', uuid4().hex)
    return JSONResponse(status_code=status, content={'error': {'code': code, 'message': message, 'retryable': retryable, 'request_id': request_id}}, headers={'X-Request-ID': request_id, 'Cache-Control': 'no-store'})


@app.middleware('http')
async def request_boundary(request: Request, call_next):
    request.state.request_id = uuid4().hex
    if request.method == 'POST' and request.url.path.startswith('/api/'):
        limit = UPLOAD_LIMIT if request.url.path == '/api/resume/parse' else 1024 * 1024
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return error(request, 'FILE_TOO_LARGE' if request.url.path == '/api/resume/parse' else 'INPUT_TOO_LARGE', '上传文件不能超过5 MB，请精简后重试。' if request.url.path == '/api/resume/parse' else '输入内容过长，请精简后重试。', 413)
            chunks.append(chunk)
        # BaseHTTPMiddleware replays the cached body to downstream parsers.
        request._body = b''.join(chunks)
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.error('request_failed id=%s type=%s', request.state.request_id, type(exc).__name__)
        return error(request, 'INTERNAL_ERROR', '服务暂时无法处理请求，请保留输入并重试。', 500, True)
    response.headers['X-Request-ID'] = request.state.request_id
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(AIError)
async def ai_error_handler(request: Request, exc: AIError):
    return error(request, exc.code, exc.message, 503 if exc.retryable else 400, exc.retryable)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return error(request, 'INVALID_INPUT', '输入校验失败：请检查薪资区间和字段内容。')


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return error(request, 'VALIDATION_ERROR', '输入格式无效：请检查必填项、数值范围和文件字段。', 422)


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return error(request, 'NOT_FOUND' if exc.status_code == 404 else 'HTTP_ERROR', '找不到该资源。' if exc.status_code == 404 else '请求格式或方法无效。', exc.status_code)


def require_confirmed(student):
    if not student.confirmed:
        raise AIError('PROFILE_UNCONFIRMED', '请先检查并确认完整能力画像，再进行匹配或生成建议。')


@app.get('/api/health')
def health():
    return {'status': 'ok', 'data_version': dataset()['version'], 'algorithm_version': ALGORITHM_VERSION, 'llm_configured': configured(), 'llm_model': os.environ.get('LLM_MODEL', ''), 'source_file': dataset()['source_file']}


@app.get('/api/tags')
def tags():
    return {'items': dataset()['tags'], 'version': dataset()['version']}


@app.get('/api/jobs')
def jobs():
    fields = ('id', 'name', 'family', 'level', 'summary', 'monogram', 'color', 'requirements', 'preferred', 'certificate_note', 'certificates', 'dimensions', 'version')
    return {'items': [{k: j[k] for k in fields if k in j} for j in dataset()['jobs']], 'version': dataset()['version']}


@app.get('/api/jobs/{job_id}')
def job_detail(job_id: str, request: Request):
    job = get_job(job_id)
    if not job:
        return error(request, 'JOB_NOT_FOUND', '找不到该岗位画像。', 404)
    return job


@app.get('/api/career-paths')
def paths():
    return dataset()['paths']


@app.get('/api/sources/{source_id}')
def source(source_id: str, request: Request):
    value = dataset()['sources'].get(source_id)
    return value if value else error(request, 'SOURCE_NOT_FOUND', '找不到该证据来源。', 404)


@app.post('/api/student/profile')
async def student_profile(student: StudentProfile):
    return await generate_profile(student)


@app.post('/api/resume/parse')
async def resume_parse(file: UploadFile = File(...)):
    try:
        content = await file.read(MAX_BYTES + 1)
        text = extract_text(file.filename or '', content)
        del content
        result = await extract_resume(text)
        result['text_length'] = len(text)
        return result
    finally:
        await file.close()


@app.post('/api/matches')
def matches(payload: MatchRequest, request: Request):
    require_confirmed(payload.student)
    job = get_job(payload.job_id)
    if not job:
        return error(request, 'JOB_NOT_FOUND', '找不到目标岗位。', 404)
    result = match_student(payload.student, job)
    result['notice'] = '基础分只计算已确认标签的覆盖率；待确认项不算满足。增强分的相关基础不代表已经掌握。'
    return result


@app.post('/api/recommendations')
def recommendation(payload: RecommendationRequest):
    require_confirmed(payload.student)
    return recommendations(payload.student, payload.filters, payload.sort_by)


def export_report(student, job, match, advice):
    def score(value):
        return '无法计算' if value is None else f'{value:.1f}%'
    def labels(key):
        return '、'.join(x['label'] for x in match[key]) or '无'
    lines = ['大学生职业规划建议', f'目标岗位：{job["name"]}', f'专业：{student.major or "未填写"}', f'意向城市：{student.intention.city or "未限制"}', f'基础匹配度：{score(match["basic_display"])}（{match["satisfied"]}/{match["required"]}）', f'增强匹配度：{score(match["enhanced_display"])}', f'已满足：{labels("satisfied_items")}', f'明确差距：{labels("gap_items")}', f'待确认：{labels("pending_items")}', '相关基础（不等于已掌握）：' + ('、'.join(x['label'] for x in match['items'] if x['related_only']) or '无'), '', '契合度评价：' + advice['fit_evaluation'], '', '学习方向：', *['- ' + x for x in advice['learning_directions']], '', '具体学习活动：', *['- ' + x for x in advice['learning_steps']], '', f'输入版本：{match["input_version"]}', f'算法版本：{match["algorithm_version"]}', f'数据版本：{match["data_version"]}', '招聘信息为赛题样本，不表示仍在招聘；建议不保证录用或薪资。']
    return chr(10).join(lines)


@app.post('/api/reports')
async def report(payload: MatchRequest, request: Request):
    require_confirmed(payload.student)
    job = get_job(payload.job_id)
    if not job:
        return error(request, 'JOB_NOT_FOUND', '找不到目标岗位。', 404)
    match = match_student(payload.student, job)
    if match['basic'] is None:
        raise AIError('MATCH_UNAVAILABLE', '岗位缺少可计算的要求，无法生成建议。')
    advice = await generate_advice(payload.student, job, match)
    return {'job_id': job['id'], 'job_name': job['name'], 'match': match, 'advice': advice, 'input_version': match['input_version'], 'status': 'complete', 'mode': 'live', 'generated_at': datetime.now(timezone.utc).isoformat(), 'export_text': export_report(payload.student, job, match, advice), 'notice': '分数和匹配事实由程序核算；AI提供学习建议。'}


frontend_dist = ROOT / 'frontend' / 'dist'
if frontend_dist.exists():
    app.mount('/', StaticFiles(directory=frontend_dist, html=True), name='frontend')
