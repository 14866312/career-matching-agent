"""请求 / 响应数据契约。

评分字段语义（与 backend/app/matching.py 的口径一致，改动前请先同步主 Agent）：

- Ability.level：保留旧数据的熟练度字段；当前匹配只根据是否在资料中提及技能判断，不推断熟练度。
- Ability.confirmed / StudentProfile.confirmed：兼容旧草稿，不作为匹配或生成报告的门槛。
- Ability.evidence：可选简历摘录，不要求用户补证据。
- Filters.city：按样本招聘记录的城市筛选；归一化后比较（去空格、取分隔符前一段、去结尾"市"）。
- Filters.salary_min / salary_max：与样本薪资做区间重叠判定，且只在计薪周期等于 salary_period 的
  样本内比较，日薪与月薪不作换算；未设置薪资条件时保留薪资未知的样本。
- Filters.skills：所选标签必须全部包含在岗位要求或优先项中，才保留该岗位。
- RecommendationRequest.sort_by：basic=基础匹配度（默认），enhanced=增强匹配度；同分按岗位 ID 升序。
"""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Dimension = Literal['skills', 'certificates', 'qualities']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Ability(StrictModel):
    tag_id: str = Field(min_length=1, max_length=80, description='规范标签 ID；别名会在匹配时归一为字典中的规范 ID')
    label: str = Field(min_length=1, max_length=100, description='展示用标签名')
    level: int = Field(default=2, ge=0, le=3, description='0=未掌握，1=了解，2=能够在指导下使用，3=能够独立使用')
    confirmed: bool = Field(default=False, description='旧草稿兼容字段；不再用于匹配门槛')
    evidence: str = Field(default='', max_length=3000, description='可选的简历原文摘录')
    source: Literal['resume', 'manual'] = Field(default='manual', description='技能来源，用于重新导入简历时更新提取结果')


class Intention(StrictModel):
    target_job_id: str = Field(default='', max_length=80, description='目标岗位 ID')
    city: str = Field(default='', max_length=80, description='意向城市；不填则不按城市筛选')


class StudentProfile(StrictModel):
    major: str = Field(default='', max_length=120)
    major_source: Literal['resume', 'manual'] = 'manual'
    skills: list[Ability] = Field(default_factory=list, max_length=100, description='专业技能标签')
    certificates: list[Ability] = Field(default_factory=list, max_length=50, description='证书标签')
    qualities: list[Ability] = Field(default_factory=list, max_length=50, description='通用素质标签')
    experiences: str = Field(default='', max_length=12000)
    experiences_source: Literal['resume', 'manual'] = 'manual'
    intention: Intention = Field(default_factory=Intention)
    confirmed: bool = Field(default=False, description='旧草稿兼容字段；不再作为操作门槛')
    advantages: list[str] = Field(default_factory=list, max_length=20)
    improvements: list[str] = Field(default_factory=list, max_length=20)


class MatchRequest(StrictModel):
    student: StudentProfile
    job_id: str = Field(min_length=1, max_length=80)


class Filters(StrictModel):
    city: str = Field(default='', max_length=80, description='城市筛选，作用于招聘样本；留空表示不限')
    salary_min: float | None = Field(default=None, ge=0, le=10000000, description='期望薪资下限，与样本薪资区间做重叠判定')
    salary_max: float | None = Field(default=None, ge=0, le=10000000, description='期望薪资上限，与样本薪资区间做重叠判定')
    salary_period: Literal['month', 'day'] = Field(default='month', description='计薪周期；只与该周期的样本比较，不做日薪/月薪换算')
    skills: list[str] = Field(default_factory=list, max_length=50, description='技能标签筛选：所选标签需全部包含')


class RecommendationRequest(StrictModel):
    student: StudentProfile
    filters: Filters = Field(default_factory=Filters)
    sort_by: Literal['basic', 'enhanced'] = Field(default='basic', description='排序依据；同分按岗位 ID 升序稳定排序')
