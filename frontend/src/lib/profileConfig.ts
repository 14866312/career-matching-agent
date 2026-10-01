import type { Dimension } from '../types';

export interface DimensionConfig {
  key: Dimension;
  label: string;
  max: number;
  levels: boolean;
  placeholder: string;
}

export const DIM_CONFIGS: DimensionConfig[] = [
  { key: 'skills', label: '技能标签', max: 100, levels: true, placeholder: '输入技能后回车，例如 JavaScript' },
  { key: 'certificates', label: '证书', max: 50, levels: false, placeholder: '例如：软考程序员、CET-6' },
  { key: 'qualities', label: '通用素质', max: 50, levels: false, placeholder: '例如：客户沟通、文档编写' }
];
