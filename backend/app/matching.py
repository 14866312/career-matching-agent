"""确定性人岗匹配与岗位推荐（纯业务逻辑，不调用大模型）。

评分口径（对照实施计划 2.4 / 2.5，并对齐数据契约 career-1.3）：

基础匹配度 = 已满足的必需标签数 ÷ 必需标签总数 × 100%
    - 要求标签以"维度 + 规范标签 ID"标识；三个维度合并计数，不对维度百分比取平均。
    - 只统计岗位必需项(requirement=required / required=true)；优先项(preferred)与未提及(unmentioned)
      都不进入分母，未提及不等于无要求。
    - 学生"已确认(confirmed=True)、有证据且等级>0"才算满足；未确认、无证据或未填写的标签单列"待确认"，
      与"已确认不具备(等级=0)"的差距项分开。
    - 学生多出来的标签不进入分母，不稀释覆盖率；重复项（同一维度 + 规范标签 ID，含别名）只计一次。
    - 某维度没有要求 → 该维度"不适用"，basic/enhanced 为 None，不显示 0% 或 100%。
    - 整个岗位没有可用要求 → "无法计算"，并从推荐中排除。
    - 分数保留原始精度用于排序；页面展示值另给 basic_display / enhanced_display（四舍五入 1 位小数）。

增强匹配度 = 所有要求贡献之和 ÷ 要求总数 × 100%
    - 精确技能匹配贡献 = min(学生等级 ÷ 要求等级, 1)。
    - 证书与通用素质维持"明确满足为 1，否则为 0"，不按等级折算。
    - 无精确匹配时，只有岗位关联表(relations)中的已确认相关技能可产生贡献，上限 0.25；
      同一要求存在多个关联时取最大值，不累加；显示为"相关基础"，不进入基础满足项。
    - 要求等级优先取画像字段，并记录 level_rule 版本与 basis；缺省时按岗位文本
      "了解=1 / 熟悉=2 / 熟练=3" 映射；仍未明确时按画像整理默认等级，并标记为系统默认值。

推荐（2.5）：最多返回 5 个，候选不足 3 个时如实展示数量与原因，不填充不合格岗位；
同分按稳定岗位 ID 升序；城市与薪资筛选作用于实际招聘记录；薪资只在相同计薪周期内做区间重叠判定，
不做日薪/月薪换算；未设置薪资筛选时保留薪资未知（含"面议"）的记录。
招聘记录是赛题样本，更新日期保留原文，不代表当前仍在招聘，也不作为公司资质要求。
"""

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .data import dataset
from .models import Filters, StudentProfile

ALGORITHM_VERSION = 'matching-2.1'
LEVEL_BASELINE_VERSION = 'level-baseline-1.0'
DIMENSIONS = ('skills', 'certificates', 'qualities')
DEFAULT_DIMENSION_LABELS = {'skills': '专业技能', 'certificates': '证书要求', 'qualities': '通用素质'}
STATUS_TEXT = {'ok': '可计算', 'not_applicable': '不适用', 'not_computable': '无法计算'}
RELATION_WEIGHT_CAP = 0.25
DEFAULT_REQUIRED_LEVEL = 2
DISPLAY_DECIMALS = 1
CONTRIBUTION_DECIMALS = 2
RECOMMEND_LIMIT = 5
RECOMMEND_MIN = 3
SORT_FIELDS = ('basic', 'enhanced')
SALARY_PERIODS = ('month', 'day')
NEGOTIABLE_PERIOD = 'negotiable'
SORT_RULE = '匹配分数降序 → 同分直接按岗位ID升序（不再比较满足项数或要求项数）'
SCORE_RULE = ('basic = 已确认满足的必需标签数 / 必需标签总数；'
              'enhanced = 各要求贡献之和 / 要求总数（技能按 min(等级/要求等级,1)，'
              '证书与通用素质满足为 1，相关技能按关联表权重且上限 0.25）')
SKILL_FILTER_RULE = '技能筛选：所选标签必须全部出现在岗位要求或优先项标签中'

LEVEL_KEYWORDS = (('了解', 1), ('熟悉', 2), ('熟练', 3))
DEFAULT_PREFIX = '默认'
PREFERRED_MARKERS = ('preferred', 'optional')

_UNSUPPORTED_SALARY_MARKERS = ('/小时', '每小时', '元/时', '/年', '年薪', '时薪', '/周', '周薪')
_DAY_SALARY_MARKERS = ('/天', '元/日', '/日', '每天')
_NEGOTIABLE_SALARY_MARKERS = ('面议', '面谈', '薪资面议')
_SALARY_RANGE = re.compile(r'(\d+(?:\.\d+)?)\s*[-\u2014\u2013~\uff5e\u81f3]\s*(\d+(?:\.\d+)?)\s*(\u4e07|\u5343|[kK])?')
_SALARY_SUFFIX = re.compile(r'(\d+(?:\.\d+)?)\s*(\u4e07|\u5343|[kK])?\s*(?:\u5143|\u5757)?\s*(\u4ee5\u4e0a|\u4ee5\u4e0b|\u4ee5\u5185|\u8d77)')
_SALARY_PLAIN = re.compile(r'(\d+(?:\.\d+)?)\s*(\u4e07|\u5343|[kK])?\s*(?:\u5143|\u5757)')
_SALARY_FACTORS = {'\u4e07': 10000, '\u5343': 1000, 'k': 1000}
_CITY_SPLIT = re.compile(r'[-\u2013\u2014\u00b7/\u3001,\uff0c\s]+')

_TAG_INDEX = None
_TAG_INDEX_VERSION = None
_META_CACHE = {}


def _round(value, decimals):
    """四舍五入（ROUND_HALF_UP）。只用于展示值，分数本身保留原始精度。"""
    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    try:
        rounded = number.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return None
    return float(rounded + 0)


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fingerprint(payload):
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


def _meta(key, builder):
    """按数据集版本缓存从 data 契约读取的元信息（测试替换数据集时会自动重建）。"""
    version = str(dataset().get('version') or '')
    cache_key = (key, version)
    if cache_key not in _META_CACHE:
        _META_CACHE[cache_key] = builder()
    return _META_CACHE[cache_key]


def _dimension_labels():
    def build():
        labels = dict(DEFAULT_DIMENSION_LABELS)
        declared = dataset().get('dimension_labels') or {}
        for dimension in DIMENSIONS:
            value = declared.get(dimension)
            if isinstance(value, str) and value.strip():
                labels[dimension] = value.strip()
        return labels
    return _meta('dimension_labels', build)


def _level_rules():
    def build():
        rules = dict(dataset().get('rule_versions') or {})
        mapping = rules.get('level_mapping')
        if not isinstance(mapping, dict) or not mapping:
            mapping = {keyword: level for keyword, level in LEVEL_KEYWORDS}
        clean_mapping = {}
        for keyword, level in mapping.items():
            value = _number(level)
            if value is not None:
                clean_mapping[str(keyword)] = int(value)
        default = _number(rules.get('level_default'))
        return {
            'version': str(rules.get('level_rule') or LEVEL_BASELINE_VERSION),
            'mapping': clean_mapping or {keyword: level for keyword, level in LEVEL_KEYWORDS},
            'default': int(default) if default is not None else DEFAULT_REQUIRED_LEVEL,
        }
    return _meta('level_rules', build)


def _rule_versions():
    def build():
        rules = dict(dataset().get('rule_versions') or {})
        return {key: str(value) for key, value in rules.items() if isinstance(value, (str, int, float))}
    return _meta('rule_versions', build)


def _tag_index():
    """规范标签索引：id、标签名、别名都指向同一条标签（先到先得，结果稳定）。"""
    global _TAG_INDEX, _TAG_INDEX_VERSION
    data = dataset()
    version = str(data.get('version') or '')
    if _TAG_INDEX is None or _TAG_INDEX_VERSION != version:
        index = {}
        for tag in data.get('tags') or []:
            for alias in [tag.get('id'), tag.get('label'), *(tag.get('aliases') or [])]:
                key = str(alias or '').strip().casefold()
                if key and key not in index:
                    index[key] = tag
        _TAG_INDEX, _TAG_INDEX_VERSION = index, version
    return _TAG_INDEX


def canonical(tag_id):
    """把标签别名归一为规范标签 ID；字典外的标签返回去空格小写后的原值。"""
    value = str(tag_id or '').strip().casefold()
    if not value:
        return ''
    tag = _tag_index().get(value)
    return tag['id'] if tag is not None else value


def _tag_label(tag_id):
    tag = _tag_index().get(str(tag_id or '').strip().casefold())
    return str(tag['label']) if tag is not None else str(tag_id or '')


def _normalize_city(value):
    """城市归一：去空格、按 '-' 等分隔符取第一段、去掉结尾的"市"、统一小写。"""
    text = str(value or '').strip()
    if not text:
        return ''
    text = _CITY_SPLIT.split(text)[0].strip()
    return text.rstrip('\u5e02').casefold()


def _raw_period(raw):
    text = str(raw or '')
    if any(marker in text for marker in _NEGOTIABLE_SALARY_MARKERS):
        return NEGOTIABLE_PERIOD
    if any(marker in text for marker in _UNSUPPORTED_SALARY_MARKERS):
        return 'unknown'
    if any(marker in text for marker in _DAY_SALARY_MARKERS):
        return 'day'
    return None


def _bounds_from_raw(raw):
    text = str(raw or '')
    match = _SALARY_RANGE.search(text)
    if match:
        factor = _SALARY_FACTORS.get((match.group(3) or '').lower(), 1)
        low, high = float(match.group(1)) * factor, float(match.group(2)) * factor
        return min(low, high), max(low, high)
    single = _SALARY_SUFFIX.search(text)
    if single:
        factor = _SALARY_FACTORS.get((single.group(2) or '').lower(), 1)
        value = float(single.group(1)) * factor
        if single.group(3) in ('\u4ee5\u4e0b', '\u4ee5\u5185'):
            return None, value
        return value, None
    plain = _SALARY_PLAIN.search(text)
    if plain:
        factor = _SALARY_FACTORS.get((plain.group(2) or '').lower(), 1)
        value = float(plain.group(1)) * factor
        return value, value
    return None, None


def parse_salary(sample):
    """整理单条招聘样本的薪资：结构化字段优先，缺失时按原文解析，无法解析就保持 None。

    计薪周期识别顺序：原文明确标注的周期 → 样本声明周期 → unknown。
    面议样本标记为 negotiable，不伪造数值；日薪与月薪不作换算。
    """
    salary = sample.get('salary') or {}
    raw = str(salary.get('raw') or '').strip()
    declared = str(salary.get('period') or '').strip().casefold()
    declared = declared if declared in SALARY_PERIODS + (NEGOTIABLE_PERIOD,) else None
    raw_period = _raw_period(raw)
    period = raw_period or declared or 'unknown'
    structured_min, structured_max = _number(salary.get('min')), _number(salary.get('max'))
    parsed_min, parsed_max = _bounds_from_raw(raw)
    low = structured_min if structured_min is not None else parsed_min
    high = structured_max if structured_max is not None else parsed_max
    if low is not None and high is not None and high < low:
        low, high = high, low
    if period == NEGOTIABLE_PERIOD:
        low, high = None, None
    if structured_min is not None and structured_max is not None:
        source = 'structured'
    elif low is None and high is None:
        source = 'unknown'
    elif low is not None and high is not None:
        source = 'raw'
    else:
        source = 'partial'
    return {
        'min': low,
        'max': high,
        'period': period,
        'raw': raw,
        'source': source,
        'period_conflict': bool(raw_period and declared and raw_period != declared),
    }


def fingerprint(student, job):
    payload = {'student': student.model_dump(), 'job': job, 'algorithm': ALGORITHM_VERSION,
               'relations': dataset().get('relations'), 'levels': dataset().get('rule_versions')}
    return _fingerprint(payload)


def _relation_version():
    declared = _rule_versions().get('relation')
    return declared or ('relations-' + _fingerprint(dataset().get('relations') or []))


def _required_level(requirement):
    """返回 (要求等级, 来源, 规则版本)。来源：level_rule / default_baseline / profile_field / text_keyword。"""
    rules = _level_rules()
    basis = str(requirement.get('level_basis') or '')
    declared_source = str(requirement.get('level_source') or '').strip().lower()
    rule_version = str(requirement.get('level_rule_version') or '').strip() or None
    level = _number(requirement.get('required_level'))
    if level is not None and level >= 1:
        if rule_version or declared_source == 'level_rule':
            return int(level), 'level_rule', rule_version or rules['version']
        if DEFAULT_PREFIX in basis:
            return int(level), 'default_baseline', rules['version']
        return int(level), 'profile_field', rule_version
    text = basis or str(requirement.get('evidence_text') or '')
    best = None
    for keyword, value in rules['mapping'].items():
        position = text.find(keyword)
        if position >= 0 and (best is None or position < best[0]):
            best = (position, value)
    if best is not None:
        return int(best[1]), 'text_keyword', rules['version']
    return int(rules['default']), 'default_baseline', rules['version']


def _level_note(requirement, level, source):
    basis = str(requirement.get('level_basis') or '').strip()
    if basis:
        return basis
    if source == 'text_keyword':
        return '由岗位文本等级词（了解=1 / 熟悉=2 / 熟练=3）映射得到'
    if source == 'level_rule':
        return '按画像等级规则映射得到等级 ' + str(level)
    if source == 'default_baseline':
        return '岗位文本未明确等级，按画像整理默认等级 ' + str(level) + '（系统默认值，非招聘原文硬门槛）'
    return '要求等级来自岗位画像字段'


def _is_preferred_row(row, in_preferred_list):
    """优先项判定：优先相信数据里的 requirement/required 标记，缺省时按所在列表。"""
    marker = str(row.get('requirement') or '').strip().lower()
    if marker in PREFERRED_MARKERS:
        return True
    if marker == 'required':
        return False
    explicit = row.get('required')
    if isinstance(explicit, bool):
        return not explicit
    return bool(in_preferred_list)


def _ability_index(student):
    """按 (维度, 规范标签ID) 归并学生标签；重复项只保留最强者（已确认优先，其次等级高）。"""
    index, unknown, duplicates, ignored = {}, [], [], []
    for field in DIMENSIONS:
        for ability in list(getattr(student, field, None) or []):
            tag_id = canonical(getattr(ability, 'tag_id', ''))
            label = str(getattr(ability, 'label', '') or '')
            confirmed = bool(getattr(ability, 'confirmed', False))
            level = int(_number(getattr(ability, 'level', 0)) or 0)
            if not tag_id:
                ignored.append({'field': field, 'label': label})
                continue
            tag = _tag_index().get(tag_id)
            if tag is None:
                unknown.append({'field': field, 'tag_id': tag_id, 'label': label or tag_id,
                                'confirmed': confirmed, 'level': level})
            dimension = tag['dimension'] if tag is not None else field
            key = (dimension, tag_id)
            record = index.get(key)
            if record is None:
                index[key] = {'ability': ability, 'entries': 1}
                continue
            record['entries'] += 1
            previous = record['ability']
            current = (bool(previous.confirmed), bool(previous.evidence.strip()) or previous.level == 0, int(_number(previous.level) or 0))
            candidate = (confirmed, bool(ability.evidence.strip()) or level == 0, level)
            duplicates.append({'dimension': dimension, 'tag_id': tag_id, 'label': label or tag_id,
                               'entries': record['entries'], 'kept': candidate > current})
            if candidate > current:
                index[key]['ability'] = ability
    return index, unknown, duplicates, ignored


def _evaluate_requirement(requirement, abilities, relations, preferred=False):
    declared = str(requirement.get('dimension') or '').strip()
    tag_id = canonical(requirement.get('tag_id'))
    tag = _tag_index().get(tag_id) if tag_id else None
    if tag is not None:
        dimension, dimension_source = tag['dimension'], 'dictionary'
    elif declared in DIMENSIONS:
        dimension, dimension_source = declared, 'requirement'
    else:
        dimension, dimension_source = 'skills', 'fallback'
    required_level, level_source, level_rule = _required_level(requirement)
    record = abilities.get((dimension, tag_id))
    ability = record['ability'] if record is not None else None
    confirmed = bool(ability.confirmed) if ability is not None else None
    level = int(_number(ability.level) or 0) if ability is not None else None
    if ability is None:
        status, pending_reason, gap_reason = 'pending', 'not_provided', ''
    elif not confirmed:
        status, pending_reason, gap_reason = 'pending', 'unconfirmed', ''
    elif level <= 0:
        status, pending_reason, gap_reason = 'gap', '', 'confirmed_absent'
    elif not str(ability.evidence or '').strip():
        status, pending_reason, gap_reason = 'pending', 'missing_evidence', ''
    else:
        status, pending_reason, gap_reason = 'satisfied', '', ''

    contribution, contribution_type, basis, relations_used, shortfall = 0.0, 'none', '', [], False
    if status == 'satisfied':
        if dimension == 'skills':
            contribution = min(level / max(required_level, 1), 1.0)
            basis = '精确匹配：已确认等级 ' + str(level) + ' / 要求等级 ' + str(required_level)
            shortfall = contribution < 1.0
        else:
            contribution, basis = 1.0, '明确满足（已确认持有/具备）'
        contribution_type = 'exact'
    elif dimension == 'skills':
        for relation in relations or []:
            if canonical(relation.get('to')) != tag_id:
                continue
            source_key = ('skills', canonical(relation.get('from')))
            source_record = abilities.get(source_key)
            if source_record is None:
                continue
            source_ability = source_record['ability']
            if not bool(source_ability.confirmed) or int(_number(source_ability.level) or 0) <= 0 or not str(source_ability.evidence or '').strip():
                continue
            weight = min(_number(relation.get('weight')) or 0.0, RELATION_WEIGHT_CAP)
            if weight <= 0:
                continue
            relations_used.append({
                'from': source_key[1],
                'from_label': _tag_label(source_key[1]),
                'from_level': int(_number(source_ability.level) or 0),
                'weight': weight,
                'capped': bool((_number(relation.get('weight')) or 0.0) > RELATION_WEIGHT_CAP),
                'reason': str(relation.get('reason') or ''),
            })
            if weight > contribution:
                contribution = weight
                basis = str(relation.get('reason') or '') or ('相关技能 ' + _tag_label(source_key[1]) + ' 可提供相关基础')
        if contribution > 0:
            contribution_type = 'related'
            shortfall = True

    label = str(requirement.get('label') or (tag['label'] if tag is not None else tag_id))
    return (dimension, tag_id), {
        **requirement,
        'tag_id': tag_id,
        'label': label,
        'dimension': dimension,
        'declared_dimension': declared,
        'dimension_source': dimension_source,
        'tag_verified': tag is not None,
        'required_level': required_level,
        'required_level_source': level_source,
        'required_level_rule': level_rule,
        'required_level_note': _level_note(requirement, required_level, level_source),
        'preferred': bool(preferred),
        'status': status,
        'pending_reason': pending_reason,
        'gap_reason': gap_reason,
        'student_level': level if (ability is not None and confirmed) else None,
        'student_reported_level': level,
        'student_confirmed': confirmed,
        'student_evidence': str(getattr(ability, 'evidence', '') or '') if ability is not None else '',
        'student_evidence_present': bool(str(getattr(ability, 'evidence', '') or '').strip()) if ability is not None else False,
        'student_entry_count': record['entries'] if record is not None else 0,
        'contribution': contribution,
        'contribution_type': contribution_type,
        'contribution_display': _round(contribution, CONTRIBUTION_DECIMALS),
        'basis': basis,
        'enhancement_basis': basis,
        'enhancement_relations': relations_used,
        'related_only': bool(contribution_type == 'related'),
        'proficiency_shortfall': bool(shortfall),
    }


def _summarize(items):
    total = len(items)
    satisfied = sum(1 for x in items if x['status'] == 'satisfied')
    gap = sum(1 for x in items if x['status'] == 'gap')
    pending = sum(1 for x in items if x['status'] == 'pending')
    exact = sum(x['contribution'] for x in items if x['contribution_type'] == 'exact')
    related = sum(x['contribution'] for x in items if x['contribution_type'] == 'related')
    basic = (satisfied / total * 100) if total else None
    enhanced = ((exact + related) / total * 100) if total else None
    status = 'ok' if total else 'not_computable'
    return {
        'status': status,
        'status_text': STATUS_TEXT[status],
        'required': total,
        'satisfied': satisfied,
        'gap': gap,
        'pending': pending,
        'basic': basic,
        'enhanced': enhanced,
        'basic_display': _round(basic, DISPLAY_DECIMALS),
        'enhanced_display': _round(enhanced, DISPLAY_DECIMALS),
        'related_credit': related,
        'enhanced_below_basic': bool(total and basic is not None and enhanced is not None and enhanced < basic - 1e-9),
    }


def _dimension_summary(dimension, items):
    summary = _summarize(items)
    if summary['status'] == 'not_computable':
        summary['status'] = 'not_applicable'
        summary['status_text'] = STATUS_TEXT['not_applicable']
        summary['status_note'] = '该维度没有必需要求，本维度不适用；未提及不等于无要求。'
    else:
        summary['status_note'] = ''
    return {'id': dimension, 'label': _dimension_labels()[dimension], **summary}


def _unmentioned_items(job):
    """岗位画像中"未提及"的标签：只作说明，不进入分母，也不当作差距。"""
    declared = job.get('dimensions') or {}
    output = {}
    for dimension in DIMENSIONS:
        entry = declared.get(dimension) or {}
        ids = [str(x) for x in (entry.get('unmentioned') or []) if str(x).strip()]
        output[dimension] = [{'tag_id': canonical(x), 'label': _tag_label(x)} for x in ids]
    return output


def match_student(student: StudentProfile, job: dict) -> dict:
    """按固定口径计算一个学生对一个岗位画像的确定性匹配结果。"""
    rows = ([(row, False) for row in list(job.get('requirements') or [])]
            + [(row, True) for row in list(job.get('preferred') or [])])
    relations = list(dataset().get('relations') or [])
    abilities, unknown_tags, duplicate_tags, ignored_tags = _ability_index(student)

    items, preferred_items, seen_keys = [], [], []
    duplicate_requirements, preferred_overlaps, invalid_requirements = [], [], []
    for row, in_preferred in rows:
        raw_label = str((row or {}).get('label') or (row or {}).get('tag_id') or '')
        if not canonical((row or {}).get('tag_id')):
            invalid_requirements.append(raw_label)
            continue
        is_preferred = _is_preferred_row(row or {}, in_preferred)
        key, item = _evaluate_requirement(row or {}, abilities, relations, preferred=is_preferred)
        if key in seen_keys:
            (preferred_overlaps if is_preferred else duplicate_requirements).append(item['label'])
            continue
        seen_keys.append(key)
        (preferred_items if is_preferred else items).append(item)

    summary = _summarize(items)
    satisfied_items = [x for x in items if x['status'] == 'satisfied']
    gap_items = [x for x in items if x['status'] == 'gap']
    pending_items = [x for x in items if x['status'] == 'pending']
    counted_keys = list(seen_keys)
    extra_tags = []
    for key in sorted(k for k in abilities if k not in counted_keys):
        record = abilities[key]
        if _tag_index().get(key[1]) is None:
            continue
        if bool(record['ability'].confirmed) and int(_number(record['ability'].level) or 0) > 0:
            extra_tags.append({'dimension': key[0], 'tag_id': key[1],
                               'label': str(record['ability'].label or key[1]),
                               'level': int(_number(record['ability'].level) or 0)})

    rules = _rule_versions()
    reason = '该岗位画像没有可评分的要求标签，无法计算匹配度。' if summary['status'] == 'not_computable' else ''
    return {
        'job_id': str(job.get('id') or ''),
        'job_name': str(job.get('name') or ''),
        'algorithm_version': ALGORITHM_VERSION,
        'data_version': str(dataset().get('version') or ''),
        'job_version': str(job.get('version') or ''),
        'profile_confirmed': bool(getattr(student, 'confirmed', False)),
        'profile_confirmation_rule': '正式匹配应由调用方在用户确认画像后发起（StudentProfile.confirmed）；本函数只按各标签的 confirmed 评分。',
        'input_version': fingerprint(student, job),
        'versions': {
            'algorithm': ALGORITHM_VERSION,
            'data': str(dataset().get('version') or ''),
            'job': str(job.get('version') or ''),
            'profile_rule': rules.get('profile') or str(dataset().get('version') or ''),
            'tag_dictionary': rules.get('tag_dictionary') or str(dataset().get('version') or ''),
            'level_rule': _level_rules()['version'],
            'relation_set': _relation_version(),
            'relation_fingerprint': 'relations-' + _fingerprint(dataset().get('relations') or []),
        },
        'score_rule': SCORE_RULE,
        'score_precision': '分数保留原始精度用于排序；*_display 为四舍五入到 1 位小数的展示值',
        'not_computable_reason': reason,
        **summary,
        'dimensions': [_dimension_summary(dimension, [x for x in items if x['dimension'] == dimension]) for dimension in DIMENSIONS],
        'items': items,
        'satisfied_items': satisfied_items,
        'gap_items': gap_items,
        'pending_items': pending_items,
        'weak_proficiency_items': [x for x in satisfied_items if x['proficiency_shortfall']],
        'related_items': [x for x in items if x['related_only']],
        'preferred_summary': {
            'total': len(preferred_items),
            'satisfied': sum(1 for x in preferred_items if x['status'] == 'satisfied'),
            'pending': sum(1 for x in preferred_items if x['status'] == 'pending'),
            'gap': sum(1 for x in preferred_items if x['status'] == 'gap'),
            'matched_labels': [x['label'] for x in preferred_items if x['status'] == 'satisfied'],
            'missing_labels': [x['label'] for x in preferred_items if x['status'] != 'satisfied'],
            'note': '优先项只作为补充建议展示，不计入基础分与增强分的分母。',
        },
        'preferred_items': preferred_items,
        'preferred_overlaps': preferred_overlaps,
        'unmentioned_items': _unmentioned_items(job),
        'unmentioned_note': '未提及的标签不等于无要求，也不进入基础分与增强分的分母。',
        'duplicate_requirements': duplicate_requirements,
        'invalid_requirements': invalid_requirements,
        'unknown_student_tags': unknown_tags,
        'duplicate_student_tags': duplicate_tags,
        'ignored_student_tags': ignored_tags,
        'extra_confirmed_tags': extra_tags[:20],
        'extra_confirmed_count': len(extra_tags),
        'contribution_legend': {
            'exact': '精确匹配，贡献计入增强分',
            'related': '仅代表相关基础，不等于已掌握；不计入基础满足项',
        },
    }


def _sample_passes(sample, city, filters, salary_active):
    if city and _normalize_city(sample.get('city')) != city:
        return False, 'samples_city_filtered'
    if not salary_active:
        return True, ''
    salary = parse_salary(sample)
    if salary['period'] == NEGOTIABLE_PERIOD:
        return False, 'samples_salary_negotiable'
    if salary['period'] not in SALARY_PERIODS:
        return False, 'samples_salary_period_unknown'
    if salary['period'] != filters.salary_period:
        return False, 'samples_salary_period_mismatch'
    if salary['min'] is None and salary['max'] is None:
        return False, 'samples_salary_unparsed'
    if filters.salary_min is not None and salary['max'] is not None and salary['max'] < filters.salary_min:
        return False, 'samples_salary_below'
    if filters.salary_max is not None and salary['min'] is not None and salary['min'] > filters.salary_max:
        return False, 'samples_salary_above'
    return True, ''


def _salary_summary(samples, period):
    values, other = [], 0
    for sample in samples:
        salary = parse_salary(sample)
        if salary['period'] != period:
            other += 1
            continue
        if salary['min'] is not None and salary['max'] is not None:
            values.append(salary)
    return {
        'period': period,
        'min': min(x['min'] for x in values) if values else None,
        'max': max(x['max'] for x in values) if values else None,
        'sample_count': len(values),
        'other_period_count': other,
        'note': '仅统计同一计薪周期的样本，日薪与月薪不作换算；面议样本不参与薪资比较。',
    }


def _reason(match):
    met = '\u3001'.join(x['label'] for x in match['satisfied_items'][:3]) or '暂无已确认匹配项'
    missing = '\u3001'.join(x['label'] for x in match['gap_items'] + match['pending_items']) or '必需标签已全部覆盖，可继续提升熟练度'
    parts = ['已满足：' + met + '。', '主要差距：' + missing + '。']
    weak = [x['label'] for x in match['weak_proficiency_items']]
    if weak:
        parts.append('熟练度待提升：' + '\u3001'.join(weak[:3]) + '。')
    related = [x['label'] for x in match['related_items']]
    if related:
        parts.append('仅有相关基础（未确认掌握）：' + '\u3001'.join(related[:3]) + '。')
    return ''.join(parts)


def _reason_facts(match):
    return {
        'job_id': match['job_id'],
        'job_name': match['job_name'],
        'basic': match['basic'],
        'basic_display': match['basic_display'],
        'enhanced': match['enhanced'],
        'enhanced_display': match['enhanced_display'],
        'required': match['required'],
        'satisfied': match['satisfied'],
        'satisfied_labels': [x['label'] for x in match['satisfied_items']],
        'gap_labels': [x['label'] for x in match['gap_items']],
        'pending_labels': [x['label'] for x in match['pending_items']],
        'related_base_labels': [x['label'] for x in match['related_items']],
        'proficiency_shortfall_labels': [x['label'] for x in match['weak_proficiency_items']],
        'preferred_matched_labels': match['preferred_summary']['matched_labels'],
        'preferred_missing_labels': match['preferred_summary']['missing_labels'],
        'algorithms': match['versions'],
    }


def recommendations(student: StudentProfile, filters: Filters, sort_by='basic') -> dict:
    """对全部合格岗位评分，按确认口径筛选、稳定排序并返回最多 5 条推荐。"""
    if sort_by not in SORT_FIELDS:
        raise ValueError('排序字段只支持 basic 或 enhanced。')
    if filters.salary_min is not None and filters.salary_max is not None and filters.salary_min > filters.salary_max:
        raise ValueError('薪资下限不能大于上限。')
    salary_active = filters.salary_min is not None or filters.salary_max is not None
    city = _normalize_city(filters.city)

    requested, unrecognized = [], []
    for value in list(filters.skills or []):
        tag_id = canonical(value)
        if not tag_id or tag_id in requested:
            continue
        requested.append(tag_id)
        if _tag_index().get(tag_id) is None:
            unrecognized.append(str(value).strip() or tag_id)

    counted = {
        'jobs_total': 0,
        'jobs_duplicated': 0,
        'jobs_skill_filtered': 0,
        'jobs_sample_filtered': 0,
        'jobs_unscored': 0,
        'samples_total': 0,
        'samples_city_filtered': 0,
        'samples_salary_negotiable': 0,
        'samples_salary_period_unknown': 0,
        'samples_salary_period_mismatch': 0,
        'samples_salary_unparsed': 0,
        'samples_salary_below': 0,
        'samples_salary_above': 0,
        'samples_matched': 0,
        'samples_matched_salary_partial': 0,
    }
    ranked, unscored, seen = [], [], set()
    for job in dataset().get('jobs') or []:
        counted['jobs_total'] += 1
        job_id = str(job.get('id') or '')
        if not job_id or job_id in seen:
            counted['jobs_duplicated'] += 1
            continue
        seen.add(job_id)
        required_tags = {canonical(x.get('tag_id')) for x in job.get('requirements') or []}
        preferred_tags = {canonical(x.get('tag_id')) for x in job.get('preferred') or []}
        required_tags.discard('')
        preferred_tags.discard('')
        if requested and not set(requested).issubset(required_tags | preferred_tags):
            counted['jobs_skill_filtered'] += 1
            continue
        matched = []
        for sample in job.get('samples') or []:
            counted['samples_total'] += 1
            passed, reason = _sample_passes(sample, city, filters, salary_active)
            if passed:
                matched.append(sample)
                counted['samples_matched'] += 1
                if salary_active:
                    salary = parse_salary(sample)
                    if salary['source'] != 'structured' and (salary['min'] is None or salary['max'] is None):
                        counted['samples_matched_salary_partial'] += 1
            else:
                counted[reason] += 1
        if not matched:
            counted['jobs_sample_filtered'] += 1
            continue
        match = match_student(student, job)
        score = match[sort_by]
        if score is None:
            counted['jobs_unscored'] += 1
            unscored.append(job_id)
            continue
        ranked.append({'job': job, 'job_id': job_id, 'match': match, 'samples': matched, 'score': score,
                       'required_tags': required_tags, 'preferred_tags': preferred_tags})

    ranked.sort(key=lambda entry: (-entry['score'], entry['job_id']))

    items, previous = [], None
    for index, entry in enumerate(ranked[:RECOMMEND_LIMIT], start=1):
        match = entry['match']
        items.append({
            'rank': index,
            'job_id': entry['job_id'],
            'job_name': entry['job']['name'],
            'match': match,
            'score': {'sort_by': sort_by, 'value': entry['score'], 'basic': match['basic'], 'enhanced': match['enhanced'],
                      'display': _round(entry['score'], DISPLAY_DECIMALS)},
            'sort_key': {'score': entry['score'], 'job_id': entry['job_id']},
            'sort_rule': SORT_RULE,
            'tied_with_previous': bool(previous is not None and previous['score'] == entry['score']),
            'reason': _reason(match),
            'reason_facts': _reason_facts(match),
            'skill_filter_matches': [
                {'tag_id': tag_id, 'label': _tag_label(tag_id),
                 'source': 'required' if tag_id in entry['required_tags'] else 'preferred'}
                for tag_id in requested
            ],
            'samples': entry['samples'][:3],
            'matching_sample_count': len(entry['samples']),
            'cities': sorted({str(x.get('city') or '') for x in entry['samples']}),
            'salary_summary': _salary_summary(entry['samples'], filters.salary_period if salary_active else 'month'),
        })
        previous = entry

    notes = []
    if unrecognized:
        notes.append('筛选技能中有 ' + str(len(unrecognized)) + ' 个标签不在岗位画像字典中（' + '\u3001'.join(unrecognized[:5]) + '），无法与任何岗位匹配。')
    if counted['jobs_skill_filtered']:
        notes.append(str(counted['jobs_skill_filtered']) + ' 个岗位未同时包含全部所选技能标签。')
    if counted['jobs_sample_filtered']:
        notes.append(str(counted['jobs_sample_filtered']) + ' 个岗位没有符合城市或薪资条件的招聘记录。')
    if counted['samples_city_filtered']:
        notes.append(str(counted['samples_city_filtered']) + ' 条招聘样本城市与筛选城市不一致。')
    if counted['samples_salary_negotiable']:
        notes.append(str(counted['samples_salary_negotiable']) + ' 条样本薪资为面议，没有可验证区间，未参与薪资比较。')
    if counted['samples_salary_period_unknown']:
        notes.append(str(counted['samples_salary_period_unknown']) + ' 条样本的计薪周期无法识别（如小时薪、年薪），未参与薪资比较。')
    if counted['samples_salary_period_mismatch']:
        notes.append(str(counted['samples_salary_period_mismatch']) + ' 条样本的计薪周期与筛选周期不同，按要求不作日薪/月薪换算。')
    if counted['samples_salary_unparsed']:
        notes.append(str(counted['samples_salary_unparsed']) + ' 条样本未标注可解析的薪资区间，无法验证薪资条件。')
    if counted['samples_matched_salary_partial']:
        notes.append(str(counted['samples_matched_salary_partial']) + ' 条匹配样本只有单边薪资信息，无法验证的另一边不视为不满足。')
    if counted['jobs_unscored']:
        notes.append(str(counted['jobs_unscored']) + ' 个岗位没有可评分的要求标签，无法计算并已排除。')

    if not ranked:
        note = '没有符合当前筛选条件的岗位，请调整城市、薪资或技能筛选条件。'
    elif len(ranked) < RECOMMEND_MIN:
        note = '符合筛选条件的岗位只有 ' + str(len(ranked)) + ' 个，不足 ' + str(RECOMMEND_MIN) + ' 个，已如实展示实际数量，不用不合格岗位填充。'
    else:
        note = '按岗位画像匹配度排序；招聘记录仅用于城市与薪资筛选，样本更新日期不代表当前仍在招聘。'
    if len(ranked) > RECOMMEND_LIMIT:
        note += ' 共有 ' + str(len(ranked)) + ' 个岗位符合条件，仅展示前 ' + str(RECOMMEND_LIMIT) + ' 个。'

    return {
        'items': items,
        'candidate_count': len(ranked),
        'returned_count': len(items),
        'limit': RECOMMEND_LIMIT,
        'target_min': RECOMMEND_MIN,
        'sort_by': sort_by,
        'sort_rule': SORT_RULE,
        'skill_filter_rule': SKILL_FILTER_RULE,
        'algorithm_version': ALGORITHM_VERSION,
        'data_version': str(dataset().get('version') or ''),
        'input_version': _fingerprint({
            'student': student.model_dump(),
            'filters': filters.model_dump(),
            'sort_by': sort_by,
            'algorithm': ALGORITHM_VERSION,
            'relation_set': _relation_version(),
            'level_rule': _level_rules()['version'],
            'data': str(dataset().get('version') or ''),
        }),
        'applied_filters': {
            'city': city,
            'salary_min': filters.salary_min,
            'salary_max': filters.salary_max,
            'salary_period': filters.salary_period,
            'salary_active': salary_active,
            'skills': requested,
        },
        'unrecognized_skills': unrecognized,
        'filter_counts': counted,
        'filter_notes': notes,
        'unscored_job_ids': unscored,
        'ranked_summary': [
            {
                'rank': index,
                'job_id': entry['job_id'],
                'job_name': entry['job']['name'],
                'basic': entry['match']['basic'],
                'enhanced': entry['match']['enhanced'],
                'basic_display': entry['match']['basic_display'],
                'enhanced_display': entry['match']['enhanced_display'],
                'required': entry['match']['required'],
                'satisfied': entry['match']['satisfied'],
                'matching_sample_count': len(entry['samples']),
            }
            for index, entry in enumerate(ranked, start=1)
        ],
        'note': note,
        'sample_label': str(dataset().get('sample_label') or '赛题样本'),
        'sample_notice': '招聘记录为赛题样本，仅用于城市与薪资筛选，更新日期不代表当前仍在招聘。',
        'disclaimers': [str(x) for x in (dataset().get('disclaimers') or [])],
    }
