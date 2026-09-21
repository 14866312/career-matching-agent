"""匹配与推荐的确定性测试。

分两部分，避免算法测试被生产数据重建牵连：

1) 冻结画像测试：FROZEN_TAGS / FROZEN_PROFILES 在测试内冻结一份与 career-1.1 同形的画像契约，
   通过 monkeypatch 注入 matching.dataset，算法期望值全部由人工按公式独立算得，不读取 backend/data。
2) 生产数据契约测试（文件名以 test_production_ 开头）：核对 6 个画像、标签等级、关联表和薪资标记；
   数据重建后先在这里失败，提示需要重新人工审定期望，而不是直接改算法。

公式（人工独立计算，未调用被测实现）：
    基础分 = 已满足必需标签数 ÷ 必需标签总数 × 100
    增强分 = 逐项贡献之和 ÷ 要求总数 × 100
    技能贡献 = min(学生等级 ÷ 要求等级, 1)
    证书 / 通用素质贡献 = 明确满足为 1，否则为 0（不按等级折算）
    相关技能贡献 = min(关联权重, 0.25)，同一要求多个关联取最大值，不累加
    优先项 preferred 与未提及 unmentioned 都不进入分母

排序契约：分数降序，同分直接按岗位 ID 升序，不再比较满足项数或要求项数。
确认契约：StudentProfile.confirmed 是"整份画像是否已确认"的开关，由调用方在正式匹配前拦截；
          评分函数只按每个 Ability.confirmed 计算，并回传 profile_confirmed。
分数比较用 pytest.approx(rel=1e-9) 吸收浮点表示差异；计数、状态、排序用精确比较。
"""

import itertools

import pytest
from backend.app import matching
from backend.app.data import dataset, get_job
from backend.app.matching import canonical, match_student, parse_salary, recommendations
from backend.app.models import Ability, Filters, Intention, StudentProfile

# --------------------------------------------------------------------------------------
# 冻结画像契约（与 career-1.1 同形）
# --------------------------------------------------------------------------------------
FROZEN_TAGS = [
    ('html', 'HTML', 'skills', ['html5']),
    ('css', 'CSS', 'skills', ['css3']),
    ('javascript', 'JavaScript', 'skills', ['js']),
    ('vue', 'Vue', 'skills', ['vue.js', 'vue3']),
    ('react', 'React', 'skills', ['react.js']),
    ('git', 'Git', 'skills', []),
    ('http', 'HTTP', 'skills', []),
    ('java', 'Java', 'skills', []),
    ('spring-boot', 'Spring Boot', 'skills', ['springboot']),
    ('spring-cloud', 'Spring Cloud', 'skills', ['springcloud']),
    ('python', 'Python', 'skills', []),
    ('sql', 'SQL', 'skills', []),
    ('mysql', 'MySQL', 'skills', []),
    ('linux', 'Linux', 'skills', []),
    ('cpp', 'C/C++', 'skills', ['c++', 'c', 'c语言']),
    ('data-structures', '数据结构', 'skills', []),
    ('algorithms', '算法基础', 'skills', ['算法']),
    ('test-cases', '测试用例设计', 'skills', ['测试用例']),
    ('functional-testing', '功能测试', 'skills', []),
    ('api-testing', '接口测试', 'skills', []),
    ('automated-testing', '自动化测试', 'skills', []),
    ('deployment', '软件部署', 'skills', ['部署']),
    ('troubleshooting', '故障排查', 'skills', ['故障定位']),
    ('networking', '网络基础', 'skills', []),
    ('documentation', '技术文档', 'skills', ['文档编写']),
    ('communication', '沟通表达', 'qualities', ['沟通能力']),
    ('teamwork', '团队协作', 'qualities', ['团队合作']),
    ('learning', '学习能力', 'qualities', []),
    ('cet4', '大学英语四级', 'certificates', ['cet-4', '英语四级']),
    ('cet6', '大学英语六级', 'certificates', ['cet-6']),
    ('soft-exam', '软件资格考试（软考）', 'certificates', ['软考']),
    ('vendor-cert', '网络/厂商认证', 'certificates', []),
    ('istqb', '测试认证（ISTQB）', 'certificates', []),
]
TAG_LABELS = {tag: label for tag, label, _, _ in FROZEN_TAGS}
TAG_DIMENSIONS = {tag: dimension for tag, _, dimension, _ in FROZEN_TAGS}

FROZEN_PROFILES = {
    'frontend': {
        'name': '前端开发工程师',
        'required': [('html', 3), ('css', 3), ('javascript', 3), ('vue', 3), ('communication', 2), ('teamwork', 2)],
        'preferred': ['soft-exam'],
    },
    'java': {
        'name': 'Java 开发工程师',
        'required': [('java', 2), ('spring-boot', 2), ('sql', 2), ('mysql', 2), ('communication', 2), ('teamwork', 2)],
        'preferred': ['cet4'],
    },
    'cpp': {
        'name': 'C/C++ 开发工程师',
        'required': [('cpp', 2), ('data-structures', 2), ('algorithms', 2), ('linux', 2), ('teamwork', 2), ('learning', 2)],
        'preferred': ['cet4'],
    },
    'testing': {
        'name': '软件测试工程师',
        'required': [('test-cases', 2), ('functional-testing', 1), ('api-testing', 2), ('sql', 2), ('communication', 2), ('teamwork', 2)],
        'preferred': ['cet4', 'vendor-cert', 'istqb'],
    },
    'implementation': {
        'name': '软件实施工程师',
        'required': [('deployment', 2), ('sql', 2), ('documentation', 2), ('communication', 2), ('learning', 2)],
        'preferred': ['cet6', 'vendor-cert'],
    },
    'support': {
        'name': '技术支持工程师',
        'required': [('linux', 2), ('networking', 2), ('troubleshooting', 2), ('documentation', 2), ('communication', 2), ('teamwork', 2)],
        'preferred': ['vendor-cert'],
    },
}
FROZEN_JOB_ORDER = ('frontend', 'java', 'cpp', 'testing', 'implementation', 'support')
FROZEN_RELATIONS = [
    {'from': 'spring-cloud', 'to': 'spring-boot', 'weight': 0.25, 'reason': '同属Spring生态，仅体现相关基础，不能证明掌握Spring Boot'},
    {'from': 'mysql', 'to': 'sql', 'weight': 0.25, 'reason': '数据库工具经验可提供部分SQL背景，仍需确认查询能力'},
    {'from': 'react', 'to': 'vue', 'weight': 0.25, 'reason': '组件化前端经验可迁移，仍需学习Vue具体机制'},
    {'from': 'automated-testing', 'to': 'api-testing', 'weight': 0.25, 'reason': '自动化脚本经验可提供部分接口测试背景'},
]
_COUNTER = itertools.count(1)


def sample(sample_id, city, raw, period, low, high):
    return {
        'id': sample_id,
        'record_type': 'recruitment_record',
        'job_code': 'TEST-' + sample_id,
        'company': '测试公司',
        'city': city,
        'city_raw': city,
        'address': city + '-测试区',
        'salary': {'min': low, 'max': high, 'period': period, 'period_source': 'explicit', 'currency': 'CNY',
                   'unit_label': None, 'extra_months': 0, 'raw': raw},
        'updated_raw': '01月01日',
        'url': '',
        'source_id': sample_id,
        'sample_only': True,
        'level_evidence': '测试数据',
    }


def frozen_samples(job_id):
    return [sample(job_id + '-bj', '北京', '8000-13000元', 'month', 8000, 13000),
            sample(job_id + '-sh', '上海', '100-120元/天', 'day', 100, 120),
            sample(job_id + '-cs', '长沙', '面议', 'negotiable', None, None)]


def frozen_job(job_id, samples=None):
    spec = FROZEN_PROFILES[job_id]
    requirements = [{
        'tag_id': tag_id,
        'label': TAG_LABELS[tag_id],
        'dimension': TAG_DIMENSIONS[tag_id],
        'requirement': 'required',
        'required_level': level,
        'level_rule_version': 'level-1.0',
        'level_basis': '冻结画像：按 level-1.0 映射为等级 ' + str(level) + '（了解=1，熟悉=2，熟练=3）',
    } for tag_id, level in spec['required']]
    preferred = []
    for tag_id in spec['preferred']:
        row = {'tag_id': tag_id, 'label': TAG_LABELS[tag_id], 'dimension': TAG_DIMENSIONS[tag_id], 'evidence': []}
        if TAG_DIMENSIONS[tag_id] == 'certificates':
            row.update({'status': 'preferred', 'required': False, 'mention_count': 2, 'mandatory_mention_count': 0})
        else:
            row.update({'requirement': 'preferred', 'required_level': None})
        preferred.append(row)
    used = {r['tag_id'] for r in requirements} | {r['tag_id'] for r in preferred}
    dimensions = {}
    for dimension in ('skills', 'certificates', 'qualities'):
        dimensions[dimension] = {
            'label': {'skills': '专业技能', 'certificates': '证书要求', 'qualities': '通用素质'}[dimension],
            'required': [r['tag_id'] for r in requirements if r['dimension'] == dimension],
            'preferred': [r['tag_id'] for r in preferred if r['dimension'] == dimension],
            'unmentioned': [tag for tag, _, dim, _ in FROZEN_TAGS if dim == dimension and tag not in used],
        }
    certificates = [{
        'tag_id': tag, 'label': label, 'dimension': 'certificates',
        'status': 'preferred' if tag in {r['tag_id'] for r in preferred} else 'unmentioned',
        'required': False, 'mention_count': 0, 'mandatory_mention_count': 0, 'evidence': [],
    } for tag, label, dimension, _ in FROZEN_TAGS if dimension == 'certificates']
    return {
        'id': job_id, 'name': spec['name'], 'family': spec['name'], 'level': '初级能力基线',
        'summary': '冻结测试画像', 'monogram': 'FZ', 'color': '#000000', 'record_type': 'typical_profile',
        'profile_basis': '冻结测试画像', 'evidence_summary': {'supporting_samples': 3},
        'requirements': requirements, 'preferred': preferred, 'dimensions': dimensions,
        'certificates': certificates, 'certificate_note': '冻结测试：证书均为优先项或未提及',
        'samples': list(samples if samples is not None else frozen_samples(job_id)),
        'version': 'frozen-1.0',
    }


def build_frozen_dataset(version, jobs=None, relations=None):
    return {
        'version': version,
        'sample_label': '赛题样本',
        'disclaimers': ['招聘记录为赛题样本，更新日期保留原文，不代表当前仍在招聘。'],
        'dimension_labels': {'skills': '专业技能', 'certificates': '证书要求', 'qualities': '通用素质'},
        'rule_versions': {'profile': version, 'level_rule': 'level-1.0',
                          'level_mapping': {'了解': 1, '熟悉': 2, '熟练': 3}, 'level_default': 2,
                          'relation': 'relation-1.0', 'tag_dictionary': version},
        'levels': [{'level': 0, 'label': '未掌握'}, {'level': 1, 'label': '了解'},
                   {'level': 2, 'label': '熟悉'}, {'level': 3, 'label': '熟练'}],
        'tags': [{'id': tag, 'label': label, 'dimension': dimension, 'aliases': aliases}
                 for tag, label, dimension, aliases in FROZEN_TAGS],
        'jobs': list(jobs if jobs is not None else [frozen_job(job_id) for job_id in FROZEN_JOB_ORDER]),
        'relations': list(relations if relations is not None else FROZEN_RELATIONS),
        'paths': {'nodes': [], 'edges': []},
        'sources': {},
    }


@pytest.fixture
def frozen(monkeypatch):
    """注入冻结画像数据集；每次注入使用独立版本号，避免元信息缓存串用。"""
    def install(jobs=None, relations=None):
        data = build_frozen_dataset('frozen-test-' + str(next(_COUNTER)), jobs, relations)
        monkeypatch.setattr(matching, 'dataset', lambda: data)
        return data
    return install


def synth_job(job_id, requirement_tags, preferred_tags=(), samples=None, levels=None, dimension=None, level_basis=None):
    requirements = []
    for index, tag in enumerate(requirement_tags):
        row = {
            'tag_id': tag,
            'label': TAG_LABELS.get(tag, tag),
            'dimension': dimension or TAG_DIMENSIONS.get(tag, 'skills'),
            'requirement': 'required',
            'required_level': (levels or {}).get(tag, 2),
        }
        if level_basis is not None:
            row['level_basis'] = level_basis
        requirements.append(row)
    preferred = [{'tag_id': tag, 'label': TAG_LABELS.get(tag, tag),
                  'dimension': TAG_DIMENSIONS.get(tag, 'certificates'),
                  'status': 'preferred', 'required': False} for tag in preferred_tags]
    return {
        'id': job_id, 'name': '合成岗位-' + job_id, 'family': '合成岗位', 'level': '测试基线',
        'summary': '测试用画像', 'monogram': 'SY', 'color': '#000000',
        'requirements': requirements, 'preferred': preferred,
        'certificate_note': '测试', 'version': 'synthetic-1.0',
        'samples': list(samples if samples is not None else [sample(job_id + '-1', '北京', '8000-13000元', 'month', 8000, 13000)]),
    }


def job_of(job_id):
    return next(j for j in matching.dataset()['jobs'] if j['id'] == job_id)


# --------------------------------------------------------------------------------------
# 学生画像构造
# --------------------------------------------------------------------------------------
def _spec(entry):
    if isinstance(entry, str):
        return entry, 2, True
    values = list(entry)
    tag_id = values[0]
    level = values[1] if len(values) > 1 else 2
    confirmed = values[2] if len(values) > 2 else True
    return tag_id, level, confirmed


def ability(entry):
    tag_id, level, confirmed = _spec(entry)
    return Ability(tag_id=tag_id, label=tag_id, level=level, confirmed=confirmed, evidence='用户确认')


def student(skills=(), certificates=(), qualities=(), confirmed=False):
    return StudentProfile(
        major='计算机科学与技术',
        skills=[ability(x) for x in skills],
        certificates=[ability(x) for x in certificates],
        qualities=[ability(x) for x in qualities],
        intention=Intention(),
        confirmed=confirmed,
    )


def item_of(result, tag_id):
    return next(x for x in result['items'] if x['tag_id'] == tag_id)


def dimension_of(result, dimension):
    return next(x for x in result['dimensions'] if x['id'] == dimension)


# --------------------------------------------------------------------------------------
# 手工标注案例：每条写明分数字算过程，期望值由人工独立算得
# --------------------------------------------------------------------------------------
HAND_CASES = [
    # C01 零技能：6 项要求全部未填写 → 满足 0/6，基础分 0.0，增强分 0.0
    {'case': 'C01 零技能-前端', 'job': 'frontend', 'skills': [],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 0.0, 'gap': 0, 'pending': 6, 'related': 0}},

    # C02 两项等级3：满足 2/6 → 2÷6×100 = 33.333333；增强 2×1÷6×100 同上
    {'case': 'C02 两项已掌握-前端', 'job': 'frontend', 'skills': [('html', 3), ('css', 3)],
     'expect': {'required': 6, 'satisfied': 2, 'basic': 33.333333333333336, 'enhanced': 33.333333333333336,
                'gap': 0, 'pending': 4, 'basic_display': 33.3, 'enhanced_display': 33.3}},

    # C03 四项等级3：满足 4/6 → 66.666667；增强 4×1÷6×100 同上
    {'case': 'C03 四项已掌握-前端', 'job': 'frontend', 'skills': [('html', 3), ('css', 3), ('javascript', 3), ('vue', 3)],
     'expect': {'required': 6, 'satisfied': 4, 'basic': 66.66666666666667, 'enhanced': 66.66666666666667,
                'gap': 0, 'pending': 2, 'basic_display': 66.7, 'enhanced_display': 66.7}},

    # C05 熟练度不足：满足 1/6 → 16.666667；增强 min(1/3,1)=0.333333 → 0.333333÷6×100 = 5.555556
    {'case': 'C05 等级1低于要求3-前端', 'job': 'frontend', 'skills': [('html', 1)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 5.555555555555555,
                'gap': 0, 'pending': 5, 'shortfall': 1, 'enhanced_display': 5.6}},

    # C06 等级2+等级1（要求3）：满足 2/6 → 33.333333；增强 (0.666667+0.333333)÷6×100 = 16.666667
    {'case': 'C06 熟练度混合-前端', 'job': 'frontend', 'skills': [('html', 2), ('css', 1)],
     'expect': {'required': 6, 'satisfied': 2, 'basic': 33.333333333333336, 'enhanced': 16.666666666666664,
                'gap': 0, 'pending': 4, 'shortfall': 2}},

    # C07 达到要求等级全覆盖：满足 6/6 → 100.0；增强 (1+1+1+1+1+1)÷6×100 = 100.0
    {'case': 'C07 六项全满足-前端', 'job': 'frontend',
     'skills': [('html', 3), ('css', 3), ('javascript', 3), ('vue', 3)],
     'qualities': [('communication', 2), ('teamwork', 2)],
     'expect': {'required': 6, 'satisfied': 6, 'basic': 100.0, 'enhanced': 100.0, 'gap': 0, 'pending': 0}},

    # C08 通用素质不按等级折算（明确满足即为 1）：满足 2/6 → 33.333333；增强 (1+1)÷6×100 = 33.333333
    {'case': 'C08 通用素质满足即为1-前端', 'job': 'frontend', 'qualities': [('communication', 2), ('teamwork', 1)],
     'expect': {'required': 6, 'satisfied': 2, 'basic': 33.333333333333336, 'enhanced': 33.333333333333336,
                'gap': 0, 'pending': 4, 'shortfall': 0}},

    # C09 仅相关基础：满足 0/6 → 0.0；增强 spring-cloud→spring-boot 0.25 → 0.25÷6×100 = 4.166667
    {'case': 'C09 关联技能-后端', 'job': 'java', 'skills': [('spring-cloud', 2)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 4.166666666666667,
                'gap': 0, 'pending': 6, 'related': 1, 'enhanced_display': 4.2}},

    # C10 精确优先，不叠加：spring-boot 等级1 → 满足 1/6 = 16.666667；增强 min(1/2,1)=0.5（不加 0.25）
    {'case': 'C10 精确匹配优先于关联-后端', 'job': 'java',
     'skills': [('spring-boot', 1), ('spring-cloud', 3)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 8.333333333333334,
                'gap': 0, 'pending': 5, 'related': 0, 'shortfall': 1}},

    # C11 两项技能等级3：满足 2/6 → 33.333333；增强 (1+1)÷6×100 = 33.333333
    {'case': 'C11 数据库两项-后端', 'job': 'java', 'skills': [('mysql', 3), ('sql', 3)],
     'expect': {'required': 6, 'satisfied': 2, 'basic': 33.333333333333336, 'enhanced': 33.333333333333336,
                'gap': 0, 'pending': 4}},

    # C12 关联到测试岗的 sql：满足 0/6 → 0.0；增强 0.25÷6×100 = 4.166667
    {'case': 'C12 关联技能-测试岗', 'job': 'testing', 'skills': [('mysql', 3)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 4.166666666666667,
                'gap': 0, 'pending': 6, 'related': 1}},

    # C13 react→vue 关联：满足 0/6 → 0.0；增强 0.25÷6×100 = 4.166667
    {'case': 'C13 关联技能-Vue', 'job': 'frontend', 'skills': [('react', 2)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 4.166666666666667,
                'gap': 0, 'pending': 6, 'related': 1}},

    # C14 别名归一后视为同一标签（不算推理）：HTML5/css3/JS/vue.js → 满足 4/6 = 66.666667，无关联贡献
    {'case': 'C14 别名归一-前端', 'job': 'frontend',
     'skills': [('HTML5', 3), ('css3', 3), ('JS', 3), ('vue.js', 3)],
     'expect': {'required': 6, 'satisfied': 4, 'basic': 66.66666666666667, 'enhanced': 66.66666666666667,
                'gap': 0, 'pending': 2, 'related': 0}},

    # C15 未确认不计满足：html 未确认 → 满足 0/6 → 0.0；增强 0.0；6 项全部待确认
    {'case': 'C15 未确认不计满足-前端', 'job': 'frontend', 'skills': [('html', 3, False)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 0.0, 'gap': 0, 'pending': 6}},

    # C16 单项已确认：满足 1/6 → 16.666667；增强 1÷6×100 = 16.666667；其余 5 项待确认
    {'case': 'C16 单项已确认-前端', 'job': 'frontend', 'skills': [('html', 3)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 16.666666666666668,
                'gap': 0, 'pending': 5}},

    # C17 已确认不具备 = 差距项（不是待确认）：html 等级0 → 差距 1；满足 1/6 → 16.666667
    {'case': 'C17 已确认未掌握-前端', 'job': 'frontend', 'skills': [('html', 0), ('css', 3)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 16.666666666666668,
                'gap': 1, 'pending': 4}},

    # C18 重复标签只计一次：html 出现三次 → 满足 1/6 = 16.666667（若重复计数会变成 3/8）
    {'case': 'C18 重复标签只计一次-前端', 'job': 'frontend', 'skills': [('html', 3), ('html', 3), ('HTML5', 3)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 16.666666666666668,
                'gap': 0, 'pending': 5, 'entries': {'html': 3}}},

    # C19 额外标签不稀释：4 项要求满足 + 12 个无关已确认标签 → 仍是 4/6 = 66.666667
    {'case': 'C19 多余标签不稀释-前端', 'job': 'frontend',
     'skills': [('html', 3), ('css', 3), ('javascript', 3), ('vue', 3), ('git', 3), ('spring-boot', 3),
                ('spring-cloud', 3), ('sql', 3), ('mysql', 3), ('linux', 3), ('cpp', 3), ('data-structures', 3),
                ('algorithms', 3), ('test-cases', 3), ('networking', 3), ('troubleshooting', 3)],
     'expect': {'required': 6, 'satisfied': 4, 'basic': 66.66666666666667, 'enhanced': 66.66666666666667,
                'gap': 0, 'pending': 2, 'extra': 12}},

    # C20 证书是优先项：java 岗位 cet4 属 preferred → 满足 0/6 = 0.0，增强 0.0，优先项满足 1
    {'case': 'C20 优先项不计入分母-后端', 'job': 'java', 'certificates': [('cet4', 1)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 0.0, 'gap': 0, 'pending': 6,
                'preferred_satisfied': 1}},

    # C21 覆盖全但技能熟练度不足：满足 6/6 → 100.0；增强 (1+0.5+1+1+1+1)÷6×100 = 91.666667
    {'case': 'C21 覆盖全但熟练度不足-技术支持', 'job': 'support',
     'skills': [('linux', 2), ('networking', 1), ('troubleshooting', 2), ('documentation', 2)],
     'qualities': [('communication', 2), ('teamwork', 2)],
     'expect': {'required': 6, 'satisfied': 6, 'basic': 100.0, 'enhanced': 91.66666666666666,
                'gap': 0, 'pending': 0, 'shortfall': 1, 'enhanced_display': 91.7}},

    # C22 五项岗位：满足 5/5 → 100.0；增强 (1+0.5+1+1+1)÷5×100 = 90.0
    {'case': 'C22 五项部分熟练度-实施', 'job': 'implementation',
     'skills': [('deployment', 3), ('sql', 1), ('documentation', 2)],
     'qualities': [('communication', 2), ('learning', 2)],
     'expect': {'required': 5, 'satisfied': 5, 'basic': 100.0, 'enhanced': 90.0,
                'gap': 0, 'pending': 0, 'shortfall': 1}},

    # C23 等级高于要求时贡献封顶为 1：cpp 等级3 / 要求2 → 满足 1/6 = 16.666667，增强同理
    {'case': 'C23 等级封顶-C++', 'job': 'cpp', 'skills': [('cpp', 3)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 16.666666666666668,
                'gap': 0, 'pending': 5}},

    # C24 跨维度同名标签按标签字典归属：communication 填在技能列表仍算通用素质 → 满足 1/6 = 16.666667
    {'case': 'C24 字典维度优先-前端', 'job': 'frontend', 'skills': [('communication', 2)],
     'expect': {'required': 6, 'satisfied': 1, 'basic': 16.666666666666668, 'enhanced': 16.666666666666668,
                'gap': 0, 'pending': 5, 'unknown': 0}},

    # C25 字典外标签不参与评分：kotlin 不在标签字典 → 满足 0/6 = 0.0，单列未知标签，不算多余优势
    {'case': 'C25 字典外标签-前端', 'job': 'frontend', 'skills': [('kotlin', 3)],
     'expect': {'required': 6, 'satisfied': 0, 'basic': 0.0, 'enhanced': 0.0, 'gap': 0, 'pending': 6,
                'unknown': 1, 'extra': 0}},

    # C26 测试岗全覆盖：满足 6/6 → 100.0；增强 6×1÷6×100 = 100.0
    {'case': 'C26 测试岗全覆盖', 'job': 'testing',
     'skills': [('test-cases', 2), ('functional-testing', 2), ('api-testing', 2), ('sql', 2)],
     'qualities': [('communication', 2), ('teamwork', 2)],
     'expect': {'required': 6, 'satisfied': 6, 'basic': 100.0, 'enhanced': 100.0, 'gap': 0, 'pending': 0}},

    # C27 三项：cpp3 + 数据结构1 + 团队协作2 → 满足 3/6 = 50.0；增强 (1+0.5+1)÷6×100 = 41.666667
    {'case': 'C27 三项部分熟练度-C++', 'job': 'cpp',
     'skills': [('cpp', 3), ('data-structures', 1)], 'qualities': [('teamwork', 2)],
     'expect': {'required': 6, 'satisfied': 3, 'basic': 50.0, 'enhanced': 41.66666666666667,
                'gap': 0, 'pending': 3, 'shortfall': 1, 'basic_display': 50.0, 'enhanced_display': 41.7}},

    # C28 两项：满足 2/6 → 33.333333；增强 (1+1)÷6×100 = 33.333333
    {'case': 'C28 两项-技术支持', 'job': 'support', 'skills': [('linux', 2), ('documentation', 2)],
     'expect': {'required': 6, 'satisfied': 2, 'basic': 33.333333333333336, 'enhanced': 33.333333333333336,
                'gap': 0, 'pending': 4}},
]


@pytest.mark.parametrize('case', HAND_CASES, ids=[c['case'] for c in HAND_CASES])
def test_hand_computed_match_cases(case, frozen):
    frozen()
    profile = student(case.get('skills', ()), case.get('certificates', ()), case.get('qualities', ()))
    result = match_student(profile, job_of(case['job']))
    expect = case['expect']

    assert result['required'] == expect['required']
    assert result['satisfied'] == expect['satisfied']
    assert result['basic'] == pytest.approx(expect['basic'], rel=1e-9)
    assert result['enhanced'] == pytest.approx(expect['enhanced'], rel=1e-9)
    if 'gap' in expect:
        assert result['gap'] == expect['gap']
    if 'pending' in expect:
        assert result['pending'] == expect['pending']
    if 'related' in expect:
        assert len(result['related_items']) == expect['related']
    if 'shortfall' in expect:
        assert len(result['weak_proficiency_items']) == expect['shortfall']
    if 'unknown' in expect:
        assert len(result['unknown_student_tags']) == expect['unknown']
    if 'extra' in expect:
        assert result['extra_confirmed_count'] == expect['extra']
    if 'preferred_satisfied' in expect:
        assert result['preferred_summary']['satisfied'] == expect['preferred_satisfied']
    if 'basic_display' in expect:
        assert result['basic_display'] == expect['basic_display']
    if 'enhanced_display' in expect:
        assert result['enhanced_display'] == expect['enhanced_display']
    for tag_id, count in (expect.get('entries') or {}).items():
        assert item_of(result, tag_id)['student_entry_count'] == count


def test_hand_case_count_is_sufficient():
    assert len(HAND_CASES) >= 20
    assert len({c['case'] for c in HAND_CASES}) == len(HAND_CASES)


def test_basic_rule_four_requirements_two_satisfied_is_exactly_half(frozen):
    """计划验收样例：岗位有 4 项要求、满足 2 项时基础分为 50%。"""
    frozen(jobs=[synth_job('half4', ['html', 'css', 'javascript', 'vue'])])
    result = match_student(student([('html', 2), ('css', 2)]), job_of('half4'))
    assert result['required'] == 4
    assert result['satisfied'] == 2
    assert result['basic'] == 50.0
    assert result['enhanced'] == 50.0
    assert result['basic_display'] == 50.0


def test_duplicate_and_extra_tags_do_not_change_score(frozen):
    """计划验收样例：重复及额外学生标签不改变结果。"""
    frozen()
    clean = student([('html', 3), ('css', 3), ('javascript', 3), ('vue', 3)])
    noisy = student([('html', 3), ('html', 3), ('HTML5', 3), ('css', 3), ('css3', 3), ('javascript', 3),
                     ('JS', 3), ('vue', 3), ('git', 2), ('linux', 2), ('sql', 2), ('cpp', 2)])
    job = job_of('frontend')
    clean_result, noisy_result = match_student(clean, job), match_student(noisy, job)
    assert noisy_result['required'] == clean_result['required']
    assert noisy_result['satisfied'] == clean_result['satisfied']
    assert noisy_result['basic'] == clean_result['basic']
    assert noisy_result['enhanced'] == clean_result['enhanced']
    assert noisy_result['extra_confirmed_count'] > 0
    assert noisy_result['duplicate_student_tags']


def test_every_frozen_job_is_fully_satisfiable_and_zeroable(frozen):
    frozen()
    for job in matching.dataset()['jobs']:
        full = student(
            [(r['tag_id'], r['required_level']) for r in job['requirements'] if r['dimension'] == 'skills'],
            qualities=[(r['tag_id'], r['required_level']) for r in job['requirements'] if r['dimension'] == 'qualities'],
            certificates=[(r['tag_id'], r['required_level']) for r in job['requirements'] if r['dimension'] == 'certificates'],
        )
        satisfied = match_student(full, job)
        assert satisfied['basic'] == 100.0
        assert satisfied['enhanced'] == pytest.approx(100.0, rel=1e-9)
        assert satisfied['pending'] == 0
        empty = match_student(student(), job)
        assert empty['basic'] == 0.0
        assert empty['satisfied'] == 0
        assert empty['status_text'] == '可计算'


def test_unconfirmed_does_not_count_and_related_is_separate(frozen):
    frozen()
    result = match_student(student([('spring-cloud', 2)]), job_of('java'))
    assert result['basic'] == 0
    assert result['enhanced'] > 0
    assert all(x['related_only'] for x in result['items'] if x['contribution'])
    related = item_of(result, 'spring-boot')
    assert related['status'] == 'pending'
    assert related['contribution'] == 0.25
    assert related['contribution_type'] == 'related'
    assert related['enhancement_relations'][0]['from'] == 'spring-cloud'
    assert related['enhancement_relations'][0]['capped'] is False
    assert '不能证明掌握' in related['enhancement_basis']


def test_relation_credit_never_enters_satisfied_items(frozen):
    frozen()
    result = match_student(student([('react', 3)]), job_of('frontend'))
    assert result['satisfied_items'] == []
    assert 'vue' in [x['tag_id'] for x in result['related_items']]
    assert result['related_credit'] == pytest.approx(0.25, rel=1e-9)


def test_explicit_zero_keeps_gap_with_related_background(frozen):
    frozen()
    result = match_student(student([('vue', 0), ('react', 3)]), job_of('frontend'))
    vue = item_of(result, 'vue')
    assert vue['status'] == 'gap'
    assert vue['contribution'] == 0.25
    assert vue['related_only'] is True
    assert result['basic'] == 0
    assert not result['satisfied_items']
    assert 'vue' in [x['tag_id'] for x in result['gap_items']]


def test_confirmation_changes_input_version_and_score(frozen):
    frozen()
    unconfirmed = match_student(student([('html', 3, False)]), job_of('frontend'))
    confirmed = match_student(student([('html', 3, True)]), job_of('frontend'))
    assert unconfirmed['basic'] == 0.0
    assert confirmed['basic'] == pytest.approx(16.666666666666668, rel=1e-9)
    assert unconfirmed['input_version'] != confirmed['input_version']
    assert confirmed['input_version'] == match_student(student([('html', 3, True)]), job_of('frontend'))['input_version']


def test_profile_confirmed_flag_is_reported_for_caller_gate(frozen):
    """画像整体确认由调用方拦截；评分函数只按标签 confirmed 计算，并回传 profile_confirmed。"""
    frozen()
    unconfirmed = match_student(student([('html', 3)], confirmed=False), job_of('frontend'))
    confirmed = match_student(student([('html', 3)], confirmed=True), job_of('frontend'))
    assert unconfirmed['profile_confirmed'] is False
    assert confirmed['profile_confirmed'] is True
    assert unconfirmed['basic'] == confirmed['basic'] == pytest.approx(16.666666666666668, rel=1e-9)
    assert unconfirmed['input_version'] != confirmed['input_version']


def test_dimension_source_and_declared_dimension_are_reported(frozen):
    frozen()
    result = match_student(student(skills=[('communication', 2)]), job_of('frontend'))
    communication = item_of(result, 'communication')
    assert communication['dimension'] == 'qualities'
    assert communication['declared_dimension'] == 'qualities'
    assert communication['dimension_source'] == 'dictionary'
    assert communication['status'] == 'satisfied'
    assert dimension_of(result, 'skills')['satisfied'] == 0
    assert dimension_of(result, 'qualities')['satisfied'] == 1


def test_dimensions_do_not_average_and_not_applicable_is_not_zero(frozen):
    frozen()
    result = match_student(student([('html', 3), ('css', 3), ('javascript', 3), ('vue', 3)]), job_of('frontend'))
    skills = dimension_of(result, 'skills')
    certificates = dimension_of(result, 'certificates')
    qualities = dimension_of(result, 'qualities')
    assert skills['basic'] == 100.0
    assert qualities['basic'] == 0.0
    assert certificates['required'] == 0
    assert certificates['basic'] is None
    assert certificates['enhanced'] is None
    assert certificates['status'] == 'not_applicable'
    assert certificates['status_text'] == '不适用'
    assert result['basic'] == pytest.approx(66.66666666666667, rel=1e-9)
    assert [x['id'] for x in result['dimensions']] == ['skills', 'certificates', 'qualities']


def test_only_skills_are_graded_by_proficiency(frozen):
    """证书与通用素质维持"明确满足为 1"，只有技能按 min(等级/要求等级, 1) 折算。"""
    job = synth_job('mixed', ['html'])
    job['requirements'].append({'tag_id': 'communication', 'label': '沟通表达', 'dimension': 'qualities',
                                'requirement': 'required', 'required_level': 2})
    frozen(jobs=[job])
    result = match_student(student([('html', 1)], qualities=[('communication', 1)]), job_of('mixed'))
    assert result['satisfied'] == 2
    assert result['basic'] == 100.0
    assert item_of(result, 'html')['contribution'] == 0.5
    assert item_of(result, 'communication')['contribution'] == 1.0
    assert result['enhanced'] == 75.0
    assert len(result['weak_proficiency_items']) == 1


def test_preferred_and_unmentioned_never_enter_denominator(frozen):
    frozen()
    job = job_of('frontend')
    result = match_student(student([(tag, 1) for tag in FROZEN_PROFILES['frontend']['preferred']]), job)
    assert result['required'] == 6
    assert result['satisfied'] == 0
    assert result['basic'] == 0.0
    assert result['preferred_summary']['total'] == len(job['preferred'])
    assert result['preferred_summary']['satisfied'] == len(job['preferred'])
    assert 'cet4' not in [x['tag_id'] for x in result['satisfied_items']]
    unmentioned = [x['tag_id'] for x in result['unmentioned_items']['skills']]
    assert 'git' in unmentioned and 'sql' in unmentioned
    assert all(x['tag_id'] not in unmentioned for x in result['items'])
    assert result['dimensions'][1]['status'] == 'not_applicable'


def test_preferred_items_do_not_affect_scores(frozen):
    frozen()
    without = match_student(student([('java', 2)]), job_of('java'))
    with_certificate = match_student(student([('java', 2)], certificates=[('cet4', 1)]), job_of('java'))
    assert without['basic'] == with_certificate['basic']
    assert without['enhanced'] == with_certificate['enhanced']
    assert without['preferred_summary']['satisfied'] == 0
    assert with_certificate['preferred_summary']['total'] == 1
    assert with_certificate['preferred_summary']['satisfied'] == 1
    assert with_certificate['preferred_summary']['matched_labels'] == ['大学英语四级']
    assert 'cet4' not in [x['tag_id'] for x in with_certificate['satisfied_items']]


def test_versions_and_score_documents_are_present(frozen):
    data = frozen()
    result = match_student(student([('html', 2)]), job_of('frontend'))
    rules = data['rule_versions']
    assert result['algorithm_version'] == matching.ALGORITHM_VERSION
    assert result['versions']['level_rule'] == rules['level_rule']
    assert result['versions']['relation_set'] == rules['relation']
    assert result['versions']['profile_rule'] == rules['profile']
    assert result['versions']['tag_dictionary'] == rules['tag_dictionary']
    assert result['versions']['relation_fingerprint'].startswith('relations-')
    assert result['versions']['data'] == data['version']
    assert result['versions']['job'] == job_of('frontend')['version']
    assert 'score_rule' in result and 'score_precision' in result
    assert result['contribution_legend']['related'].startswith('仅代表相关基础')


def test_required_level_rule_is_recorded(frozen):
    frozen()
    html = item_of(match_student(student([('html', 2)]), job_of('frontend')), 'html')
    assert html['required_level'] == 3
    assert html['required_level_source'] == 'level_rule'
    assert html['required_level_rule'] == 'level-1.0'
    assert 'level-1.0' in html['required_level_note']


def test_required_level_falls_back_to_text_keyword(frozen):
    familiar = synth_job('familiar', ['html'], level_basis='岗位原文：熟悉即可')
    beginner = synth_job('beginner', ['html'], level_basis='岗位原文：了解即可')
    for job in (familiar, beginner):
        job['requirements'][0].pop('required_level', None)
    frozen(jobs=[familiar, beginner])
    familiar_result = match_student(student([('html', 1)]), job_of('familiar'))
    assert familiar_result['items'][0]['required_level'] == 2
    assert familiar_result['items'][0]['required_level_source'] == 'text_keyword'
    assert familiar_result['items'][0]['contribution'] == 0.5
    beginner_result = match_student(student([('html', 1)]), job_of('beginner'))
    assert beginner_result['items'][0]['required_level'] == 1
    assert beginner_result['items'][0]['required_level_source'] == 'text_keyword'
    assert beginner_result['items'][0]['contribution'] == 1.0
    assert beginner_result['enhanced'] == 100.0


def test_missing_required_level_is_recorded_as_system_default(frozen):
    job = synth_job('no_level', ['html'])
    job['requirements'][0] = {'tag_id': 'html', 'label': 'HTML', 'dimension': 'skills'}
    frozen(jobs=[job])
    html = item_of(match_student(student([('html', 2)]), job_of('no_level')), 'html')
    assert html['required_level'] == 2
    assert html['required_level_source'] == 'default_baseline'
    assert '默认' in html['required_level_note']


def test_zero_requirements_is_not_computable_and_excluded(frozen):
    frozen(jobs=[synth_job('empty', [])])
    result = match_student(student([('html', 2)]), job_of('empty'))
    assert result['required'] == 0
    assert result['basic'] is None
    assert result['enhanced'] is None
    assert result['basic_display'] is None
    assert result['status'] == 'not_computable'
    assert result['status_text'] == '无法计算'
    assert result['not_computable_reason'] != ''
    ranked = recommendations(student([('html', 2)]), Filters(), 'basic')
    assert ranked['items'] == []
    assert ranked['candidate_count'] == 0
    assert ranked['unscored_job_ids'] == ['empty']
    assert any('无法计算' in note for note in ranked['filter_notes'])


def test_duplicate_requirements_counted_once(frozen):
    frozen(jobs=[synth_job('dupe', ['html', 'html', 'css'])])
    result = match_student(student([('html', 2), ('css', 2)]), job_of('dupe'))
    assert result['required'] == 2
    assert result['satisfied'] == 2
    assert result['basic'] == 100.0
    assert result['duplicate_requirements'] == ['HTML']


def test_requirement_outside_dictionary_matches_same_string(frozen):
    frozen(jobs=[synth_job('unknown', ['kotlin'])])
    result = match_student(student([('kotlin', 3)]), job_of('unknown'))
    assert result['satisfied'] == 1
    assert result['basic'] == 100.0
    assert result['items'][0]['tag_verified'] is False
    assert result['unknown_student_tags'][0]['tag_id'] == 'kotlin'


def test_relation_credit_uses_max_and_respects_cap(frozen):
    job = synth_job('cap', ['kotlin'])
    frozen(jobs=[job], relations=[
        {'from': 'git', 'to': 'kotlin', 'weight': 0.25, 'reason': '关联 A'},
        {'from': 'http', 'to': 'kotlin', 'weight': 0.10, 'reason': '关联 B'},
    ])
    result = match_student(student([('git', 2), ('http', 2)]), job_of('cap'))
    assert result['satisfied'] == 0
    assert result['items'][0]['contribution'] == 0.25
    assert result['enhanced'] == 25.0

    frozen(jobs=[job], relations=[{'from': 'git', 'to': 'kotlin', 'weight': 0.9, 'reason': '同生态'}])
    capped = match_student(student([('git', 2)]), job_of('cap'))
    assert capped['items'][0]['contribution'] == 0.25
    assert capped['items'][0]['enhancement_relations'][0]['capped'] is True
    assert capped['enhanced'] == 25.0


# --------------------------------------------------------------------------------------
# 薪资解析与筛选
# --------------------------------------------------------------------------------------
@pytest.mark.parametrize('raw,declared,period,low,high', [
    ('8000-13000元', 'month', 'month', 8000.0, 13000.0),
    ('1.2-1.6万', 'month', 'month', 12000.0, 16000.0),
    ('4000-7000元·13薪', 'month', 'month', 4000.0, 7000.0),
    ('2-4万·16薪', 'month', 'month', 20000.0, 40000.0),
    ('100-120元/天', 'day', 'day', 100.0, 120.0),
    ('60-80元/天', 'day', 'day', 60.0, 80.0),
    ('1000元以下', 'month', 'month', None, 1000.0),
    ('6000元以上', 'month', 'month', 6000.0, None),
    ('面议', 'negotiable', 'negotiable', None, None),
    ('20-30万/年', 'month', 'unknown', 200000.0, 300000.0),
])
def test_parse_salary_patterns(raw, declared, period, low, high):
    parsed = parse_salary(sample('s1', '北京', raw, declared, None, None))
    assert parsed['period'] == period
    assert parsed['min'] == low
    assert parsed['max'] == high
    assert parsed['raw'] == raw


def test_parse_salary_prefers_structured_fields():
    structured = parse_salary(sample('s1', '北京', '8000-13000元', 'month', 8000, 13000))
    assert structured['source'] == 'structured'
    assert (structured['min'], structured['max']) == (8000.0, 13000.0)
    assert parse_salary(sample('s2', '北京', '1000元以下', 'month', None, None))['source'] == 'partial'
    assert parse_salary(sample('s3', '北京', '面议', 'negotiable', None, None))['source'] == 'unknown'
    conflict = parse_salary(sample('s4', '北京', '100-120元/天', 'month', None, None))
    assert conflict['period'] == 'day'
    assert conflict['period_conflict'] is True


@pytest.mark.parametrize('salary_min,salary_max,expected', [
    (13000, None, True),
    (13000.01, None, False),
    (None, 8000, True),
    (None, 7999, False),
])
def test_salary_filter_boundary_equality(frozen, salary_min, salary_max, expected):
    frozen(jobs=[synth_job('salary', ['html'],
                           samples=[sample('s1', '北京', '8000-13000元', 'month', 8000, 13000)])])
    result = recommendations(student([('html', 2)]), Filters(salary_min=salary_min, salary_max=salary_max), 'basic')
    assert (result['candidate_count'] == 1) is expected


def test_salary_filter_does_not_convert_daily_and_monthly(frozen):
    frozen(jobs=[synth_job('day', ['html'], samples=[sample('d1', '上海', '100-120元/天', 'day', 100, 120)])])
    profile = student([('html', 2)])
    monthly = recommendations(profile, Filters(salary_min=100, salary_period='month'), 'basic')
    assert monthly['candidate_count'] == 0
    assert monthly['filter_counts']['samples_salary_period_mismatch'] == 1
    assert any('不作日薪/月薪换算' in note for note in monthly['filter_notes'])

    daily = recommendations(profile, Filters(salary_min=100, salary_period='day'), 'basic')
    assert daily['candidate_count'] == 1
    assert daily['items'][0]['salary_summary']['period'] == 'day'


def test_salary_negotiable_excluded_only_when_filter_active(frozen):
    frozen(jobs=[synth_job('negotiable', ['html'], samples=[sample('n1', '长沙', '面议', 'negotiable', None, None)])])
    profile = student([('html', 2)])
    assert recommendations(profile, Filters(), 'basic')['candidate_count'] == 1
    filtered = recommendations(profile, Filters(salary_min=5000), 'basic')
    assert filtered['candidate_count'] == 0
    assert filtered['filter_counts']['samples_salary_negotiable'] == 1
    assert any('面议' in note for note in filtered['filter_notes'])


def test_salary_unsupported_period_is_excluded(frozen):
    frozen(jobs=[synth_job('yearly', ['html'], samples=[sample('y1', '北京', '20-30万/年', 'month', None, None)])])
    result = recommendations(student([('html', 2)]), Filters(salary_min=10000, salary_period='month'), 'basic')
    assert result['candidate_count'] == 0
    assert result['filter_counts']['samples_salary_period_unknown'] == 1


def test_salary_without_structured_bounds_is_parsed_from_raw(frozen):
    frozen(jobs=[synth_job('raw_only', ['html'], samples=[sample('r1', '北京', '8000-13000元', 'month', None, None)])])
    result = recommendations(student([('html', 2)]), Filters(salary_min=12000, salary_period='month'), 'basic')
    assert result['candidate_count'] == 1
    assert result['items'][0]['salary_summary']['max'] == 13000.0


def test_city_filter_normalizes_input(frozen):
    frozen(jobs=[synth_job('city', ['html'], samples=[
        sample('b1', '北京', '8000-13000元', 'month', 8000, 13000),
        sample('s1', '上海', '9000-14000元', 'month', 9000, 14000),
    ])])
    profile = student([('html', 2)])
    normalized = recommendations(profile, Filters(city='北京-海淀区'), 'basic')
    assert normalized['candidate_count'] == 1
    assert normalized['items'][0]['matching_sample_count'] == 1
    assert normalized['items'][0]['cities'] == ['北京']
    assert recommendations(profile, Filters(city=' 上海市 '), 'basic')['candidate_count'] == 1
    missing = recommendations(profile, Filters(city='不存在的城市'), 'basic')
    assert missing['candidate_count'] == 0
    assert missing['filter_counts']['samples_city_filtered'] == 2


def test_skill_filter_requires_all_tags_and_reports_unknown(frozen):
    frozen()
    profile = student([('html', 2), ('vue', 2)])
    both = recommendations(profile, Filters(skills=['html', 'vue']), 'basic')
    assert [x['job_id'] for x in both['items']] == ['frontend']
    assert both['items'][0]['skill_filter_matches'] == [
        {'tag_id': 'html', 'label': 'HTML', 'source': 'required'},
        {'tag_id': 'vue', 'label': 'Vue', 'source': 'required'},
    ]

    preferred_only = recommendations(profile, Filters(skills=['cet4']), 'basic')
    assert [x['job_id'] for x in preferred_only['items']] == ['cpp', 'java', 'testing']
    assert all(x['skill_filter_matches'] == [{'tag_id': 'cet4', 'label': '大学英语四级', 'source': 'preferred'}]
               for x in preferred_only['items'])

    mixed = recommendations(profile, Filters(skills=['html', 'networking']), 'basic')
    assert mixed['candidate_count'] == 0
    assert mixed['filter_counts']['jobs_skill_filtered'] == 6
    assert any('未同时包含全部所选技能标签' in note for note in mixed['filter_notes'])

    alias = recommendations(profile, Filters(skills=['HTML5']), 'basic')
    assert alias['applied_filters']['skills'] == ['html']
    assert alias['candidate_count'] == 1

    unknown = recommendations(profile, Filters(skills=['kotlin']), 'basic')
    assert unknown['candidate_count'] == 0
    assert unknown['unrecognized_skills'] == ['kotlin']
    assert any('不在岗位画像字典中' in note for note in unknown['filter_notes'])


def test_fewer_than_three_candidates_reported_honestly(frozen):
    frozen()
    result = recommendations(student([('html', 2)]), Filters(skills=['javascript', 'vue']), 'basic')
    assert result['candidate_count'] == 1
    assert result['returned_count'] == 1
    assert '不足 3 个' in result['note']
    assert '实际数量' in result['note']


# --------------------------------------------------------------------------------------
# 排序与推荐组装
# --------------------------------------------------------------------------------------
def test_recommendation_ties_sort_by_job_id_only(frozen):
    frozen()
    result = recommendations(student(), Filters(), 'basic')
    assert result['candidate_count'] == 6
    assert [x['job_id'] for x in result['ranked_summary']] == ['cpp', 'frontend', 'implementation', 'java', 'support', 'testing']
    assert [x['job_id'] for x in result['items']] == ['cpp', 'frontend', 'implementation', 'java', 'support']
    assert all(x['basic'] == 0.0 for x in result['ranked_summary'])
    assert result['items'][0]['sort_key'] == {'score': 0.0, 'job_id': 'cpp'}
    assert result['items'][0]['tied_with_previous'] is False
    assert result['items'][1]['tied_with_previous'] is True
    assert result['sort_rule'].startswith('匹配分数降序')
    assert '岗位ID升序' in result['sort_rule']


def test_tie_does_not_use_satisfied_or_required_counts(frozen):
    """同分时必须直接按岗位 ID 升序：即使后者满足项数更多，也不能插到前面。"""
    frozen(jobs=[synth_job('zz_full4', ['html', 'css', 'javascript', 'vue']),
                 synth_job('aa_full2', ['html', 'css'])])
    result = recommendations(student([('html', 2), ('css', 2), ('javascript', 2), ('vue', 2)]), Filters(), 'basic')
    assert [x['job_id'] for x in result['items']] == ['aa_full2', 'zz_full4']
    assert result['items'][0]['match']['basic'] == result['items'][1]['match']['basic'] == 100.0
    assert result['items'][1]['match']['satisfied'] == 4
    assert result['items'][0]['match']['satisfied'] == 2


def test_higher_score_wins_over_job_id(frozen):
    frozen(jobs=[synth_job('aa_css_only', ['css']), synth_job('zz_html_only', ['html'])])
    result = recommendations(student([('html', 2)]), Filters(), 'basic')
    assert [x['job_id'] for x in result['items']] == ['zz_html_only', 'aa_css_only']


def test_recommendation_is_repeatable(frozen):
    frozen()
    profile = student([('html', 1), ('css', 3), ('sql', 2)])
    filters = Filters(salary_min=2000, salary_period='month')
    first = recommendations(profile, filters, 'basic')
    second = recommendations(profile, filters, 'basic')
    assert [x['job_id'] for x in first['items']] == [x['job_id'] for x in second['items']]
    assert [x['sort_key'] for x in first['items']] == [x['sort_key'] for x in second['items']]
    assert first['input_version'] == second['input_version']


def test_recommendation_sort_by_enhanced_can_reorder(frozen):
    frozen(jobs=[synth_job('best_basic', ['html']), synth_job('best_enhanced', ['css', 'javascript', 'vue'])])
    profile = student([('html', 1), ('css', 2), ('javascript', 2)])
    by_basic = recommendations(profile, Filters(), 'basic')
    by_enhanced = recommendations(profile, Filters(), 'enhanced')
    assert [x['job_id'] for x in by_basic['items']] == ['best_basic', 'best_enhanced']
    assert [x['job_id'] for x in by_enhanced['items']] == ['best_enhanced', 'best_basic']
    assert by_basic['items'][0]['match']['basic'] == 100.0
    assert by_basic['items'][0]['match']['enhanced'] == 50.0
    assert by_enhanced['items'][0]['match']['basic'] == pytest.approx(66.66666666666667, rel=1e-9)
    assert by_enhanced['items'][0]['match']['enhanced'] == pytest.approx(66.66666666666667, rel=1e-9)
    assert by_basic['sort_by'] == 'basic'
    assert by_enhanced['sort_by'] == 'enhanced'


def test_recommendation_items_expose_shared_match_and_reason_facts(frozen):
    frozen()
    profile = student([('html', 3), ('css', 1), ('react', 2)])
    result = recommendations(profile, Filters(), 'basic')
    item = result['items'][0]
    assert item['job_id'] == 'frontend'
    assert item['match'] == match_student(profile, job_of('frontend'))
    assert item['reason'].startswith('已满足：')
    assert '主要差距：' in item['reason']
    assert '熟练度待提升：CSS' in item['reason']
    assert '仅有相关基础' in item['reason']
    facts = item['reason_facts']
    assert facts['satisfied_labels'] == ['HTML', 'CSS']
    assert facts['proficiency_shortfall_labels'] == ['CSS']
    assert facts['related_base_labels'] == ['Vue']
    assert facts['algorithms']['algorithm'] == matching.ALGORITHM_VERSION
    assert item['samples'] and item['samples'][0]['city'] == '北京'
    assert item['salary_summary']['period'] == 'month'
    assert set(item['cities']) == {'北京', '上海', '长沙'}


def test_invalid_salary_range_and_sort_field(frozen):
    frozen()
    with pytest.raises(ValueError):
        recommendations(student(), Filters(salary_min=100, salary_max=10))
    with pytest.raises(ValueError):
        recommendations(student(), Filters(), 'unknown')


def test_canonical_normalizes_aliases_and_keeps_unknown(frozen):
    frozen()
    assert canonical('HTML5') == 'html'
    assert canonical(' vue.js ') == 'vue'
    assert canonical('JS') == 'javascript'
    assert canonical('Kotlin') == 'kotlin'
    assert canonical('') == ''


# --------------------------------------------------------------------------------------
# 生产数据契约测试：数据重建后先在这里失败，提示重新人工审定期望
# --------------------------------------------------------------------------------------
PINNED_PROFILES = {
    'frontend': [('html', 3), ('css', 3), ('javascript', 3), ('vue', 3), ('communication', 2), ('teamwork', 2)],
    'java': [('java', 2), ('spring-boot', 2), ('sql', 2), ('mysql', 2), ('communication', 2), ('teamwork', 2)],
    'cpp': [('cpp', 2), ('data-structures', 3), ('algorithms', 3), ('linux', 2), ('teamwork', 2), ('learning', 2)],
    'testing': [('test-cases', 2), ('functional-testing', 2), ('api-testing', 2), ('sql', 2), ('communication', 2), ('teamwork', 2), ('cet4', 1)],
    'implementation': [('deployment', 1), ('sql', 2), ('documentation', 2), ('communication', 2), ('learning', 2)],
    'support': [('linux', 2), ('networking', 2), ('troubleshooting', 3), ('documentation', 3), ('communication', 2), ('teamwork', 2)],
}
PINNED_PREFERRED = {
    'frontend': ['react'],
    'java': ['html', 'css', 'vue', 'spring-cloud', 'documentation', 'cet4'],
    'cpp': ['git', 'java', 'mysql', 'cet4'],
    'testing': ['linux', 'automated-testing', 'vendor-cert', 'istqb'],
    'implementation': ['java', 'mysql', 'linux', 'networking', 'cet4', 'cet6'],
    'support': ['mysql', 'algorithms', 'vendor-cert'],
}


def test_production_dataset_shape():
    data = dataset()
    assert len(data['jobs']) == 6
    assert [j['id'] for j in data['jobs']] == list(PINNED_PROFILES)
    assert len(data['paths']['edges']) >= 18
    assert len([x for x in data['paths']['edges'] if x['type'] == 'transition']) >= 6
    for job in data['jobs']:
        assert job['requirements'] and job['samples']
        assert all(r.get('required_level') for r in job['requirements'])
        assert all(r['dimension'] in ('skills', 'certificates', 'qualities') for r in job['requirements'])
        assert all(r.get('requirement', 'required') == 'required' for r in job['requirements'])


def test_production_profiles_match_pinned_contract():
    """冻结案例依赖的等级契约：生产数据若重建为不同等级，这里先失败，需重新人工审定期望。"""
    for job_id, expected in PINNED_PROFILES.items():
        job = get_job(job_id)
        actual = [(r['tag_id'], r['required_level']) for r in job['requirements']]
        assert actual == expected, job_id
        assert all(r.get('requirement', 'required') == 'required' for r in job['requirements'])
        assert all(canonical(r['tag_id']) == r['tag_id'] for r in job['requirements'])
        assert all(r['dimension'] == matching._tag_index()[r['tag_id']]['dimension'] for r in job['requirements'])
    relations = {(r['from'], r['to']): r['weight'] for r in dataset()['relations']}
    assert relations[('spring-cloud', 'spring-boot')] == 0.25
    assert relations[('mysql', 'sql')] == 0.25
    assert relations[('react', 'vue')] == 0.25
    for job_id, expected in PINNED_PREFERRED.items():
        assert [r['tag_id'] for r in get_job(job_id)['preferred']] == expected, job_id
        assert all(r.get('required', False) is False for r in get_job(job_id)['preferred'])


def test_production_salary_and_city_flags_are_consistent():
    for job in dataset()['jobs']:
        for record in job['samples']:
            parsed = parse_salary(record)
            assert parsed['raw']
            assert parsed['period'] in ('month', 'day', 'negotiable')
            assert parsed['period_conflict'] is False
            assert record['city']


def test_production_recommendation_smoke():
    profile = student([('html', 3), ('css', 3), ('javascript', 3), ('vue', 3)])
    result = recommendations(profile, Filters(), 'basic')
    assert result['candidate_count'] == 6
    assert result['data_version'] == dataset()['version']
    assert result['sample_label']
    assert result['disclaimers']
    assert [x['job_id'] for x in result['items']] == ['frontend', 'cpp', 'implementation', 'java', 'support']
    assert result['items'][0]['job_id'] == 'frontend'
    assert result['items'][0]['match']['basic'] == pytest.approx(66.66666666666667, rel=1e-9)
    ordered = sorted(result['ranked_summary'], key=lambda x: (-x['basic'], x['job_id']))
    assert [x['job_id'] for x in ordered] == [x['job_id'] for x in result['ranked_summary']]
    for item in result['items']:
        assert item['match'] == match_student(profile, get_job(item['job_id']))


@pytest.mark.parametrize('dimension,tag', [('skills', 'java'), ('certificates', 'cet4'), ('qualities', 'communication')])
def test_missing_evidence_is_pending(frozen, dimension, tag):
    job = synth_job('evidence', [tag])
    frozen([job])
    profile = StudentProfile(**{dimension: [Ability(tag_id=tag, label=tag, level=3, confirmed=True, evidence=' ')]})
    result = match_student(profile, job)
    assert result['basic'] == result['enhanced'] == 0
    assert result['items'][0]['pending_reason'] == 'missing_evidence'


def test_related_skill_requires_evidence(frozen):
    job = synth_job('evidence', ['vue'])
    frozen([job])
    profile = student(['react'])
    profile.skills[0].evidence = ''
    assert match_student(profile, job)['enhanced'] == 0


def test_duplicate_prefers_confirmed_evidenced_ability(frozen):
    job = synth_job('evidence', ['java'])
    frozen([job])
    profile = student([('java', 1), ('java', 3)])
    profile.skills[1].evidence = ''
    result = match_student(profile, job)
    assert result['basic'] == 100
    assert result['enhanced'] == 50


def test_explicit_absence_needs_no_positive_evidence(frozen):
    job = synth_job('evidence', ['java'])
    frozen([job])
    profile = student([('java', 0)])
    profile.skills[0].evidence = ''
    assert match_student(profile, job)['items'][0]['status'] == 'gap'


def test_production_salary_filter_finds_monthly_records():
    profile = student([('html', 3)])
    result = recommendations(profile, Filters(salary_min=8000, salary_period='month'), 'basic')
    assert result['candidate_count'] >= 1
    for item in result['items']:
        summary = item['salary_summary']
        assert summary['period'] == 'month'
        assert summary['max'] is None or summary['max'] >= 8000
        assert item['match']['basic'] is not None
