"""请求 / 响应数据契约。

评分字段语义（与 backend/app/matching.py 的口径一致，改动前请先同步主 Agent）：

- Ability.confirmed：用户是否确认该标签。未确认的标签只进入"待确认"，不计入满足项。
- Ability.level：0=未掌握（已确认则为差距项），1=了解，2=能够在指导下使用，3=能够独立使用。
- Ability.evidence：能力的证据原文；正能力缺少证据时归为待确认，不计满足或相关贡献。
- StudentProfile.confirmed：整份画像是否已由用户确认。正式匹配应由调用方在确认为真后发起；
  匹配函数只按每个 Ability.confirmed 评分，并把 profile_confirmed 回传给调用方用于拦截。
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
    confirmed: bool = Field(default=False, description='用户是否确认；未确认只进入待确认项，不计入满足项')
    evidence: str = Field(default='', max_length=3000, description='能力证据原文；正能力需有证据才计满足或相关贡献')


class Intention(StrictModel):
    target_job_id: str = Field(default='', max_length=80, description='目标岗位 ID')
    city: str = Field(default='', max_length=80, description='意向城市；不填则不按城市筛选')


class StudentProfile(StrictModel):
    major: str = Field(default='', max_length=120)
    skills: list[Ability] = Field(default_factory=list, max_length=100, description='专业技能标签')
    certificates: list[Ability] = Field(default_factory=list, max_length=50, description='证书标签')
    qualities: list[Ability] = Field(default_factory=list, max_length=50, description='通用素质标签')
    experiences: str = Field(default='', max_length=12000)
    intention: Intention = Field(default_factory=Intention)
    confirmed: bool = Field(default=False, description='画像整体确认状态；正式匹配、推荐和报告API必须为真，条目仍独立确认')
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
