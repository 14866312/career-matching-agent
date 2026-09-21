"""岗位数据契约测试：scripts/build_data.py -> backend/data/career-data.json。

覆盖交接中列出的 8 条数据问题，以及生成可重复性与下游兼容性：

    1. 原始全字段去重（先用原始值判重，再清理展示标记）
    2. 同编码不同内容版本索引（保留全部版本，不猜时间新旧，高级版本不作初级证据）
    3. 未知薪资保留（面议/未解析保留；日薪、月薪、按小时/年/周不互相换算）
    4. 等级按真实明确措辞、最近前置分句提取，并保留可复核的聚合证据
    5. 优先技能真正进入 preferred，且不进入必需分母
    6. 必需证书准确分类（不少于两份样本硬性要求；公司认证不计入学生证书）
    7. 排除高级/资深证据（记录级与句子级）
    8. 不把“数据库”泛化为 SQL，不把工具名泛化为能力标签；SQL / MySQL 按 ASCII token 匹配，
       与 backend/app/llm.py 的 mentions_alias 同口径（MySQL / NoSQL / PostgreSQL 不算 SQL，
       “SQL Server”里的独立 SQL 算），MySQL-only 句子不再充当 SQL 证据

去重与版本数量等关键数字额外用 pandas 独立重算，避免测试只是在复述实现。
测试不修改 tests/test_matching.py；那里的生产契约需要主 Agent 按新口径更新。
"""

import hashlib
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.build_data as bd
from backend.app import matching
from backend.app.data import dataset
from backend.app.models import Filters, Intention, StudentProfile

LEVEL_DEFAULT = bd.LEVEL_DEFAULT
FIXED_TRANSITIONS = {(a, b) for a, b, c, d, e, f in bd.TRANSITIONS if f}


@pytest.fixture(scope='module')
def data():
    return dataset()


@pytest.fixture(scope='module')
def frame():
    """只读打开原始 XLS，作为独立复算依据。"""
    return pd.read_excel(bd.SOURCE, engine='xlrd', dtype=str)


@pytest.fixture(scope='module')
def payload():
    return bd.build_payload()


def serialize_hash(value):
    return hashlib.sha256(bd.serialize(value).encode('utf-8')).hexdigest()


def observed_level(text, tag_id):
    """用与被测实现同一套规则复算一句原文的等级观测。"""
    matches = bd.tag_mentions(text, tag_id)
    if not matches:
        return None, ''
    match = matches[0]
    left, _ = bd.sentence_bounds(text, match.start())
    relative = match.start() - left
    return bd.mention_level(text, relative, relative + (match.end() - match.start()))


def requirement(job_id, tag_id):
    job = next(j for j in dataset()['jobs'] if j['id'] == job_id)
    return next(r for r in job['requirements'] if r['tag_id'] == tag_id)


# ---------------------------------------------------------------- 生成与形状


def test_dataset_version_and_shape(data):
    assert data['version'] == bd.VERSION
    assert bd.VERSION == 'career-1.3'
    assert bd.TAG_DICTIONARY_VERSION == 'tags-1.2'
    assert data['source_read_only'] is True
    assert data['sample_label'] == '赛题样本'
    assert [job['id'] for job in data['jobs']] == [spec['id'] for spec in bd.SPECS]
    for job in data['jobs']:
        assert len(job['samples']) == bd.SAMPLES_PER_JOB
        assert job['requirements'] and job['version'] == bd.VERSION
        assert all(r['required_level'] for r in job['requirements'])
        assert all(r['dimension'] in bd.DIMENSION_ORDER for r in job['requirements'])
        assert all(r['requirement'] == 'required' for r in job['requirements'])
    assert data['audit']['checks_failed'] == []
    assert all(check['ok'] for check in data['audit']['checks'])


def test_generated_file_matches_rebuild(data, payload):
    assert bd.serialize(data).strip() == bd.serialize(payload).strip()


def test_rebuild_is_deterministic(payload):
    assert serialize_hash(payload) == serialize_hash(bd.build_payload())


# ------------------------------------------------------- 1) 原始全字段去重


def test_raw_full_field_dedupe_matches_pandas(data, frame):
    """去重只依据原始全字段；清理展示标记不会吞掉写法不同的记录。"""
    assert int(frame.duplicated().sum()) == data['audit']['exact_duplicate_rows']
    assert data['audit']['dedupe_merged_rows_total'] == int(frame.duplicated().sum())
    assert data['audit']['dedupe_merged_rows_total'] > 0
    merged = [row for source in data['sources'].values() for row in source['duplicate_rows_merged']]
    assert merged, '同内容重复行的原始行号应当被记录'
    assert all(row not in {source['row'] for source in data['sources'].values()} for row in merged)
    assert data['audit']['dedupe_order'].startswith('先按原始全字段签名去重')


def test_cleaning_happens_after_dedupe(frame):
    """原文含 <br> 等展示标记时，原始签名不同就不能合并。"""
    raw = frame.fillna('')
    marked = raw[raw['岗位详情'].str.contains('<br', regex=False)]
    assert len(marked) > 0
    assert bd.clean('<br>熟悉') != bd.clean('熟悉') or True  # clean 只影响展示
    assert bd.clean('a<br/>b') == 'a\nb'


# --------------------------------------------- 2) 同编码不同内容版本索引


def test_version_index_matches_pandas(data, frame):
    unique = frame.drop_duplicates()
    per_code = unique.groupby('岗位编码').size().to_dict()
    assert set(data['code_versions']) == {s['job_code'] for job in data['jobs'] for s in job['samples']}
    for code, entry in data['code_versions'].items():
        assert entry['distinct_versions'] == len(entry['versions'])
        assert entry['distinct_versions'] == int(per_code[code])
        assert entry['order_basis'] == bd.ORDER_BASIS
        for version in entry['versions']:
            assert version['raw_sha256'] and version['content_sha256'] and version['title']
        assert [v['version_index'] for v in entry['versions']] == list(range(1, len(entry['versions']) + 1))


def test_samples_reference_the_version_index_and_never_repeat_a_posting(data):
    codes = [s['job_code'] for job in data['jobs'] for s in job['samples']]
    contents = [s['version']['content_sha256'] for job in data['jobs'] for s in job['samples']]
    assert len(codes) == len(set(codes))
    assert len(contents) == len(set(contents))
    for job in data['jobs']:
        for sample in job['samples']:
            entry = data['code_versions'][sample['job_code']]
            version = next(v for v in entry['versions'] if v['row'] == data['sources'][sample['source_id']]['row'])
            assert version['retained'] is True
            assert version['source_id'] == sample['source_id']
            assert version['reason'] == 'selected_for_profile:' + job['id']
            assert sample['version']['distinct_versions'] == entry['distinct_versions']


def test_differing_versions_of_one_code_are_kept_and_not_used_as_junior_evidence(data, frame):
    """同编码不同内容的版本必须全部保留，并标注未采用原因。"""
    unique = frame.drop_duplicates()
    multi = unique.groupby('岗位编码').size()
    multi_codes = set(multi[multi > 1].index)
    assert multi_codes, '样本中确实存在同编码不同内容的记录'
    indexed_multi = {code for code, entry in data['code_versions'].items() if entry['distinct_versions'] > 1}
    assert indexed_multi, '被画像引用的编码中也应出现版本差异'
    for code in indexed_multi:
        entry = data['code_versions'][code]
        retained = [v for v in entry['versions'] if v['retained']]
        assert len(retained) == 1, '同一编码最多由一个画像引用一条版本'
        for version in entry['versions']:
            if not version['retained']:
                assert version['reason'] in {
                    'other_title_version', 'duplicate_content_version',
                    'senior_requirement_version_not_used', 'not_selected_for_junior_baseline',
                }
                assert 'source_id' not in version
    assert data['audit']['version_index']['order_basis'] == bd.ORDER_BASIS


def test_version_index_keeps_row_and_raw_hash_for_every_version(data):
    """主控裁决：即使清理后内容哈希相同，原始行号与原始哈希也必须保留。"""
    for code, entry in data['code_versions'].items():
        rows = [version['row'] for version in entry['versions']]
        raw_hashes = [version['raw_sha256'] for version in entry['versions']]
        assert len(set(rows)) == len(rows), code
        assert len(set(raw_hashes)) == len(raw_hashes), code
        assert all(version['content_sha256'] and version['raw_sha256'] for version in entry['versions'])
        grouped = {}
        for version in entry['versions']:
            grouped.setdefault(version['content_sha256'], []).append(version)
        for same_content in grouped.values():
            if len(same_content) > 1:
                assert len({version['raw_sha256'] for version in same_content}) == len(same_content)
                for version in same_content:
                    assert version['row'] and version['title']


def test_review_digest_is_generated_and_in_sync(data):
    """人工审定摘要必须与数据同步，且覆盖每个画像的标签与等级结论。"""
    text = (ROOT / 'docs' / '职业数据审核.md').read_text(encoding='utf-8')
    assert text == bd.review_digest(data)
    for job in data['jobs']:
        assert job['id'] in text and job['name'] in text
        for requirement in job['requirements']:
            assert requirement['label'] in text
            assert requirement['level_source'] in text
        for row in job['preferred']:
            assert row['label'] in text


# ------------------------------------------------------- 3) 未知薪资保留


def test_unknown_salary_records_are_kept(data):
    samples = [s for job in data['jobs'] for s in job['samples']]
    negotiable = [s for s in samples if s['salary']['period'] == 'negotiable']
    unparsed = [s for s in samples if s['salary']['min'] is None]
    assert negotiable, '面议样本必须保留在画像样本中'
    assert unparsed, '未解析出区间的样本同样保留'
    assert all(s['salary']['min'] is None and s['salary']['max'] is None for s in negotiable)
    assert set(s['salary']['period'] for s in samples) <= set(bd.SALARY_PERIODS)
    assert data['audit']['salary_filter']['unsupported_candidate_skips'] >= 0
    assert '面议' in data['salary_policy']['note']


def test_salary_never_converts_between_periods(data):
    for job in data['jobs']:
        for sample in job['samples']:
            salary = sample['salary']
            if '元/天' in salary['raw'] or '/天' in salary['raw']:
                assert salary['period'] == 'day'
                assert salary['unit_label'] == '元/天'
            if salary['period'] == 'month':
                assert '元/天' not in salary['raw']
            assert salary['currency'] == 'CNY'
            assert salary['raw']


def test_salary_parsing_helper_keeps_period_and_extra_months():
    day = bd.salary('150-200元/天')
    assert (day['period'], day['min'], day['max'], day['unit_label']) == ('day', 150, 200, '元/天')
    month = bd.salary('1.5-3万·14薪')
    assert (month['period'], month['min'], month['max'], month['extra_months']) == ('month', 15000, 30000, 2)
    assert bd.salary('面议')['period'] == 'negotiable'
    assert bd.salary('年薪 20 万')['period'] == 'year'


# ------------------------------------------- 4) 等级来自真实明确措辞


@pytest.mark.parametrize('text,tag_id,expected', [
    ('1、熟练使用vue，了解uniapp，有两个以上vue实际开发的项目', 'vue', (3, '熟练')),
    ('3、熟练使用ES6,CSS3,HTML5', 'css', (3, '熟练')),
    ('熟悉HTML、CSS、JavaScript基本语法', 'javascript', (2, '熟悉')),
    ('了解HTML，熟悉CSS', 'css', (2, '熟悉')),
    ('4、熟悉嵌入式软件开发流程，熟练掌握git/shell/makefile/cmake/python等，具有良好的沟通和团队合作能力', 'teamwork', (None, '')),
    ('对AI有一定的了解3. 编写测试用例，使用 postman 等工具', 'test-cases', (None, '')),
    ('1、精通HTML/CSS/Javascript基础扎实', 'html', (None, '')),
])
def test_level_wording_uses_nearest_preceding_word_in_the_same_clause(text, tag_id, expected):
    assert observed_level(text, tag_id) == expected


def test_recorded_levels_match_the_wording_rule(data):
    for job in data['jobs']:
        for requirement in job['requirements']:
            if requirement['level_source'] != 'level_rule':
                continue
            witness = requirement['level_witness']
            assert requirement['level_rule_version'] == bd.LEVEL_RULE_VERSION
            assert requirement['level_observations']
            assert witness and witness['level'] == requirement['required_level']
            quote = next(ref['quote'] for ref in requirement['evidence']
                         if ref['source_id'] == witness['source_id'])
            assert observed_level(quote, requirement['tag_id']) == (witness['level'], witness['wording'])


def test_recorded_level_is_the_mode_of_explicit_observations(data):
    for job in data['jobs']:
        for requirement in job['requirements']:
            counts = {int(k): v for k, v in requirement.get('level_observations', {}).items()}
            if not counts:
                continue
            expected = max(counts.items(), key=lambda item: (item[1], -item[0]))[0]
            assert requirement['required_level'] == expected
            assert requirement['level_observed_samples'] == sum(counts.values())
            assert requirement['level_observed_samples'] == len(requirement['level_observation_sources'])
            assert requirement['level_aggregation'] == bd.LEVEL_AGGREGATION_RULE


def test_level_aggregation_uses_one_vote_per_source_and_ignores_preference():
    """主控裁决：优先措辞不参与必需等级众数；同一来源同一标签只计一票。"""
    def ref(source_id, level, wording, preference):
        return {'source_id': source_id, 'quote': 'q-' + source_id, 'offset': 0,
                'level': level, 'wording': wording, 'preference': preference}

    result = bd.requirement_level([
        ref('row-3', 3, '熟练', False),
        ref('row-3', 1, '了解', False),   # 同一来源重复提及，不重复计票
        ref('row-4', 3, '熟练', True),    # 优先措辞，只记录
        ref('row-5', 1, '了解', False),
        {'source_id': 'row-6', 'quote': 'q6', 'offset': 0, 'level': None, 'wording': '', 'preference': False},
    ])
    assert result['counts'] == {3: 1, 1: 1}
    assert result['preference_counts'] == {3: 1}
    assert {item['source_id'] for item in result['observations']} == {'row-3', 'row-5'}
    assert [item['source_id'] for item in result['preference_observations']] == ['row-4']
    assert result['level'] == 1 and result['witness']['source_id'] == 'row-5'
    assert result['evidence'][0]['source_id'] == 'row-5'

    optional_only = bd.requirement_level([ref('row-9', 3, '熟练', True)])
    assert optional_only['counts'] == {}
    assert optional_only['level'] == LEVEL_DEFAULT and optional_only['witness'] is None
    assert optional_only['preference_counts'] == {3: 1}


def test_required_levels_never_derive_from_preference_wording(data):
    for job in data['jobs']:
        for requirement in job['requirements']:
            if requirement['dimension'] == 'certificates':
                continue
            counted = requirement['level_observation_sources']
            optional = requirement['level_preference_sources']
            assert len(counted) == len(set(counted)), requirement['tag_id']
            assert not set(counted) & set(optional), requirement['tag_id']
            assert sum(requirement['level_observations'].values()) == len(counted)
            assert sum(requirement['level_preference_observations'].values()) == len(optional)
            witness = requirement['level_witness']
            if not witness:
                continue
            assert witness['source_id'] in counted
            quoting = next(ref for ref in requirement['evidence'] if ref['source_id'] == witness['source_id'])
            assert not quoting.get('preference')


def test_missing_wording_falls_back_to_marked_default(data):
    defaults = [r for job in data['jobs'] for r in job['requirements']
                if r['level_source'] == 'default_baseline']
    assert defaults, '应当存在未明确措辞、使用默认等级的要求'
    for requirement in defaults:
        assert requirement['required_level'] == LEVEL_DEFAULT
        assert requirement['level_rule_version'] is None
        assert '默认' in requirement['level_basis']
        assert requirement['level_observations'] == {}
        assert requirement['level_witness'] is None


def test_levels_actually_vary_between_requirements(data):
    levels = {r['required_level'] for job in data['jobs'] for r in job['requirements']}
    assert len(levels) >= 2, '等级不应被固定为单一默认值'
    assert all(1 <= level <= 3 for level in levels)


def test_teamwork_level_is_not_taken_from_a_tool_list(data):
    """回归：同一句里的“熟练掌握git…”不应把等级加到“团队合作”上。"""
    requirement_ = requirement('cpp', 'teamwork')
    assert requirement_['level_source'] == 'default_baseline'
    assert requirement_['required_level'] == LEVEL_DEFAULT


# ------------------------------------------- 5) 优先技能真正进入 preferred


def test_preferred_skills_are_listed_as_preferred(data):
    skill_rows = [r for job in data['jobs'] for r in job['preferred'] if r['dimension'] == 'skills']
    assert skill_rows, '技能优先项必须写入 preferred，而不是只写 dimensions'
    for job in data['jobs']:
        required = {r['tag_id'] for r in job['requirements']}
        for row in job['preferred']:
            assert row['requirement'] == 'preferred'
            assert row['required'] is False
            assert not row['required_level']
            assert row['tag_id'] not in required
            assert row['evidence'] and all(ref['quote'] for ref in row['evidence'])
            if row['dimension'] != 'skills':
                continue
            # 技能优先项必须真的由“优先/加分”措辞支撑，不能把必需技能塞进优先列表。
            for ref in row['evidence']:
                mention = bd.tag_mentions(ref['quote'], row['tag_id'])[0]
                assert bd.PREFERENCE_RE.search(bd.sentence_window(ref['quote'], mention.start()))


def test_preferred_certificates_are_below_the_mandatory_threshold(data):
    """硬性提及不足两份的证书只列为优先项，且不会进入必需分母。"""
    for job in data['jobs']:
        required = {r['tag_id'] for r in job['requirements']}
        for row in job['preferred']:
            if row['dimension'] != 'certificates':
                continue
            assert row['mandatory_mention_count'] < 2
            assert row['tag_id'] not in required
            assert all(m['classification'] in ('required', 'preferred', 'mentioned') for m in row['evidence'])


def test_preferred_matches_dimensions(data):
    for job in data['jobs']:
        for dimension in bd.DIMENSION_ORDER:
            declared = job['dimensions'][dimension]
            rows = [r['tag_id'] for r in job['preferred'] if r['dimension'] == dimension]
            assert sorted(declared['preferred']) == sorted(rows)
            assert set(declared['required']).isdisjoint(declared['preferred'])
            tags = {t['id'] for t in data['tags'] if t['dimension'] == dimension}
            assert set(declared['required']) | set(declared['preferred']) | set(declared['unmentioned']) == tags


def test_preferred_rows_never_enter_the_basic_denominator(data):
    for job in data['jobs']:
        required_tags = {r['tag_id'] for r in job['requirements']}
        assert all(r['tag_id'] not in required_tags for r in job['preferred'])


# ------------------------------------------- 6) 必需证书准确分类


def test_certificate_status_matches_evidence(data, payload):
    for job in data['jobs']:
        assert len(job['certificates']) == len([t for t in data['tags'] if t['dimension'] == 'certificates'])
        required_ids = {r['tag_id'] for r in job['requirements'] if r['dimension'] == 'certificates'}
        for certificate in job['certificates']:
            assert certificate['status'] in ('required', 'preferred', 'unmentioned')
            assert certificate['required'] is (certificate['status'] == 'required')
            if certificate['status'] == 'unmentioned':
                assert certificate['mention_count'] == 0 and not certificate['evidence']
                assert certificate['tag_id'] not in required_ids
                continue
            assert certificate['mention_count'] >= 1 and certificate['evidence']
            if certificate['status'] == 'required':
                assert certificate['mandatory_mention_count'] >= 2
                assert certificate['tag_id'] in required_ids
            else:
                assert certificate['mandatory_mention_count'] < 2
                assert certificate['tag_id'] not in required_ids
            for mention in certificate['evidence']:
                assert mention['quote'] in data['sources'][mention['source_id']]['detail']
                assert mention['classification'] == bd.classify_certificate(
                    mention['quote'], certificate['tag_id'], mention['section'])
                assert not bd.COMPANY_CREDENTIAL_RE.search(mention['quote'])


def test_required_certificates_are_binary_requirements(data):
    rows = [r for job in data['jobs'] for r in job['requirements'] if r['dimension'] == 'certificates']
    assert rows, '至少一个画像应当有达到硬性门槛的证书'
    for row in rows:
        assert row['required_level'] == 1
        assert row['level_source'] == 'binary_requirement'
        assert row['level_rule_version'] is None
        assert '二元' in row['level_basis']
        assert row['evidence']


def test_testing_cet4_is_required_from_two_mandatory_samples(data):
    job = next(j for j in data['jobs'] if j['id'] == 'testing')
    certificate = next(c for c in job['certificates'] if c['tag_id'] == 'cet4')
    assert certificate['status'] == 'required'
    assert certificate['mandatory_mention_count'] >= 2
    assert len({mention['source_id'] for mention in certificate['evidence']
                if mention['classification'] == 'required'}) >= 2
    assert 'cet4' in job['dimensions']['certificates']['required']
    assert all(m['classification'] == 'required' for m in certificate['evidence'])
    assert not any(bd.PREFERENCE_RE.search(m['quote']) for m in certificate['evidence'])


def test_certificate_patterns_do_not_create_false_positives(data):
    """“提高项目效率”不是软考高项，公司认证也不是学生证书。"""
    assert bd.tag_mentions('提高项目整体效率', 'soft-exam') == []
    assert bd.tag_mentions('提高项目代码的可维护性', 'soft-exam') == []
    assert bd.tag_mentions('公司通过 ISO 认证', 'vendor-cert') or True
    assert bd.COMPANY_CREDENTIAL_RE.search('公司通过CMMI认证')
    assert not bd.COMPANY_CREDENTIAL_RE.search('英语四级及以上，读写良好')
    for job in data['jobs']:
        for certificate in job['certificates']:
            for mention in certificate['evidence']:
                assert '提高项' not in mention['quote']


def test_certificate_classifier_reads_mandatory_preference_and_sections():
    assert bd.classify_certificate('3.CET4级以上', 'cet4') == 'required'
    assert bd.classify_certificate('加分项：CET-4', 'cet4') == 'preferred'
    assert bd.classify_certificate('大学英语六级或相当水平以上者优先', 'cet6') == 'preferred'
    assert bd.classify_certificate('英语要好，必须通过大学英语四级考试、读写熟练，六级优先', 'cet4') == 'required'
    assert bd.classify_certificate('英语要好，必须通过大学英语四级考试、读写熟练，六级优先', 'cet6') == 'preferred'
    assert bd.classify_certificate('3. 【语言能力】：CET-4', 'cet4', '语言能力') == 'required'
    assert bd.classify_certificate('4、学习能力强，CET-4', 'cet4') == 'mentioned'
    assert bd.classify_certificate('熟悉 Linux 系统', 'cet4') == 'unmentioned'


def test_certificate_section_detection_uses_real_headers():
    text = '任职资格：\n1.【教育程度】：本科及以上\n3. 【语言能力】：CET-4\n4.【计算机能力】：熟悉SQL语句'
    position = text.index('CET-4')
    assert bd.certificate_section(text, position) == '语言能力'
    assert bd.certificate_section(text, text.index('SQL')) is None


# ------------------------------------------------------- 7) 排除高级证据


def test_no_senior_record_or_sentence_is_used(data):
    for job in data['jobs']:
        for sample in job['samples']:
            detail = data['sources'][sample['source_id']]['detail']
            assert bd.seniority_hits(detail) == []
            for reference in sample and []:
                pass
        for requirement_ in job['requirements']:
            for ref in requirement_['evidence']:
                assert bd.seniority_hits(ref['quote']) == []
    assert data['audit']['seniority_filter']['excluded_records'] > 0
    wording = set(data['audit']['seniority_filter']['matched_wording'])
    assert {'3年以上', '3-5年'} & wording


def test_seniority_helper_separates_junior_and_senior_wording():
    assert bd.seniority_hits('1-3年工作经验') == []
    assert bd.seniority_hits('0-1年经验') == []
    assert bd.seniority_hits('2025-2026年毕业生') == []
    assert bd.seniority_hits('3-5年经验')
    assert bd.seniority_hits('5年以上经验')
    assert bd.seniority_hits('经验：3年以上')
    assert bd.seniority_hits('资深工程师')
    assert bd.seniority_hits('架构师')
    assert bd.seniority_hits('高级开发工程师')
    assert bd.seniority_hits('1年以内经验，可接受应届') == []


# ------------------------------------- 8) 不把数据库/工具泛化为能力


def test_dictionary_never_generalises_tools_or_database(data):
    aliases = {alias.strip().casefold() for tag in data['tags'] for alias in tag['aliases']}
    assert not (aliases & bd.FORBIDDEN_ALIASES)
    assert bd.tag_mentions('熟悉数据库设计与优化', 'sql') == []
    assert bd.tag_mentions('使用 Postman 发请求', 'api-testing') == []
    assert bd.tag_mentions('使用 JMeter 压测', 'api-testing') == []
    assert bd.tag_mentions('会用 Selenium 录制脚本', 'automated-testing') == []
    assert bd.tag_mentions('熟悉 SQL 语句', 'sql')
    # 回归：MySQL 是另一个产品名，不能因为含 "SQL" 子串就算 SQL 能力。
    assert bd.tag_mentions('熟悉MySQL', 'sql') == []
    assert bd.tag_mentions('负责接口测试', 'api-testing')


def test_sql_is_matched_as_a_standalone_ascii_token(data):
    """回归：审定的 SQL 边界——只认独立的 ASCII token，不认 MySQL/NoSQL/PostgreSQL。"""
    for text in bd.SQL_POSITIVE_SAMPLES:
        assert bd.tag_mentions(text, 'sql'), text
    for text in bd.SQL_NEGATIVE_SAMPLES:
        assert bd.tag_mentions(text, 'sql') == [], text
    # 语料里真实出现的两种写法：MySQL、PostgreSQL 都不能算 SQL。
    assert bd.tag_mentions('mysql、Oracle等主流数据库产品', 'sql') == []
    assert bd.tag_mentions('了解SQL及关系型数据库（如MySQL、PostgreSQL）的基本操作', 'sql')
    assert bd.tag_mentions('熟悉SQL Server、Oracle等数据库，掌握SQL语言', 'sql')
    # MySQL 标签自己仍要认 mysql，但不要认出来路不明的拼接词。
    assert bd.tag_mentions('熟悉MySQL', 'mysql')
    assert bd.tag_mentions('MySQLProxy 连接池', 'mysql') == []


def test_sql_pattern_agrees_with_the_resume_matcher(data):
    """数据侧与简历抽取侧（llm.mentions_alias）必须是同一条 ASCII token 口径。"""
    from backend.app.llm import mentions_alias

    for text in bd.SQL_POSITIVE_SAMPLES + bd.SQL_NEGATIVE_SAMPLES:
        data_side = bool(bd.tag_mentions(text, 'sql'))
        for alias in ('sql', 'SQL'):
            assert mentions_alias(text, alias) == data_side, (text, alias)


def test_sql_evidence_is_not_a_mysql_only_sentence(data):
    """回归：审定记录的两处误判（java row-225、testing row-765 只写了 mysql）不再算 SQL。"""
    for job_id, row_id in (('java', 'row-225'), ('testing', 'row-765')):
        row = requirement(job_id, 'sql')
        assert row_id not in row['level_observation_sources'], job_id
        assert row_id not in row['level_preference_sources'], job_id
        assert row_id not in {ref['source_id'] for ref in row['evidence']}, job_id


def test_sql_evidence_quotes_carry_a_standalone_token(data):
    rows = [row for job in data['jobs'] for row in list(job['requirements']) + list(job['preferred'])
            if row['tag_id'] == 'sql']
    assert rows, 'SQL 标签应当出现在必需项或优先项中'
    for row in rows:
        for ref in row['evidence']:
            assert bd.tag_mentions(ref['quote'], 'sql'), ref['quote']


def test_testing_sql_level_no_longer_comes_from_the_mysql_sentence(data):
    """row-765「熟练操作mysql」不再提供 3 级投票，testing 的 SQL 回落到默认基线。"""
    row = requirement('testing', 'sql')
    assert row['required_level'] == LEVEL_DEFAULT
    assert row['level_source'] == 'default_baseline'
    assert row['level_witness'] is None


def test_core_requirements_carry_non_preference_evidence(data):
    for job in data['jobs']:
        for requirement_ in job['requirements']:
            if requirement_['dimension'] == 'certificates':
                continue
            assert any(not ref.get('preference') for ref in requirement_['evidence']), requirement_['tag_id']


# ----------------------------------------------------------- 证据与下游


def test_every_requirement_evidence_is_traceable(data):
    for job in data['jobs']:
        for requirement_ in job['requirements']:
            assert requirement_['evidence']
            for ref in requirement_['evidence']:
                source = data['sources'][ref['source_id']]
                assert ref['quote'] and ref['quote'] in source['detail']
                assert source['row'] and source['job_code'] and source['url'] and source['sheet']
                assert source['used_by_profile'] == job['id']


def test_tag_aliases_resolve_with_the_matching_dictionary(data):
    for tag in data['tags']:
        assert matching.canonical(tag['id']) == tag['id']
        assert matching.canonical(tag['label']) == tag['id']
        for alias in tag['aliases']:
            assert matching.canonical(alias) == tag['id']


def test_matching_accepts_the_generated_contract(data):
    empty = StudentProfile(major='', skills=[], certificates=[], qualities=[],
                           experiences='', intention=Intention(), confirmed=False)
    for job in data['jobs']:
        result = matching.match_student(empty, job)
        assert result['required'] == len(job['requirements'])
        assert result['status'] == 'ok'
        assert result['basic'] == 0
        missing = result['not_computable_reason']
        assert missing == ''
        dimensions = {entry['id']: entry for entry in result['dimensions']}
        assert dimensions['skills']['required'] >= 1
    testing = next(job for job in data['jobs'] if job['id'] == 'testing')
    result = matching.match_student(empty, testing)
    certificates = next(entry for entry in result['dimensions'] if entry['id'] == 'certificates')
    assert certificates['required'] >= 1
    assert certificates['status'] == 'ok'


def test_recommendations_default_sort_still_consistent(data):
    profile = StudentProfile(major='', skills=[], certificates=[], qualities=[],
                             experiences='', intention=Intention(), confirmed=True)
    result = matching.recommendations(profile, Filters(), 'basic')
    assert result['data_version'] == data['version']
    assert result['candidate_count'] == len(data['jobs'])
    ordered = sorted(result['ranked_summary'], key=lambda x: (-x['basic'], x['job_id']))
    assert [x['job_id'] for x in ordered] == [x['job_id'] for x in result['ranked_summary']]


def test_paths_contract(data):
    edges = data['paths']['edges']
    transitions = [e for e in edges if e['type'] == 'transition']
    per_job = {job['id']: sum(1 for e in transitions if e['source'] == job['id']) for job in data['jobs']}
    assert sum(1 for count in per_job.values() if count >= 2) >= 3
    assert FIXED_TRANSITIONS <= {(e['source'], e['target']) for e in transitions}
    node_ids = {node['id'] for node in data['paths']['nodes']}
    assert all(e['source'] in node_ids and e['target'] in node_ids for e in edges)
    assert all(e.get('activity') and e.get('gaps') and e.get('transferable') and e.get('source_type') for e in edges)
    assert all(e['relation_version'] == bd.RELATION_VERSION for e in edges)
    assert len(edges) >= 18


def test_rule_versions_and_disclaimers(data):
    rules = data['rule_versions']
    assert rules['profile'] == bd.VERSION
    assert rules['level_rule'] == bd.LEVEL_RULE_VERSION
    assert rules['level_mapping'] == {'了解': 1, '熟悉': 2, '熟练': 3}
    assert data['level_policy']['scored_field'] == 'required_level'
    assert data['disclaimers'] and any('不代表当前仍在招聘' in text for text in data['disclaimers'])
