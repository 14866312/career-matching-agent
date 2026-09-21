"""Rebuild evidence-backed career profiles from the read-only competition XLS.

Output contract (read by backend/app/data.py, matching.py and llm.py):
    version, source_file, source_sha256, tags, jobs, paths, sources, relations, audit

Rules applied (approved plan sections 2.2 and 2.4, reviewed for career-1.3):
    1. Raw-field dedupe first. Two rows merge only when every original field is
       byte-identical before display cleanup; cleaning runs afterwards so a
       cleaned-up row can never swallow a differently written neighbour.
    2. Same job code, different content: every version stays in the version index
       with its original row, raw hash, content hash and original title. The sheet
       has no year in 更新日期, so no order is invented. One code is referenced by
       at most one profile (a recommendation never repeats a posting) and a senior
       version is never used as evidence for the junior baseline.
    3. Unknown pay is kept. 面议 and unparsed records stay in the profile samples
       and are only excluded when the caller applies a salary filter. Hourly /
       annual / weekly pay is a different period rather than "unknown" and is left
       out of the samples, with the count recorded in the audit.
    4. Levels come from real wording. 了解=1 / 熟悉=2 / 熟练=3 is taken from the
       nearest such word BEFORE the tag mention inside the same sentence, with only
       those three words ever mapping to a level. A tag is scored with the mode of
       the explicit observations (ties take the weaker level) and falls back to the
       documented default 2 only when no sample states a level. Every level carries
       its observation counts, sample list and the witness quote, and the witness is
       always part of the requirement evidence.
    5. Preferred skills live in the profile preferred list, never in the required
       denominator; required certificates become requirements in the certificate
       dimension so the UI and the matcher agree on what is mandatory.
    6. Certificates: mandatory wording or an explicit language/certificate section
       marks a mention as required; a closer preference marker wins. Two samples
       with a mandatory mention make the certificate required. A missing mention
       never invents a requirement and company credentials never become student
       requirements.
    7. Senior evidence is excluded. Records asking for 3+ years, 资深, 架构师 ...
       are dropped, and a senior-flavoured sentence is never used as evidence or as
       a level observation for the junior baseline.
    8. Tag patterns stay at capability level. A generic word (数据库) or a tool name
       (Postman / JMeter / Selenium / Appium) is not the capability itself, neither
       as a pattern nor as an alias.
    9. SQL and MySQL patterns are matched as ASCII tokens with the same boundary
       rule as backend/app/llm.py::mentions_alias, so SQL is the standalone word
       (including "SQL Server") and never MySQL, NoSQL or PostgreSQL. A MySQL-only
       sentence is no longer accepted as SQL evidence.
"""
import hashlib
import html
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'competition' / '岗位样例数据.xls'
TARGET = ROOT / 'backend' / 'data' / 'career-data.json'
REVIEW = ROOT / 'docs' / '职业数据审核.md'
SHEET = 'Sheet1'

VERSION = 'career-1.3'
LEVEL_RULE_VERSION = 'level-1.1'
RELATION_VERSION = 'relations-1.0'
TAG_DICTIONARY_VERSION = 'tags-1.2'
SAMPLES_PER_JOB = 40
MIN_SUPPORTING_SAMPLES = 3
MIN_DETAIL_CHARS = 120
EVIDENCE_LIMIT = 3
LEVEL_MIN_YEARS = 3
HASH_CHARS = 16

DIMENSION_LABELS = {'skills': '专业技能', 'certificates': '证书要求', 'qualities': '通用素质'}
DIMENSION_ORDER = ('skills', 'certificates', 'qualities')
STAGES = ['初级', '中级', '高级']

# 0-3 proficiency scale, shared with the student profile model (Ability.level).
LEVELS = [
    {'level': 0, 'label': '未掌握', 'basis': '学生自评或未提及'},
    {'level': 1, 'label': '了解', 'basis': '岗位原文明确写“了解”'},
    {'level': 2, 'label': '熟悉', 'basis': '岗位原文明确写“熟悉”'},
    {'level': 3, 'label': '熟练', 'basis': '岗位原文明确写“熟练”'},
]
LEVEL_DEFAULT = 2
LEVEL_MAPPING = {'了解': 1, '熟悉': 2, '熟练': 3}
# Ordered strongest first; only these three words ever map to a level.
LEVEL_WORDS = (('熟练', 3), ('熟悉', 2), ('了解', 1))
LEVEL_WORDING_RULE = ('只取同一句内标签出现位置之前最近的「熟练/熟悉/了解」：熟练=3、熟悉=2、了解=1；'
                      '掌握/精通/扎实/良好/使用/基础/理解/初步 等措辞一律不映射为等级。')
LEVEL_AGGREGATION_RULE = ('按样本明确措辞的众数取值：每个支持样本最多一票，写成“优先/加分”措辞的样本不参与必需等级的众数；'
                          '并列时取较弱等级；样本均未明确措辞时取画像整理默认等级 2。')
BASELINE_BASIS = '画像整理默认等级 2（系统默认值，非招聘原文硬门槛）'
# Keep the word 默认 in the default basis: matching._required_level reads it to mark
# the source as default_baseline instead of level_rule.
DEFAULT_LEVEL_BASIS = '样本原文未明确写了解/熟悉/熟练，按画像整理默认等级 2（系统默认值，非招聘原文硬门槛）'
CERT_LEVEL_BASIS = ('证书为二元要求（明确持有 / 明确不具备），不按熟练度分档；'
                    'required_level 固定为 1 仅用于结构一致性，不表示熟练度。')
CERT_RULE = ('同一证书须有不少于两份样本写成硬性要求才列为必需；其余提及列为优先项，未出现标为未提及。'
             '公司资质与公司认证不计入学生证书要求，未提及不补造证书。')
SALARY_PERIODS = ('month', 'day', 'negotiable')
UNSUPPORTED_SALARY_PERIODS = ('hourly', 'year', 'week')
ORDER_BASIS = '按原始行号升序，只表示文件内出现顺序，不代表招聘时间新旧。'

# SQL / MySQL 按 ASCII token 匹配，与 backend/app/llm.py::mentions_alias 使用同一套边界：
# (?<![A-Za-z0-9]) … (?![A-Za-z0-9])。左/右贴着字母或数字说明是另一个产品名，
# 因此 MySQL / NoSQL / PostgreSQL 不算 SQL，而 "SQL Server"、'熟悉 SQL 语句' 里的独立 SQL 仍算。
ASCII_ALNUM_BEFORE = r'(?<![A-Za-z0-9])'
ASCII_ALNUM_AFTER = r'(?![A-Za-z0-9])'
# 自检与单元回归共用同一组正反例，避免两处口径漂移。
SQL_POSITIVE_SAMPLES = ('熟悉 SQL 语句', '3、熟悉SQL Server、Oracle等数据库，掌握SQL语言',
                        '熟练使用sql', '会写SQL', '（SQL）')
SQL_NEGATIVE_SAMPLES = ('熟悉MySQL', '熟悉mysql', '熟悉Mysql', '熟悉 NoSQL 数据库',
                        'PostgreSQL 安装与运维', 'MySQL数据库', 'mysql数据库')

TAGS = [
    {'id': 'html', 'label': 'HTML', 'dimension': 'skills', 'pattern': r'HTML(?:5)?', 'aliases': ['html5']},
    {'id': 'css', 'label': 'CSS', 'dimension': 'skills', 'pattern': r'CSS(?:3)?', 'aliases': ['css3']},
    {'id': 'javascript', 'label': 'JavaScript', 'dimension': 'skills', 'pattern': r'JavaScript|(?<![a-z])JS(?![a-z])', 'aliases': ['js', 'es6']},
    {'id': 'vue', 'label': 'Vue', 'dimension': 'skills', 'pattern': r'Vue(?:\.js)?', 'aliases': ['vue.js', 'vue3', 'vue2']},
    {'id': 'react', 'label': 'React', 'dimension': 'skills', 'pattern': r'React', 'aliases': ['react.js']},
    {'id': 'git', 'label': 'Git 版本控制', 'dimension': 'skills', 'pattern': r'Git(?!Hub)|版本控制', 'aliases': ['git']},
    {'id': 'http', 'label': 'HTTP 协议', 'dimension': 'skills', 'pattern': r'HTTP', 'aliases': ['http协议']},
    {'id': 'java', 'label': 'Java', 'dimension': 'skills', 'pattern': r'Java(?!Script)', 'aliases': []},
    {'id': 'spring-boot', 'label': 'Spring Boot', 'dimension': 'skills', 'pattern': r'Spring[ -]?Boot|SpringBoot', 'aliases': ['springboot']},
    {'id': 'spring-cloud', 'label': 'Spring Cloud', 'dimension': 'skills', 'pattern': r'Spring[ -]?Cloud', 'aliases': ['springcloud']},
    # 只识别 SQL 本身；泛化的“数据库”不再当作 SQL 能力（词典别名同步移除）。
    # ASCII token 边界：MySQL / NoSQL / PostgreSQL 不算 SQL，“SQL Server”里的独立 SQL 算。
    {'id': 'sql', 'label': 'SQL', 'dimension': 'skills',
     'pattern': ASCII_ALNUM_BEFORE + r'SQL' + ASCII_ALNUM_AFTER, 'aliases': []},
    {'id': 'mysql', 'label': 'MySQL', 'dimension': 'skills',
     'pattern': ASCII_ALNUM_BEFORE + r'MySQL' + ASCII_ALNUM_AFTER, 'aliases': []},
    {'id': 'linux', 'label': 'Linux', 'dimension': 'skills', 'pattern': r'Linux', 'aliases': []},
    {'id': 'cpp', 'label': 'C/C++', 'dimension': 'skills', 'pattern': r'C\+\+|C语言|C/C', 'aliases': ['c++', 'c', 'c语言']},
    {'id': 'data-structures', 'label': '数据结构', 'dimension': 'skills', 'pattern': r'数据结构', 'aliases': []},
    {'id': 'algorithms', 'label': '算法基础', 'dimension': 'skills', 'pattern': r'算法', 'aliases': ['算法']},
    {'id': 'test-cases', 'label': '测试用例设计', 'dimension': 'skills', 'pattern': r'测试用例|用例设计', 'aliases': ['测试用例']},
    {'id': 'functional-testing', 'label': '功能测试', 'dimension': 'skills', 'pattern': r'功能测试', 'aliases': []},
    # 工具名不等于能力：不再用 Postman/Fiddler/JMeter 表示“接口测试”。
    {'id': 'api-testing', 'label': '接口测试', 'dimension': 'skills', 'pattern': r'接口测试|接口.{0,8}测试', 'aliases': []},
    # 同上：Selenium/Appium 是工具，不再单独代表“自动化测试”能力。
    {'id': 'automated-testing', 'label': '自动化测试', 'dimension': 'skills', 'pattern': r'自动化测试|自动化.{0,6}测试', 'aliases': []},
    {'id': 'deployment', 'label': '软件部署', 'dimension': 'skills', 'pattern': r'部署|软件.{0,4}安装|系统.{0,4}安装', 'aliases': ['部署']},
    {'id': 'troubleshooting', 'label': '故障排查', 'dimension': 'skills', 'pattern': r'故障|问题.{0,4}定位|定位.{0,4}问题|排查', 'aliases': ['故障定位']},
    {'id': 'networking', 'label': '网络基础', 'dimension': 'skills', 'pattern': r'TCP/?IP|网络.{0,4}知识|网络基础|网络协议', 'aliases': ['tcp/ip']},
    {'id': 'documentation', 'label': '技术文档', 'dimension': 'skills', 'pattern': r'文档|测试报告|操作手册', 'aliases': ['文档编写']},
    {'id': 'communication', 'label': '沟通表达', 'dimension': 'qualities', 'pattern': r'沟通|表达能力', 'aliases': ['沟通能力']},
    {'id': 'teamwork', 'label': '团队协作', 'dimension': 'qualities', 'pattern': r'团队合作|团队协作|团队精神|乐于合作', 'aliases': ['团队合作']},
    {'id': 'learning', 'label': '学习能力', 'dimension': 'qualities', 'pattern': r'学习能力|勤恳好学|善于学习|新技能的学习|自主学习', 'aliases': []},
    {'id': 'cet4', 'label': '大学英语四级', 'dimension': 'certificates', 'pattern': r'大学英语四级|英语四级|(?<!第)四级|CET[ -]?4', 'aliases': ['cet-4', '英语四级']},
    {'id': 'cet6', 'label': '大学英语六级', 'dimension': 'certificates', 'pattern': r'大学英语六级|英语六级|(?<!第)六级|CET[ -]?6', 'aliases': ['cet-6', '英语六级']},
    # 旧的“高项”会误命中“提高项目…”，改为不落在 提/高 之后才算软考高项。
    {'id': 'soft-exam', 'label': '软件资格考试（软考）', 'dimension': 'certificates', 'pattern': r'软考|计算机技术与软件专业技术资格|信息系统项目管理师|高级项目经理|(?<![高提])高项', 'aliases': ['软考']},
    {'id': 'it-cert', 'label': '计算机等级证书', 'dimension': 'certificates', 'pattern': r'计算机二级|计算机等级|计算机应用证书', 'aliases': ['计算机二级']},
    {'id': 'vendor-cert', 'label': '网络/厂商认证', 'dimension': 'certificates', 'pattern': r'CCNA|CCNP|CCIE|HCIA|HCIP|HCIE|H3CIE|RHCE|OCP|华为认证|思科认证|H3C认证|微软认证|网络认证|技术认证|厂商认证|认证证书', 'aliases': ['ccna', 'ccnp', '华为认证']},
    {'id': 'pmp', 'label': '项目管理认证（PMP）', 'dimension': 'certificates', 'pattern': r'PMP|Scrum Master|项目管理专业人士', 'aliases': ['pmp']},
    {'id': 'istqb', 'label': '测试认证（ISTQB）', 'dimension': 'certificates', 'pattern': r'ISTQB', 'aliases': ['istqb']},
]
TAG_LOOKUP = {t['id']: t for t in TAGS}
# Aliases that must never appear again: a tool or a generic noun is not a capability.
FORBIDDEN_ALIASES = {'postman', 'jmeter', 'fiddler', 'selenium', 'appium', '数据库', '数据库操作'}

SPECS = [
    {'id': 'frontend', 'name': '前端开发工程师', 'titles': ['前端开发'], 'skills': ['html', 'css', 'javascript', 'vue'], 'qualities': ['communication', 'teamwork'], 'summary': '把产品想法变成清晰、流畅的网页体验。', 'monogram': 'FE', 'color': '#366754'},
    {'id': 'java', 'name': 'Java 开发工程师', 'titles': ['Java'], 'skills': ['java', 'spring-boot', 'sql', 'mysql'], 'qualities': ['communication', 'teamwork'], 'summary': '构建可靠的业务逻辑、接口与数据服务。', 'monogram': 'JV', 'color': '#47719b'},
    {'id': 'cpp', 'name': 'C/C++ 开发工程师', 'titles': ['C/C++'], 'skills': ['cpp', 'data-structures', 'algorithms', 'linux'], 'qualities': ['teamwork', 'learning'], 'summary': '深入系统与性能，连接软件和设备。', 'monogram': 'C+', 'color': '#9a7248'},
    {'id': 'testing', 'name': '软件测试工程师', 'titles': ['软件测试', '测试工程师'], 'skills': ['test-cases', 'functional-testing', 'api-testing', 'sql'], 'qualities': ['communication', 'teamwork'], 'summary': '用系统化验证发现问题，守护产品质量。', 'monogram': 'QA', 'color': '#8b6b95'},
    {'id': 'implementation', 'name': '软件实施工程师', 'titles': ['实施工程师'], 'skills': ['deployment', 'sql', 'documentation'], 'qualities': ['communication', 'learning'], 'summary': '帮助客户把软件落地到真实业务流程。', 'monogram': 'IM', 'color': '#b07858'},
    {'id': 'support', 'name': '技术支持工程师', 'titles': ['技术支持工程师'], 'skills': ['linux', 'networking', 'troubleshooting', 'documentation'], 'qualities': ['communication', 'teamwork'], 'summary': '定位技术问题，让系统与客户业务持续运行。', 'monogram': 'TS', 'color': '#58868a'},
]

# Transitions the plan fixes as deliverable. The extra transitions keep every
# profile above the "two transitions for at least three profiles" acceptance bar.
TRANSITIONS = [
    ('frontend', 'java', ['编程基础', '接口协作'], ['Java', 'Spring Boot', '数据库设计'], '完成包含数据库和鉴权的服务端小项目', True),
    ('frontend', 'testing', ['页面交互理解', '问题复现'], ['测试用例设计', '接口测试'], '为自己的 Web 项目编写用例并执行接口验证', True),
    ('java', 'frontend', ['业务逻辑', '接口设计'], ['HTML/CSS', 'JavaScript', 'Vue'], '为已有服务端接口实现可交互页面', True),
    ('java', 'implementation', ['数据库', '业务系统理解'], ['客户沟通', '软件部署', '交付文档'], '模拟一次部署、培训和验收流程', True),
    ('testing', 'support', ['问题复现', '缺陷分析'], ['Linux', '网络基础', '客户沟通'], '建立常见故障排查记录并演练客户问题沟通', True),
    ('testing', 'implementation', ['验收测试', '业务流程理解'], ['部署', '数据库操作', '客户培训'], '完成小型系统的部署验收与操作手册', True),
    ('cpp', 'java', ['编程基础', '数据结构与算法'], ['Java 语法', 'Spring Boot', '数据库设计'], '用 Java 复写一个已完成的 C/C++ 小项目并补齐接口与数据层', False),
    ('cpp', 'support', ['系统底层理解', 'Linux 环境', '故障排查'], ['网络基础', '客户沟通', '服务流程'], '整理一份 Linux 环境故障排查记录并做一次客户问题复述', False),
    ('implementation', 'support', ['软件部署', '数据库操作', '客户沟通'], ['网络基础', 'Linux 排障', '服务响应流程'], '复现一次客户现场问题并写出处理记录', False),
    ('implementation', 'testing', ['业务流程理解', '环境搭建'], ['测试用例设计', '接口测试', '缺陷管理'], '为已交付系统补齐一套业务验收用例并执行', False),
    ('support', 'implementation', ['故障定位', '客户沟通', '技术文档'], ['部署实施', '数据迁移', '项目验收'], '参与一次小型系统的部署与培训并撰写交付文档', False),
    ('support', 'testing', ['问题复现', '缺陷跟踪'], ['测试用例设计', '测试流程与报告', '自动化测试基础'], '把处理过的客户问题改写成可复现的测试用例', False),
]

SENTENCE_BREAK = '。；;\n'
STATUS_MARKER_RE = re.compile(r'(经验要求|语言要求|证书要求|其他)\s*[:：]\s*([^<\n]{0,16})')
SALARY_RANGE = re.compile(r'([0-9]+(?:\.[0-9]+)?)\s*[-—–~至]\s*([0-9]+(?:\.[0-9]+)?)\s*(万|千|[kK]|元)?')
UNIT_FACTOR = {'万': 10000, '千': 1000, 'k': 1000, 'K': 1000, '元': 1}
# Raw wording that really asks for a senior profile. 4-digit years (2025-2026年)
# are not matched because of the (?<!\d) guard, and 1-3 年 stays a junior wording.
YEAR_RANGE_RE = re.compile(r'(?<![\d\-—–~至到])(\d{1,2})\s*[-—–~至到]\s*(\d{1,2})\s*年')
YEAR_PLUS_RE = re.compile(r'(?<![\d\-—–~至到])(\d{1,2})\s*年(?:以上|及以上|或以上)')
YEAR_EXPERIENCE_RE = re.compile(r'(?<![\d\-—–~至到])(\d{1,2})\s*年(?:以上)?(?:的)?(?:相关)?(?:工作)?经验')
YEAR_AFTER_RE = re.compile(r'(?:经验|工作年限|年限)[^。；;\n]{0,4}?(?<!\d)(\d{1,2})\s*年')
SENIOR_TITLE_RE = re.compile(r'资深|架构师|技术专家|专家工程师|团队负责人|项目负责人|高级(?:开发|测试|运维|实施|前端|后端|Java|算法|软件|工程师|研发)')
JUNIOR_RE = re.compile(r'应届|实习|毕业生|经验不限|无经验|培养')
PREFERENCE_RE = re.compile(r'优先|加分|更佳|更优|可选|增加竞争力')
CERT_MANDATORY_WORD_RE = re.compile(r'必须|须持|需持|须通过|需通过|需具备|须具备|硬性|强制')
CERT_THRESHOLD_RE = re.compile(r'(?:四级|六级|CET\s*-?\s*[46])[^。；;\n]{0,12}(?:以上|及以上|或以上)')
CERT_SECTION_KEYWORDS = ('语言能力', '语言要求', '英语能力', '外语能力', '证书要求', '资质要求',
                         '认证资质', '资格证书', '专业证书', '认证要求', '证书')
COMPANY_CREDENTIAL_RE = re.compile(
    r'(?:公司|集团|企业|研究院|检验中心|事业单位)[^。；;\n]{0,12}(?:认证|资质|证书|荣获|通过|获得)'
    r'|(?:荣获|曾被授予|获得多项)[^。；;\n]{0,12}(?:认证|资质|专利|著作权|证书)'
    r'|专利|著作权|检测报告|批准证书')
CERT_WINDOW = 30
# A level word only applies when it sits in the same clause as the tag mention.
# Full-width commas end a Chinese clause; ASCII commas and 顿号 are list separators,
# so "熟练使用ES6,CSS3" keeps its level while "熟练掌握git...，具有良好的团队合作"
# does not push 熟练 onto 团队合作.
# Numbered list markers ("3. 编写测试用例") also start a new requirement clause.
CLAUSE_BREAK_RE = re.compile(r'[，。；;！？!?\n]|\d{1,2}\s*[.、)）]\s')
LEVEL_WINDOW_CHARS = 40


def clean(value):
    """Strip display markup and collapse whitespace without touching the source file."""
    if value is None:
        return ''
    try:
        if pd.isna(value):
            return ''
    except (TypeError, ValueError):
        pass
    text = str(value)
    text = re.sub(r'<\s*br\s*/?\s*>', '\n', text, flags=re.I)
    text = html.unescape(text)
    text = re.sub(r'<[^>]*>', '\n', text)
    text = text.replace('\xa0', ' ').replace('&nbsp;', ' ')
    text = re.sub(r'[ \t\r\f\v]+', ' ', text)
    text = re.sub(r' *\n *', '\n', text)
    text = re.sub(r'\n{2,}', '\n', text)
    return text.strip()


def scrub_missing_tokens(text):
    """The sheet stores the literal string None for some empty sub-fields."""
    return re.sub(r'\bNone\b', ' ', text).strip(' -·')


def city_of(address):
    core = re.split(r'[-·]', address)[0]
    core = re.sub(r'\s+', '', scrub_missing_tokens(core))
    if len(core) > 2 and core.endswith('市'):
        core = core[:-1]
    return core


def tidy_industry(value):
    parts = [p.strip() for p in re.split(r'[，,]', value) if p.strip()]
    seen, out = set(), []
    for part in parts:
        if part not in seen:
            seen.add(part)
            out.append(part)
    return '，'.join(out)


def number(value):
    return int(value) if float(value).is_integer() else round(float(value), 2)


def digest(text):
    return hashlib.sha256(str(text).encode('utf-8')).hexdigest()[:HASH_CHARS]


def salary(raw_text):
    """Keep bounds, pay period and extra months; never convert between periods."""
    raw = (raw_text or '').strip()
    result = {
        'min': None, 'max': None, 'period': 'unknown', 'period_source': 'unknown',
        'currency': 'CNY', 'unit_label': None, 'extra_months': 0, 'raw': raw, 'basis': '',
    }
    if not raw:
        result['basis'] = '样本未提供薪资文本'
        return result
    extra = re.search(r'([0-9]{1,2})\s*薪', raw)
    if extra:
        result['extra_months'] = max(0, int(extra.group(1)) - 12)
    if '面议' in raw or '面谈' in raw:
        result['period'], result['period_source'] = 'negotiable', 'explicit'
        result['basis'] = '原文为面议，没有可验证的薪资区间；保留记录，仅在设置薪资筛选时排除'
        result['unit_label'] = None
        return result
    if re.search(r'/\s*天|元\s*/\s*日|每天|每日', raw):
        result['period'], result['period_source'] = 'day', 'explicit'
        result['basis'] = '原文按日计薪，保留日薪数值，不做月度换算'
    elif re.search(r'/\s*(?:小时|时)|元\s*/\s*时|时薪', raw):
        result['period'], result['period_source'] = 'hourly', 'explicit'
        result['basis'] = '原文按小时计薪，不换算为日薪或月薪'
    elif re.search(r'/\s*年|年薪', raw):
        result['period'], result['period_source'] = 'year', 'explicit'
        result['basis'] = '原文按年计薪，不换算为月薪'
    elif re.search(r'/\s*周|周薪', raw):
        result['period'], result['period_source'] = 'week', 'explicit'
        result['basis'] = '原文按周计薪，不换算为月薪'
    elif re.search(r'/\s*月|月薪', raw):
        result['period'], result['period_source'] = 'month', 'explicit'
        result['basis'] = '原文按月度口径展示'
    else:
        result['period'], result['period_source'] = 'month', 'inferred_default'
        result['basis'] = '样本未标注计薪周期，按国内招聘平台默认月度口径记录'
    if result['period'] in ('month', 'day'):
        result['unit_label'] = '元/月' if result['period'] == 'month' else '元/天'
    match = SALARY_RANGE.search(raw)
    if match:
        unit = match.group(3) or ''
        factor = UNIT_FACTOR.get(unit, 1)
        result['min'] = number(float(match.group(1)) * factor)
        result['max'] = number(float(match.group(2)) * factor)
        if unit == '万':
            result['basis'] += '；原文以万标注，按 1 万 = 10000 元换算'
        return result
    below = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*(万|千|[kK])?\s*元?\s*以下', raw)
    if below:
        result['max'] = number(float(below.group(1)) * UNIT_FACTOR.get(below.group(2) or '', 1))
        result['basis'] += '；原文只给出上限（N 元以下），未虚构下限'
        return result
    result['basis'] += '；未能从原文解析出区间，仅保留原文'
    return result


def seniority_hits(text):
    """Return the raw senior wording found in a text; empty means junior-compatible."""
    hits = []
    for match in SENIOR_TITLE_RE.finditer(text or ''):
        hits.append(match.group(0))
    for regex in (YEAR_RANGE_RE, YEAR_PLUS_RE, YEAR_EXPERIENCE_RE, YEAR_AFTER_RE):
        for match in regex.finditer(text or ''):
            group = next((value for value in match.groups() if value), None)
            if group is not None and int(group) >= LEVEL_MIN_YEARS:
                hits.append(match.group(0))
    return hits


def is_senior(text):
    return bool(seniority_hits(text))


def sentence_bounds(text, anchor):
    bounds = [i for i, ch in enumerate(text) if ch in SENTENCE_BREAK]
    left = max([b for b in bounds if b < anchor], default=-1) + 1
    right = min([b for b in bounds if b > anchor], default=len(text))
    return left, right


def sentence_window(text, anchor):
    left, right = sentence_bounds(text, anchor)
    return text[left:right]


def tag_mentions(text, tag_id):
    return list(re.finditer(TAG_LOOKUP[tag_id]['pattern'], text, re.I))


def mention_level(sentence, relative_start, relative_end):
    """Nearest 熟练/熟悉/了解 BEFORE the mention in the same sentence."""
    best = None
    for word, level in LEVEL_WORDS:
        for hit in re.finditer(re.escape(word), sentence):
            if hit.start() >= relative_start:
                continue
            between = sentence[hit.end():relative_start]
            if CLAUSE_BREAK_RE.search(between):
                continue
            distance = relative_start - hit.start()
            if distance > LEVEL_WINDOW_CHARS:
                continue
            if best is None or distance < best[0]:
                best = (distance, word, level)
    if best:
        return best[2], best[1]
    tail = sentence[relative_end:relative_end + 12]
    for word, level in LEVEL_WORDS:
        if re.match(r'^[\s：:（）()【】/]{0,4}' + re.escape(word), tail):
            return level, word
    return None, ''


def is_preference_mention(quote, tag_id):
    match = tag_mentions(quote, tag_id)
    anchor = match[0].start() if match else 0
    return bool(PREFERENCE_RE.search(sentence_window(quote, anchor)))


def mention_refs(text, tag_id, limit=4):
    """Usable mentions of one tag: one quote per sentence, senior sentences skipped."""
    refs, seen = [], set()
    for match in tag_mentions(text, tag_id):
        left, _ = sentence_bounds(text, match.start())
        quote = sentence_window(text, match.start()).strip()
        if len(quote) < 4:
            quote = text[max(0, match.start() - 80):match.end() + 80].strip()
        quote = quote[:600]
        if not quote or quote in seen:
            continue
        if is_senior(quote):
            continue
        seen.add(quote)
        relative = match.start() - left
        if relative < 0 or relative > len(quote):
            relative = quote.find(match.group(0))
            relative = relative if relative >= 0 else 0
        level, wording = mention_level(quote, relative, relative + (match.end() - match.start()))
        refs.append({
            'quote': quote,
            'offset': match.start(),
            'level': level,
            'wording': wording,
            'preference': is_preference_mention(quote, tag_id),
        })
        if len(refs) >= limit:
            break
    return refs


def evidence(text, tag_id):
    """First usable mention sentence, verbatim from the record."""
    refs = mention_refs(text, tag_id, limit=1)
    return refs[0]['quote'] if refs else None


def section_markers(text):
    """Return (offset, label) for every 【章节】 or bare-line section header."""
    markers, offset = [], 0
    for line in text.split('\n'):
        stripped = line.strip()
        label = None
        bracketed = re.match(r'^\s*\d*\s*[.、]?\s*【\s*([^】]{0,14}?)\s*】', stripped)
        if bracketed:
            label = bracketed.group(1).strip()
        else:
            head = re.split(r'[:：]', stripped)[0].strip()
            head = re.sub(r'^\d+\s*[.、]\s*', '', head).strip()
            if head and len(head) <= 12 and head == stripped.rstrip('：:').strip():
                label = head
        if label:
            markers.append((offset, label))
        offset += len(line) + 1
    return markers


def certificate_section(text, position):
    """Section label covering a certificate mention, limited to language/certificate sections."""
    current = None
    for offset, label in section_markers(text):
        if offset > position:
            break
        current = label if any(keyword in label for keyword in CERT_SECTION_KEYWORDS) else None
    return current


def nearest_marker(sentence, regex, start, end):
    best = None
    for match in regex.finditer(sentence):
        if start <= match.start() <= end:
            distance = 0
        else:
            distance = min(abs(match.start() - end), abs(start - match.end()))
        if distance <= CERT_WINDOW and (best is None or distance < best):
            best = distance
    return best


def classify_certificate(quote, tag_id, section=None):
    """required / preferred / mentioned / unmentioned for one certificate mention."""
    matches = tag_mentions(quote, tag_id)
    if not matches:
        return 'unmentioned'
    match = matches[0]
    left, _ = sentence_bounds(quote, match.start())
    sentence = sentence_window(quote, match.start())
    start, end = match.start() - left, match.end() - left
    preference = nearest_marker(sentence, PREFERENCE_RE, start, end)
    mandatory = nearest_marker(sentence, CERT_MANDATORY_WORD_RE, start, end)
    threshold = bool(CERT_THRESHOLD_RE.search(sentence))
    if mandatory is not None and (preference is None or mandatory <= preference):
        return 'required'
    if preference is not None:
        return 'preferred'
    if threshold or section:
        return 'required'
    return 'mentioned'


def dedupe(records):
    """Merge rows only when every ORIGINAL field matches; cleaning happens later."""
    fields = sorted(records[0]['_raw']) if records else []
    seen, unique, merged = {}, [], defaultdict(list)
    for record in records:
        signature = tuple(record['_raw'][k] for k in fields)
        if signature in seen:
            merged[seen[signature]].append(record['_row'])
            continue
        seen[signature] = record['_row']
        unique.append(record)
    for record in unique:
        record['_dup_rows'] = sorted(merged.get(record['_row'], []))
    return unique


def load_records():
    df = pd.read_excel(SOURCE, engine='xlrd', dtype=str)
    records = []
    for index, row in df.iterrows():
        record = {name: ('' if pd.isna(value) else str(value)) for name, value in row.items()}
        for name in ('岗位详情', '公司详情', '所属行业', '公司规模', '公司类型'):
            record[name] = clean(record[name])
        record['_row'] = index + 2
        record['_raw'] = {name: ('' if pd.isna(value) else str(value)) for name, value in row.items()}
        records.append(record)
    return df, records


def raw_sha(record):
    payload = json.dumps(record['_raw'], ensure_ascii=False, sort_keys=True)
    return digest(payload)


def content_sha(record):
    payload = json.dumps([record['岗位名称'], scrub_missing_tokens(record['地址']),
                          record['薪资范围'], record['岗位详情']], ensure_ascii=False)
    return digest(payload)


def version_meta(records):
    """Row -> its position among the distinct-content versions of the same job code."""
    by_code = defaultdict(list)
    for record in records:
        by_code[record['岗位编码']].append(record)
    meta = {}
    for code, rows in by_code.items():
        ordered = sorted(rows, key=lambda item: item['_row'])
        for position, record in enumerate(ordered, start=1):
            meta[record['_row']] = {
                'index': position,
                'distinct_versions': len(ordered),
                'content_sha256': content_sha(record),
                'order_basis': ORDER_BASIS,
            }
    return meta


def build_code_versions(records, claimed, senior_rows):
    """Traceable index of every content version of the codes the profiles reference."""
    by_code = defaultdict(list)
    for record in records:
        by_code[record['岗位编码']].append(record)
    index = {}
    for code in sorted({claim['code'] for claim in claimed.values()}):
        rows = sorted(by_code.get(code, []), key=lambda item: item['_row'])
        claims = {claim['row']: claim for claim in claimed.values() if claim['code'] == code}
        retained_content = {content_sha(record) for record in rows if record['_row'] in claims}
        titles = sorted({title for claim in claims.values() for title in claim['titles']})
        versions = []
        for position, record in enumerate(rows, start=1):
            claim = claims.get(record['_row'])
            entry = {
                'version_index': position,
                'row': record['_row'],
                'title': record['岗位名称'],
                'content_sha256': content_sha(record),
                'raw_sha256': raw_sha(record),
                'retained': bool(claim),
            }
            if claim:
                entry['source_id'] = claim['source_id']
                entry['reason'] = 'selected_for_profile:' + claim['profile']
            elif record['_row'] in senior_rows:
                entry['reason'] = 'senior_requirement_version_not_used'
            elif content_sha(record) in retained_content:
                entry['reason'] = 'duplicate_content_version'
            elif record['岗位名称'] not in titles:
                entry['reason'] = 'other_title_version'
            else:
                entry['reason'] = 'not_selected_for_junior_baseline'
            versions.append(entry)
        index[code] = {
            'job_code': code,
            'distinct_versions': len(rows),
            'raw_rows': len(rows) + sum(len(record['_dup_rows']) for record in rows),
            'claimed_by': sorted({claim['profile'] for claim in claims.values()}),
            'titles': titles,
            'versions': versions,
            'order_basis': ORDER_BASIS,
            'note': '同一编码的不同内容版本全部保留在此索引；不推断时间新旧，高级版本不作为初级画像证据。',
        }
    return index


def requirement_evidence(records, tag_id):
    refs = []
    for record in records:
        source_id = 'row-' + str(record['_row'])
        for ref in mention_refs(record['岗位详情'], tag_id):
            refs.append({'source_id': source_id, **ref})
    return refs


def evidence_by_source(refs, limit=EVIDENCE_LIMIT):
    """One quote per source, witness first is handled by the caller."""
    out, used = [], set()
    for ref in refs:
        if ref['source_id'] in used:
            continue
        used.add(ref['source_id'])
        out.append(ref)
        if len(out) >= limit:
            break
    return out


def requirement_level(refs):
    """必需等级：只用非优先措辞的显式观测，且每个来源最多一票。

    优先/加分措辞的样本单独记录（level_preference_* 字段）但不参与众数，
    同一来源的同一标签只按它最早一条明确措辞计一票，避免重复计票。
    """
    observations, preference_observations = [], []
    voted = set()
    for ref in refs:
        # A source votes at most once, and the first explicit wording it uses decides
        # whether it counts (必需措辞) or is only noted (优先/加分措辞).
        if not ref['level'] or ref['source_id'] in voted:
            continue
        voted.add(ref['source_id'])
        if ref['preference']:
            preference_observations.append(ref)
            continue
        observations.append(ref)
    counts = Counter(ref['level'] for ref in observations)
    preference_counts = Counter(ref['level'] for ref in preference_observations)
    if counts:
        level = max(counts.items(), key=lambda item: (item[1], -item[0]))[0]
        witness = next(ref for ref in observations if ref['level'] == level)
    else:
        level, witness = LEVEL_DEFAULT, None
    ordered = ([witness] if witness else [])
    ordered += [ref for ref in refs if ref is not witness and not ref['preference']]
    ordered += [ref for ref in refs if ref is not witness and ref['preference']]
    return {
        'level': level,
        'witness': witness,
        'counts': counts,
        'preference_counts': preference_counts,
        'observations': observations,
        'preference_observations': preference_observations,
        'evidence': evidence_by_source(ordered),
    }


def requirement_row(tag_id, result, total):
    level = result['level']
    witness = result['witness']
    counts = result['counts']
    chosen = result['evidence']
    tag = TAG_LOOKUP[tag_id]
    if counts:
        source = 'level_rule'
        basis = ('样本原文明确写了等级措辞，取最近前置措辞「' + str(witness['wording']) + '」；'
                 '按非优先措辞样本的众数得到等级 ' + str(level) + '（了解=1 / 熟悉=2 / 熟练=3）。'
                 '每个支持样本最多计一票，写成优先/加分的样本不参与。')
    elif result['preference_counts']:
        source = 'default_baseline'
        basis = ('样本中的等级措辞只出现在“优先/加分”句子里，不作为必需等级依据；'
                 '按画像整理默认等级 2（系统默认值，非招聘原文硬门槛）。')
    else:
        source = 'default_baseline'
        basis = DEFAULT_LEVEL_BASIS
    return {
        'tag_id': tag_id,
        'label': tag['label'],
        'dimension': tag['dimension'],
        'requirement': 'required',
        'required_level': level,
        'level_source': source,
        'level_rule_version': LEVEL_RULE_VERSION if counts else None,
        'level_basis': basis,
        'level_wording_rule': LEVEL_WORDING_RULE,
        'level_aggregation': LEVEL_AGGREGATION_RULE,
        'level_observations': {str(k): v for k, v in sorted(counts.items())},
        'level_preference_observations': {str(k): v for k, v in sorted(result['preference_counts'].items())},
        'level_observation_sources': sorted({ref['source_id'] for ref in result['observations']}),
        'level_preference_sources': sorted({ref['source_id'] for ref in result['preference_observations']}),
        'level_observed_samples': len(result['observations']),
        'level_samples': [{'source_id': ref['source_id'], 'level': ref['level'], 'wording': ref['wording']}
                          for ref in result['observations'][:3]],
        'level_witness': ({'source_id': witness['source_id'], 'wording': witness['wording'], 'level': witness['level']}
                          if witness else None),
        'evidence': chosen,
        'evidence_count': total,
        'evidence_shown': len(chosen),
        'selection_basis': '主控按初级能力基线整理；并非要求同一广告包含所有标签，证据取自同族样本的原文句子。',
    }


def certificate_rows(records, tag_id):
    mentions = []
    for record in records:
        source_id = 'row-' + str(record['_row'])
        for ref in mention_refs(record['岗位详情'], tag_id, limit=3):
            if COMPANY_CREDENTIAL_RE.search(ref['quote']):
                continue
            section = certificate_section(record['岗位详情'], ref['offset'])
            mentions.append({
                'source_id': source_id,
                'quote': ref['quote'],
                'classification': classify_certificate(ref['quote'], tag_id, section),
                'section': section,
            })
    required_sources = {mention['source_id'] for mention in mentions if mention['classification'] == 'required'}
    counts = Counter(mention['classification'] for mention in mentions)
    if len(required_sources) >= 2:
        status = 'required'
    elif mentions:
        status = 'preferred'
    else:
        status = 'unmentioned'
    return mentions, status, len(required_sources), {k: v for k, v in sorted(counts.items())}


def build_jobs(records, meta, claimed, audit_state):
    sources, jobs = {}, []
    claimed_codes = set()
    claimed_contents = set()
    for spec in SPECS:
        titles = list(spec['titles'])
        candidates = []
        for record in records:
            text = record['岗位详情']
            if record['岗位名称'] not in titles or len(text) < MIN_DETAIL_CHARS:
                continue
            hits = seniority_hits(text)
            if hits:
                audit_state['senior_rows'].add(record['_row'])
                audit_state['senior_phrases'].update(hits)
                continue
            if spec['id'] in ('support', 'implementation') and not re.search(r'软件|数据库|Linux|网络|信息系统|IT|服务器', text, re.I):
                continue
            if salary(record['薪资范围'])['period'] not in SALARY_PERIODS:
                audit_state['unsupported_salary_skips'] += 1
                continue
            wanted = spec['skills'] + spec['qualities']
            count = sum(1 for tag in wanted if evidence(text, tag))
            if count < 2:
                continue
            candidates.append((count + (2 if JUNIOR_RE.search(text) else 0), record))
        candidates.sort(key=lambda item: (-item[0], item[1]['_row']))
        selected = []
        for _, record in candidates:
            if record['岗位编码'] in claimed_codes:
                continue
            if content_sha(record) in claimed_contents:
                audit_state['content_duplicate_skips'] += 1
                continue
            claimed_codes.add(record['岗位编码'])
            claimed_contents.add(content_sha(record))
            selected.append(record)
            if len(selected) >= SAMPLES_PER_JOB:
                break
        assert len(selected) >= MIN_SUPPORTING_SAMPLES, spec['id'] + ': not enough supporting samples'
        audit_state['candidates'][spec['id']] = len(candidates)

        samples = []
        for record in selected:
            source_id = 'row-' + str(record['_row'])
            salary_data = salary(record['薪资范围'])
            missing = sorted(k for k, v in record.items() if not v and not k.startswith('_'))
            markers = {name: value.strip() for name, value in STATUS_MARKER_RE.findall(record['岗位详情'])}
            claimed[source_id] = {'row': record['_row'], 'code': record['岗位编码'], 'profile': spec['id'],
                                  'source_id': source_id, 'titles': titles}
            sources[source_id] = {
                'id': source_id,
                'record_type': 'recruitment_record',
                'sheet': SHEET,
                'row': record['_row'],
                'job_code': record['岗位编码'],
                'url': record['岗位来源地址'],
                'title': record['岗位名称'],
                'company': record['公司名称'],
                'company_meta': {
                    'industry': tidy_industry(record['所属行业']),
                    'size': record['公司规模'],
                    'financing_stage': record['公司类型'],
                    'profile_present': bool(record['公司详情']),
                    'missing': [k for k in ('所属行业', '公司规模', '公司类型', '公司详情') if not record[k]],
                    'note': '公司规模与融资阶段属于公司元信息，不作为学生证书或能力要求',
                },
                'detail': record['岗位详情'],
                'detail_chars': len(record['岗位详情']),
                'salary_raw': record['薪资范围'],
                'updated_raw': record['更新日期'],
                'markers': markers,
                'raw_sha256': raw_sha(record),
                'content_sha256': content_sha(record),
                'duplicate_rows_merged': record['_dup_rows'],
                'version': meta[record['_row']],
                'used_by_profile': spec['id'],
            }
            samples.append({
                'id': source_id,
                'record_type': 'recruitment_record',
                'job_code': record['岗位编码'],
                'company': record['公司名称'],
                'city': city_of(record['地址']),
                'city_raw': re.split(r'[-·]', record['地址'])[0].strip(),
                'address': scrub_missing_tokens(record['地址']),
                'salary': salary_data,
                'updated_raw': record['更新日期'],
                'url': record['岗位来源地址'],
                'source_id': source_id,
                'sample_only': True,
                'version': meta[record['_row']],
                'level_evidence': '明确出现应届/实习等描述' if JUNIOR_RE.search(record['岗位详情']) else '未明确年限；按初级画像人工筛选',
                'data_quality': {
                    'detail_chars': len(record['岗位详情']),
                    'detail_incomplete': len(record['岗位详情']) < MIN_DETAIL_CHARS,
                    'missing_fields': missing,
                    'salary_parsed': salary_data['min'] is not None,
                    'salary_period': salary_data['period'],
                    'updated_has_year': bool(re.search(r'[0-9]{4}\s*年', record['更新日期'])),
                    'updated_note': '招聘日期保留原文，缺少年份时不推断年份，也不代表当前仍在招聘',
                    'duplicate_rows_merged': record['_dup_rows'],
                },
            })

        requirements = []
        for tag_id in spec['skills'] + spec['qualities']:
            refs = requirement_evidence(selected, tag_id)
            assert refs, spec['id'] + ': missing evidence for ' + tag_id
            requirements.append(requirement_row(tag_id, requirement_level(refs), len(refs)))

        preferred_skills = []
        for tag in TAGS:
            if tag['dimension'] != 'skills' or tag['id'] in spec['skills']:
                continue
            refs = []
            for record in selected:
                source_id = 'row-' + str(record['_row'])
                for ref in mention_refs(record['岗位详情'], tag['id'], limit=2):
                    if ref['preference']:
                        refs.append({'source_id': source_id, **ref})
            if refs:
                preferred_skills.append({
                    'tag_id': tag['id'], 'label': tag['label'], 'dimension': 'skills',
                    'requirement': 'preferred', 'required': False, 'required_level': None,
                    'evidence': evidence_by_source(refs, 2),
                    'evidence_count': len(refs),
                    'selection_basis': '样本以优先/加分措辞提及，只作补充建议，不进入基础分分母，也不代表已掌握。',
                })

        certificates = []
        required_certificates = []
        preferred_certificates = []
        for tag in TAGS:
            if tag['dimension'] != 'certificates':
                continue
            mentions, status, required_count, classifications = certificate_rows(selected, tag['id'])
            row = {
                'tag_id': tag['id'], 'label': tag['label'], 'dimension': 'certificates',
                'status': status, 'required': status == 'required',
                'mention_count': len(mentions), 'mandatory_mention_count': required_count,
                'classifications': classifications,
                'evidence': mentions[:3],
                'selection_basis': CERT_RULE,
            }
            certificates.append(row)
            if status == 'required':
                required_certificates.append({
                    'tag_id': tag['id'], 'label': tag['label'], 'dimension': 'certificates',
                    'requirement': 'required', 'required_level': 1,
                    'level_source': 'binary_requirement', 'level_rule_version': None,
                    'level_basis': CERT_LEVEL_BASIS,
                    'mention_count': len(mentions), 'mandatory_mention_count': required_count,
                    'classifications': classifications,
                    'evidence': mentions[:EVIDENCE_LIMIT],
                    'evidence_count': min(len(mentions), EVIDENCE_LIMIT),
                    'evidence_shown': min(len(mentions), EVIDENCE_LIMIT),
                    'selection_basis': CERT_RULE,
                })
            elif status == 'preferred':
                preferred_certificates.append({
                    'tag_id': tag['id'], 'label': tag['label'], 'dimension': 'certificates',
                    'requirement': 'preferred', 'required': False, 'required_level': None,
                    'mention_count': len(mentions), 'mandatory_mention_count': required_count,
                    'classifications': classifications,
                    'evidence': mentions[:EVIDENCE_LIMIT],
                    'evidence_count': min(len(mentions), EVIDENCE_LIMIT),
                    'evidence_shown': min(len(mentions), EVIDENCE_LIMIT),
                    'selection_basis': CERT_RULE,
                })
        requirements.extend(required_certificates)
        preferred = preferred_skills + preferred_certificates
        assert all(row['requirement'] == 'preferred' and not row['required'] for row in preferred), spec['id']

        dimensions = {}
        for dimension in DIMENSION_ORDER:
            ids = [t['id'] for t in TAGS if t['dimension'] == dimension]
            required_ids = [r['tag_id'] for r in requirements if r['dimension'] == dimension]
            preferred_ids = [r['tag_id'] for r in preferred if r['dimension'] == dimension]
            dimensions[dimension] = {
                'label': DIMENSION_LABELS[dimension],
                'required': required_ids,
                'preferred': [i for i in preferred_ids if i not in required_ids],
                'unmentioned': [i for i in ids if i not in required_ids and i not in preferred_ids],
            }

        jobs.append({
            'id': spec['id'],
            'record_type': 'typical_profile',
            'name': spec['name'],
            'family': spec['name'],
            'level': '初级能力基线',
            'summary': spec['summary'],
            'monogram': spec['monogram'],
            'color': spec['color'],
            'requirements': requirements,
            'preferred': preferred,
            'certificates': certificates,
            'dimensions': dimensions,
            'certificate_note': ('证书结论来自样本明确措辞与语言/证书章节：不少于两份样本写成硬性要求才列为必需；'
                                 '未提及不等于无要求，公司资质与公司认证不作为学生证书要求。'),
            'profile_basis': '由同族招聘记录归纳的初级画像，非任一广告的完整要求',
            'evidence_summary': {
                'supporting_samples': len(samples),
                'candidate_records': len(candidates),
                'requirements_with_evidence': sum(1 for r in requirements if r['evidence']),
                'sources': [s['source_id'] for s in samples],
            },
            'samples': samples,
            'version': VERSION,
        })
    return sources, jobs


def build_paths(jobs):
    nodes, edges = [], []
    for job in jobs:
        for index, stage in enumerate(STAGES):
            nodes.append({
                'id': job['id'] if index == 0 else job['id'] + '-' + str(index),
                'job_id': job['id'],
                'label': job['name'] if index == 0 else stage + job['name'],
                'stage': index,
                'stage_label': stage,
                'track': 'promotion',
            })
        for index in range(len(STAGES) - 1):
            edges.append({
                'id': job['id'] + '-promotion-' + str(index),
                'source': job['id'] if index == 0 else job['id'] + '-' + str(index),
                'target': job['id'] + '-' + str(index + 1),
                'type': 'promotion',
                'plan_required': True,
                'transferable': ['延续本岗位核心技能与项目经验'],
                'gaps': ['独立承担复杂模块'] if index == 0 else ['系统设计、技术指导与跨团队协作'],
                'activity': '用可展示的项目成果和复盘记录验证下一阶段能力',
                'source_type': '人工整理建议；非招聘样本证实的晋升承诺',
                'relation_version': RELATION_VERSION,
            })
    for source, target, transferable, gaps, activity, required in TRANSITIONS:
        edges.append({
            'id': source + '-to-' + target,
            'source': source,
            'target': target,
            'type': 'transition',
            'plan_required': required,
            'transferable': transferable,
            'gaps': gaps,
            'activity': activity,
            'source_type': '人工整理的条件性换岗建议，相关能力不代表已掌握',
            'relation_version': RELATION_VERSION,
        })
    index = {}
    for job in jobs:
        index[job['id']] = sorted(e['target'] for e in edges if e['type'] == 'transition' and e['source'] == job['id'])
    return {
        'nodes': nodes,
        'edges': edges,
        'stages': {job['id']: STAGES for job in jobs},
        'transition_index': index,
        'relation_version': RELATION_VERSION,
        'note': '晋升关系为同岗位族内的能力阶段说明；换岗关系为条件性建议，不承诺可直接转岗。阶段节点不作为独立推荐岗位。',
    }


def verify(data, verbose=False):
    checks = []

    def check(name, ok, detail=''):
        checks.append({'check': name, 'ok': bool(ok), 'detail': str(detail)})

    jobs, sources = data['jobs'], data['sources']
    versions = data['code_versions']
    check('six_profiles', len(jobs) == 6, str(len(jobs)) + ' profiles')
    check('samples_meet_minimum', all(len(job['samples']) >= MIN_SUPPORTING_SAMPLES for job in jobs),
          {job['id']: len(job['samples']) for job in jobs})
    codes = [s['job_code'] for job in jobs for s in job['samples']]
    check('sample_codes_unique', len(codes) == len(set(codes)), str(len(codes)) + '/' + str(len(set(codes))))
    contents = [content_sha_from_sample(s) for job in jobs for s in job['samples']]
    check('sample_contents_unique', len(contents) == len(set(contents)), '')
    check('samples_traceable', all(s.get('source_id') and s.get('job_code') and s.get('version') and s.get('city') for job in jobs for s in job['samples']), '')
    check('sources_traceable', all(s.get('row') and s.get('job_code') and s.get('url') and s.get('sheet') and s.get('raw_sha256') for s in sources.values()), '')
    check('sample_version_index_complete',
          all(versions.get(s['job_code'], {}).get('versions') and
              any(v['row'] == sources[s['source_id']]['row'] and v['retained'] for v in versions[s['job_code']]['versions'])
              for job in jobs for s in job['samples']), '')
    check('version_index_has_hashes',
          all(v.get('content_sha256') and v.get('raw_sha256') for entry in versions.values() for v in entry['versions']), '')
    check('version_index_raw_hashes_unique',
          all(len({v['raw_sha256'] for v in entry['versions']}) == len(entry['versions'])
              for entry in versions.values()), '')
    check('version_index_keeps_differing_versions',
          all(entry['distinct_versions'] == len(entry['versions']) for entry in versions.values()), '')

    evidence_ok, witness_ok, preference_ok = True, True, True
    for job in jobs:
        for requirement in job['requirements']:
            if not requirement.get('evidence'):
                evidence_ok = False
                continue
            for ref in requirement['evidence']:
                record = sources.get(ref['source_id'])
                if not record or not ref['quote'] or ref['quote'] not in record['detail']:
                    evidence_ok = False
            if requirement.get('level_source') == 'level_rule':
                witness = requirement.get('level_witness') or {}
                if witness.get('source_id') not in [ref['source_id'] for ref in requirement['evidence']]:
                    witness_ok = False
                if not requirement.get('level_observations'):
                    witness_ok = False
            if not any(not ref.get('preference') for ref in requirement['evidence']):
                preference_ok = False
    check('every_requirement_traces_to_source', evidence_ok, '')
    check('level_witness_inside_evidence', witness_ok, '')
    check('requirement_evidence_not_only_preference', preference_ok, '')

    check('no_senior_samples', not [s['source_id'] for job in jobs for s in job['samples'] if seniority_hits(sources[s['source_id']]['detail'])], '')
    check('no_senior_evidence', not [ref['source_id'] for job in jobs for r in job['requirements'] for ref in r['evidence'] if seniority_hits(ref['quote'])], '')

    votes_ok = True
    for job in jobs:
        for requirement in job['requirements']:
            if requirement['dimension'] == 'certificates':
                continue
            counted = requirement.get('level_observation_sources') or []
            optional = requirement.get('level_preference_sources') or []
            if len(counted) != len(set(counted)):
                votes_ok = False
            if set(counted) & set(optional):
                votes_ok = False
            observations = requirement.get('level_observations') or {}
            if sum(observations.values()) != len(counted):
                votes_ok = False
            notes = requirement.get('level_preference_observations') or {}
            if sum(notes.values()) != len(optional):
                votes_ok = False
            witness = requirement.get('level_witness') or {}
            if witness and witness.get('source_id') not in counted:
                votes_ok = False
            if requirement['level_source'] == 'level_rule' and (not counted or observations.get(str(requirement['required_level']), 0) == 0):
                votes_ok = False
    check('level_votes_unique_sources_without_preference', votes_ok, '')

    skill_levels_ok = True
    rule_version_ok = True
    for job in jobs:
        for requirement in job['requirements']:
            if requirement['dimension'] == 'certificates':
                if requirement['required_level'] != 1 or requirement['level_source'] != 'binary_requirement' or requirement['level_rule_version']:
                    rule_version_ok = False
                continue
            if not 1 <= requirement['required_level'] <= 3:
                skill_levels_ok = False
            if requirement['level_source'] == 'level_rule':
                if requirement['level_rule_version'] != LEVEL_RULE_VERSION:
                    rule_version_ok = False
            elif requirement['level_source'] == 'default_baseline':
                if requirement['level_rule_version'] is not None or '默认' not in requirement['level_basis']:
                    rule_version_ok = False
            else:
                rule_version_ok = False
    check('skill_levels_in_range', skill_levels_ok, '')
    check('level_source_matches_rule_version', rule_version_ok, '')

    salaries = [s['salary'] for job in jobs for s in job['samples']]
    parsed = sum(1 for s in salaries if s['min'] is not None)
    check('salary_bounds_parsed', parsed > 0, str(parsed) + '/' + str(len(salaries)) + ' parsed')
    check('salary_periods_retained', all(s['period'] in SALARY_PERIODS for s in salaries), dict(Counter(s['period'] for s in salaries)))
    check('salary_unknown_present', any(s['period'] == 'negotiable' or s['min'] is None for s in salaries), '')
    check('salary_never_converts_day_rate', all(s['period'] != 'month' or '元/天' not in s['raw'] for s in salaries), '')

    certificate_ok, certificate_evidence_ok = True, True
    for job in jobs:
        required_ids = {r['tag_id'] for r in job['requirements'] if r['dimension'] == 'certificates'}
        declared_required = {c['tag_id'] for c in job['certificates'] if c['status'] == 'required'}
        if required_ids != declared_required:
            certificate_ok = False
        if any(c['status'] not in ('required', 'preferred', 'unmentioned') for c in job['certificates']):
            certificate_ok = False
        for certificate in job['certificates']:
            for mention in certificate['evidence']:
                if COMPANY_CREDENTIAL_RE.search(mention['quote']) or mention['quote'] not in sources[mention['source_id']]['detail']:
                    certificate_evidence_ok = False
    check('certificate_status_matches_requirements', certificate_ok, '')
    check('certificate_evidence_is_personal', certificate_evidence_ok, '')
    check('certificates_cover_all_dimension_tags',
          all(len(job['certificates']) == sum(1 for t in TAGS if t['dimension'] == 'certificates') for job in jobs), '')

    check('preferred_rows_are_optional',
          all(r.get('requirement') == 'preferred' and r.get('required') is False and not r.get('required_level')
              for job in jobs for r in job['preferred']), '')
    check('preferred_dimensions_valid',
          all(r['dimension'] in DIMENSION_ORDER for job in jobs for r in job['preferred']), '')
    check('preferred_not_in_required',
          all(r['tag_id'] not in {x['tag_id'] for x in job['requirements']} for job in jobs for r in job['preferred']), '')
    check('dimension_lists_consistent',
          all(set(entry['required']) | set(entry['preferred']) | set(entry['unmentioned']) ==
              {t['id'] for t in TAGS if t['dimension'] == dimension}
              for job in jobs for dimension, entry in job['dimensions'].items()), '')

    transitions = [e for e in data['paths']['edges'] if e['type'] == 'transition']
    per_job = {job['id']: sum(1 for e in transitions if e['source'] == job['id']) for job in jobs}
    check('two_transitions_each_profile', all(v >= 2 for v in per_job.values()), per_job)
    mandated = {(a, b) for a, b, c, d, e, f in TRANSITIONS if f}
    present = {(e['source'], e['target']) for e in transitions}
    check('plan_transitions_present', mandated.issubset(present), sorted(mandated - present))
    node_ids = {n['id'] for n in data['paths']['nodes']}
    dangling = [e['id'] for e in data['paths']['edges'] if e['source'] not in node_ids or e['target'] not in node_ids]
    check('no_dangling_path_nodes', not dangling, dangling)
    check('path_edges_carry_guidance', all(e.get('activity') and e.get('gaps') and e.get('transferable') and e.get('source_type') for e in data['paths']['edges']), '')

    check('rule_versions_present', bool(data['rule_versions']['level_rule'] and data['rule_versions']['relation'] and data['rule_versions']['tag_dictionary']), '')
    check('no_tool_alias_generalisation',
          not [alias for tag in data['tags'] for alias in tag['aliases'] if alias.strip().casefold() in FORBIDDEN_ALIASES], '')
    check('sql_not_generic_database', tag_mentions('熟悉数据库设计与优化', 'sql') == [], '')
    check('sql_matches_standalone_token_only',
          all(tag_mentions(text, 'sql') for text in SQL_POSITIVE_SAMPLES)
          and not [text for text in SQL_NEGATIVE_SAMPLES if tag_mentions(text, 'sql')],
          {'positive': SQL_POSITIVE_SAMPLES, 'negative': SQL_NEGATIVE_SAMPLES})
    check('mysql_matches_standalone_token_only',
          bool(tag_mentions('熟悉MySQL', 'mysql')) and not tag_mentions('MySQLProxy 连接池', 'mysql'), '')
    sql_evidence_ok = True
    for job in jobs:
        for row in list(job['requirements']) + list(job['preferred']):
            if row['tag_id'] != 'sql':
                continue
            for ref in row['evidence']:
                if not tag_mentions(ref['quote'], 'sql'):
                    sql_evidence_ok = False
    check('sql_evidence_is_standalone_token', sql_evidence_ok, '')
    check('api_testing_not_tool_only', tag_mentions('使用 Postman 和 JMeter 发请求', 'api-testing') == [], '')
    check('soft_exam_no_false_positive', tag_mentions('提高项目整体效率', 'soft-exam') == [], '')
    check('required_items_are_required',
          all(r.get('requirement') == 'required' for job in jobs for r in job['requirements']), '')
    if verbose:
        print(json.dumps(checks, ensure_ascii=False, indent=1))
    return checks


def content_sha_from_sample(sample):
    return sample.get('version', {}).get('content_sha256', '')


def summarize(data, checks, sources, jobs):
    salaries = [s['salary'] for job in jobs for s in job['samples']]
    requirement_rows = [r for job in jobs for r in job['requirements']]
    return {
        'version': VERSION,
        'profiles': len(jobs),
        'supporting_samples': len(sources),
        'records_per_profile': {job['id']: len(job['samples']) for job in jobs},
        'path_nodes': len(data['paths']['nodes']),
        'path_edges': len(data['paths']['edges']),
        'transitions_per_profile': data['paths']['transition_index'],
        'salary_periods': dict(sorted(Counter(s['period'] for s in salaries).items())),
        'salary_parsed': sum(1 for s in salaries if s['min'] is not None),
        'salary_with_extra_months': sum(1 for s in salaries if s['extra_months']),
        'certificate_status': {job['id']: dict(sorted(Counter(c['status'] for c in job['certificates']).items())) for job in jobs},
        'level_sources': dict(sorted(Counter(r['level_source'] for r in requirement_rows).items())),
        'levels_used': {str(k): v for k, v in sorted(Counter(r['required_level'] for r in requirement_rows).items())},
        'evidence_levels_observed': {str(k): v for k, v in sorted(Counter(
            ref['level'] for job in jobs for r in job['requirements'] for ref in r['evidence'] if ref.get('level')).items())},
        'preferred_dimensions': dict(sorted(Counter(r['dimension'] for job in jobs for r in job['preferred']).items())),
        'version_index': {k: data['audit']['version_index'][k] for k in ('codes_indexed', 'versions_total')},
        'checks_failed': [c['check'] for c in checks if not c['ok']],
        'file': str(TARGET),
    }


def build_payload():
    df, raw_records = load_records()
    unique = dedupe(raw_records)
    meta = version_meta(unique)
    claimed, audit_state = {}, {
        'senior_rows': set(), 'senior_phrases': Counter(),
        'unsupported_salary_skips': 0, 'content_duplicate_skips': 0, 'candidates': {},
        'merged_rows_total': len(raw_records) - len(unique),
    }
    sources, jobs = build_jobs(unique, meta, claimed, audit_state)
    code_versions = build_code_versions(unique, claimed, audit_state['senior_rows'])
    data = {
        'version': VERSION,
        'source_file': SOURCE.name,
        'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'source_read_only': True,
        'sample_label': '赛题样本',
        'rule_versions': {
            'profile': VERSION,
            'level_rule': LEVEL_RULE_VERSION,
            'level_mapping': LEVEL_MAPPING,
            'level_default': LEVEL_DEFAULT,
            'relation': RELATION_VERSION,
            'tag_dictionary': TAG_DICTIONARY_VERSION,
        },
        'levels': LEVELS,
        'level_policy': {
            'scored_field': 'required_level',
            'wording_rule': LEVEL_WORDING_RULE,
            'aggregation_rule': LEVEL_AGGREGATION_RULE,
            'default_baseline': LEVEL_DEFAULT,
            'default_basis': DEFAULT_LEVEL_BASIS,
            'excluded_wording': '掌握/精通/扎实/良好/使用/基础/理解/初步 等泛词一律不映射为等级。',
            'binary_dimensions': ['certificates'],
            'note': ('每个要求都带 level_source：level_rule 表示由样本明确措辞聚合得到，'
                     'default_baseline 表示样本未明确措辞而使用默认 2；证书为二元要求，等级字段固定 1。'),
        },
        'salary_policy': {
            'retained_periods': list(SALARY_PERIODS),
            'unsupported_periods': list(UNSUPPORTED_SALARY_PERIODS),
            'note': ('面议与无法解析的薪资保留在样本中，只有调用方真正启用薪资筛选时才排除；'
                     '按小时/年/周计薪属于另一种计薪周期，不当作“未知”，也不做隐式换算。'),
        },
        'dimension_labels': DIMENSION_LABELS,
        'tags': [{'id': t['id'], 'label': t['label'], 'dimension': t['dimension'],
                  'dimension_label': DIMENSION_LABELS[t['dimension']], 'aliases': t['aliases']} for t in TAGS],
        'disclaimers': [
            '招聘记录为赛题样本，更新日期保留原文，不代表当前仍在招聘。',
            '公司规模、公司类型（融资阶段）等为公司元信息，不构成学生证书或能力要求。',
            '日期缺少年份时不做年份推断；同一岗位编码的不同内容版本全部保留，不判断先后。',
            '画像为多份样本归纳、待主控审定的初级能力基线，不是任一招聘广告的完整要求。',
            '日薪与月薪分别保存与筛选，未做隐式换算；未设置薪资筛选时保留面议与未知薪资记录。',
            '换岗路径为人工整理的条件性建议，不承诺可直接转岗。',
            '等级来自样本明确措辞的众数；样本未明确措辞时使用系统默认等级 2 并单独标记。',
        ],
        'jobs': jobs,
        'paths': build_paths(jobs),
        'sources': sources,
        'code_versions': code_versions,
        'relations': [
            {'from': 'spring-cloud', 'to': 'spring-boot', 'weight': 0.25, 'reason': '同属 Spring 生态，仅体现相关基础，不能证明掌握 Spring Boot', 'relation_version': RELATION_VERSION},
            {'from': 'mysql', 'to': 'sql', 'weight': 0.25, 'reason': '数据库工具经验可提供部分 SQL 背景，仍需确认查询能力', 'relation_version': RELATION_VERSION},
            {'from': 'react', 'to': 'vue', 'weight': 0.25, 'reason': '组件化前端经验可迁移，仍需学习 Vue 具体机制', 'relation_version': RELATION_VERSION},
            {'from': 'automated-testing', 'to': 'api-testing', 'weight': 0.25, 'reason': '自动化脚本经验包含接口调用实践，仍需确认接口测试设计能力', 'relation_version': RELATION_VERSION},
        ],
        'audit': {
            'raw_rows': len(df),
            'columns': list(df.columns),
            'missing': {k: int(v) for k, v in df.isna().sum().items()},
            'exact_duplicate_rows': int(df.duplicated().sum()),
            'duplicate_code_rows': int(df['岗位编码'].duplicated().sum()),
            'retained_source_rows': len(sources),
            'dedupe_merged_rows_total': audit_state['merged_rows_total'],
            'dedupe_merged_rows_in_samples': sum(len(s['duplicate_rows_merged']) for s in sources.values()),
            'dedupe_order': '先按原始全字段签名去重，再清理展示标记；清理后不再合并，避免吞掉写法不同的记录。',
            'content_duplicate_skips': audit_state['content_duplicate_skips'],
            'content_duplicate_note': '正文、地址、薪资、岗位名完全相同的记录即使在原表中编码不同也只保留一条，避免同一职位重复出现在推荐里。',
            'profiles': len(jobs),
            'records_per_profile': {job['id']: len(job['samples']) for job in jobs},
            'candidate_records': dict(sorted(audit_state['candidates'].items())),
            'version_index': {
                'codes_indexed': len(code_versions),
                'versions_total': sum(entry['distinct_versions'] for entry in code_versions.values()),
                'senior_versions_recorded': sum(1 for entry in code_versions.values() for v in entry['versions']
                                                if v['reason'] == 'senior_requirement_version_not_used'),
                'duplicate_content_versions': sum(1 for entry in code_versions.values() for v in entry['versions']
                                                  if v['reason'] == 'duplicate_content_version'),
                'order_basis': ORDER_BASIS,
                'note': ('同一岗位编码在本样本中可能对应内容不同的多条招聘记录；索引保留全部版本、原始行号与哈希，'
                         '不推断时间新旧，高级版本不作为初级画像证据，同一编码最多由一个画像引用以避免推荐重复职位。'),
            },
            'seniority_filter': {
                'min_years_excluded': LEVEL_MIN_YEARS,
                'excluded_records': len(audit_state['senior_rows']),
                'matched_wording': [phrase for phrase, _ in audit_state['senior_phrases'].most_common(12)],
                'note': ('招聘详情出现 3 年以上、资深、架构师 等措辞的记录不进入初级画像；'
                         '1-3 年、应届、经验不限保留。句子级同样排除高级措辞，不把高级证据当初级要求。'),
            },
            'salary_filter': {
                'retained_periods': list(SALARY_PERIODS),
                'unsupported_candidate_skips': audit_state['unsupported_salary_skips'],
                'note': '面议与未解析薪资保留；按小时/年/周的记录不进入样本，因为它们是另一种计薪周期而非“未知”。',
            },
            'certificate_status': {job['id']: dict(sorted(Counter(c['status'] for c in job['certificates']).items())) for job in jobs},
            'salary_periods': dict(sorted(Counter(s['salary']['period'] for job in jobs for s in job['samples']).items())),
            'salary_parsed': sum(1 for job in jobs for s in job['samples'] if s['salary']['min'] is not None),
            'salary_unparsed_raw': sorted({s['salary']['raw'] for job in jobs for s in job['samples'] if s['salary']['min'] is None})[:10],
            'level_sources': dict(sorted(Counter(r['level_source'] for job in jobs for r in job['requirements']).items())),
            'levels_used': {str(k): v for k, v in sorted(Counter(r['required_level'] for job in jobs for r in job['requirements']).items())},
            'preferred_dimensions': dict(sorted(Counter(r['dimension'] for job in jobs for r in job['preferred']).items())),
            'notes': [
                '去重只依据原始全字段是否完全一致；同编码不同内容按版本索引保留，不猜时间新旧',
                '未知薪资（面议、未解析）保留在样本中，只有启用薪资筛选时才排除；日薪不与月薪换算',
                '等级由样本明确措辞（了解=1/熟悉=2/熟练=3）按最近前置措辞与众数聚合，未明确才用默认 2',
                '核心要求证据不能全部来自“优先/否定”措辞；等级 witness 一定包含在证据列表中',
                '技能优先项进入 preferred（不计入基础分分母）；必需证书进入 requirements 的证书维度',
                '证书仅在明确硬性或语言/证书章节中出现，且不少于两份样本要求时才算必需；公司认证不计入',
                '高级/资深与 3 年以上年限措辞被排除，原句也不作为证据',
                '标签词典不再把“数据库”当作 SQL，也不把 Postman/JMeter/Selenium/Appium 当作能力标签',
                'SQL 按 ASCII token 匹配（与 llm.mentions_alias 同一口径）：MySQL/NoSQL/PostgreSQL 不算 SQL，'
                '“SQL Server”里的独立 SQL 算，MySQL 由 mysql 标签单独计',
            ],
        },
    }
    checks = verify(data)
    data['audit']['checks'] = checks
    data['audit']['checks_failed'] = [c['check'] for c in checks if not c['ok']]
    return data


def serialize(data):
    return json.dumps(data, ensure_ascii=False, indent=2)


def digest_quote(text, limit=110):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[:limit] + '…'


def review_digest(data):
    """待主控审定用的逐画像证据摘要：标签、等级、等级来源、证据来源与原文引用。"""
    lines = [
        '# 岗位画像证据摘要（' + VERSION + '，待主控审定）',
        '',
        '本文件由 scripts/build_data.py 自动生成，与 backend/data/career-data.json 同步，',
        '只陈述样本证据与脚本推导结果，**不代表已经人工或主控审定**；需由主控复核并签署 PINNED 后才作为交付口径。',
        '',
        '等级列含义：level_rule = 由样本明确措辞的众数得到，default_baseline = 样本未明确措辞而使用默认 2，',
        'binary_requirement = 证书二元要求。票数括号内为各等级票数，只统计非优先措辞样本，每个来源一票。',
        'SQL / MySQL 使用 ASCII token 边界：SQL 只取独立的 SQL 词，MySQL/NoSQL/PostgreSQL 不计入 SQL；其他标签按各自词典规则识别。',
        '',
        '完整原文、逐条分类与哈希见 backend/data/career-data.json（sources / code_versions）。',
        '',
    ]
    for job in data['jobs']:
        lines.append('## ' + job['name'] + '（' + job['id'] + '，支持样本 ' + str(len(job['samples'])) + ' 条）')
        lines.append('')
        lines.append('| 标签 | 维度 | 等级 | 等级来源 | 票数 | 证据来源与引用 |')
        lines.append('|---|---|---|---|---|---|')
        for row in job['requirements']:
            if row['dimension'] == 'certificates':
                votes = '硬性提及 ' + str(row.get('mandatory_mention_count', 0)) + ' 份'
            else:
                votes = '、'.join(k + '级 ' + str(v) + ' 票' for k, v in sorted((row.get('level_observations') or {}).items())) or '无明确措辞'
                optional = row.get('level_preference_observations') or {}
                if optional:
                    votes += '（另有优先措辞 ' + '、'.join(k + '级 ' + str(v) for k, v in sorted(optional.items())) + '，不计票）'
            evidence = '；'.join(ref['source_id'] + '「' + digest_quote(ref['quote']) + '」' for ref in row['evidence'])
            lines.append('| ' + row['label'] + ' | ' + DIMENSION_LABELS[row['dimension']] + ' | '
                         + str(row['required_level']) + ' | ' + row['level_source'] + ' | ' + votes + ' | ' + evidence + ' |')
        lines.append('')
        if job['preferred']:
            lines.append('优先项（不计入基础分分母）')
            lines.append('')
            lines.append('| 标签 | 维度 | 说明 | 证据来源与引用 |')
            lines.append('|---|---|---|---|')
            for row in job['preferred']:
                note = '证书：硬性提及 ' + str(row.get('mandatory_mention_count', 0)) + ' 份' if row['dimension'] == 'certificates' else '技能：样本以优先/加分措辞提及'
                evidence = '；'.join(ref['source_id'] + '「' + digest_quote(ref['quote']) + '」' for ref in row['evidence'])
                lines.append('| ' + row['label'] + ' | ' + DIMENSION_LABELS[row['dimension']] + ' | ' + note + ' | ' + evidence + ' |')
            lines.append('')
        mentioned = [c for c in job['certificates'] if c['status'] != 'unmentioned']
        unmentioned = [c['label'] for c in job['certificates'] if c['status'] == 'unmentioned']
        lines.append('证书维度：' + ('提及 ' + str(len(mentioned)) + ' 项' if mentioned else '样本均未提及'))
        for certificate in mentioned:
            detail = '；'.join(mention['source_id'] + '[' + mention['classification'] + ']「' + digest_quote(mention['quote']) + '」'
                               for mention in certificate['evidence'])
            lines.append('- ' + certificate['label'] + '：' + certificate['status'] + '（' + detail + '）')
        lines.append('- 未提及（不等于无要求）：' + ('、'.join(unmentioned) if unmentioned else '无'))
        lines.append('')
    return '\n'.join(lines) + '\n'


def build():
    data = build_payload()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(serialize(data) + '\n', encoding='utf-8')
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.write_text(review_digest(data), encoding='utf-8')
    checks = data['audit']['checks']
    print(json.dumps(summarize(data, checks, data['sources'], data['jobs']), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    build()
