export type Dimension = 'skills' | 'certificates' | 'qualities';

export interface Ability {
  tag_id: string;
  label: string;
  level: number;
  confirmed: boolean;
  evidence: string;
}

export interface Intention {
  target_job_id: string;
  city: string;
}

export interface TagDef {
  id: string;
  label: string;
  dimension: Dimension;
  dimension_label?: string;
  aliases: string[];
}

export interface StudentProfile {
  major: string;
  skills: Ability[];
  certificates: Ability[];
  qualities: Ability[];
  experiences: string;
  intention: Intention;
  confirmed: boolean;
  advantages: string[];
  improvements: string[];
}

export interface Evidence {
  source_id: string;
  quote: string;
}

export interface Requirement {
  tag_id: string;
  label: string;
  dimension: Dimension;
  required_level: number;
  /** career-1.2：level_rule=样本原文措辞统计；default_baseline=画像整理默认；binary_requirement=二元具备要求 */
  level_source?: string;
  level_basis?: string;
  evidence?: Evidence[];
  selection_basis?: string;
}

export interface Salary {
  min: number | null;
  max: number | null;
  period: string;
  raw: string;
}

export interface Sample {
  id: string;
  company: string;
  city?: string;
  address?: string;
  salary: Salary;
  updated_raw?: string;
  url?: string;
  source_id: string;
  level_evidence?: string;
}

export interface JobSummary {
  id: string;
  name: string;
  family: string;
  level: string;
  summary: string;
  monogram: string;
  color: string;
  requirements: Requirement[];
  preferred: Requirement[];
  certificate_note: string;
  version: string;
}

export interface JobDetail extends JobSummary {
  samples: Sample[];
}

export interface PathNode {
  id: string;
  job_id: string;
  label: string;
  stage: number;
}

export interface CareerEdge {
  id: string;
  source: string;
  target: string;
  type: 'promotion' | 'transition';
  transferable: string[];
  gaps: string[];
  activity: string;
  source_type: string;
}

export interface CareerPaths {
  nodes: PathNode[];
  edges: CareerEdge[];
}

export interface MatchItem extends Requirement {
  status: 'satisfied' | 'gap' | 'pending';
  student_level: number | null;
  student_evidence: string;
  contribution: number;
  enhancement_basis: string;
  related_only: boolean;
}

export interface DimResult {
  id: Dimension;
  label: string;
  required: number;
  satisfied: number;
  basic: number | null;
  enhanced: number | null;
}

export interface MatchResult {
  job_id: string;
  job_name: string;
  algorithm_version: string;
  data_version: string;
  input_version: string;
  required: number;
  satisfied: number;
  basic: number | null;
  enhanced: number | null;
  dimensions: DimResult[];
  items: MatchItem[];
  satisfied_items: MatchItem[];
  gap_items: MatchItem[];
  pending_items: MatchItem[];
  notice?: string;
}

export interface Filters {
  city: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: 'month' | 'day';
  skills: string[];
}

export interface Recommendation {
  job_id: string;
  job_name: string;
  match: MatchResult;
  reason: string;
  samples: Sample[];
  matching_sample_count: number;
  /** 前端标记：目标岗位不在推荐前5时单独经 /api/matches 计算的条目 */
  standalone?: boolean;
}

export interface RecommendationsResp {
  items: Recommendation[];
  candidate_count: number;
  sort_by: string;
  note: string;
}

export interface Advice {
  fit_evaluation: string;
  learning_directions: string[];
  learning_steps: string[];
}

export interface ReportResp {
  job_id: string;
  job_name: string;
  match: MatchResult;
  advice: Advice;
  input_version: string;
  status: string;
  mode: string;
  generated_at: string;
  /** 服务端拼装好的报告原文；复制与导出必须逐字使用该文本 */
  export_text: string;
  notice: string;
}

export interface HealthResp {
  status: string;
  data_version: string;
  algorithm_version: string;
  llm_configured: boolean;
  llm_model: string;
  source_file: string;
}

export interface ProfileAnalysis {
  summary: string[];
  evidence_quotes: string[];
  notice: string;
}

export interface ProfileResp {
  profile: StudentProfile;
  analysis: ProfileAnalysis;
  mode: string;
}

export interface ResumeResp {
  profile: StudentProfile;
  notice: string;
  mode: string;
  text_length: number;
}

