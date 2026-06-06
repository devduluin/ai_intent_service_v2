import type { Tool } from './index';
import type { PlannerTask } from './planner.types';
import type { TemporalParamMappingResult } from '../services/temporal-param-adapter.service';
import type { ComparisonValidationResult } from '../services/comparison-compatibility.service';

export type ComparisonMode = 'standalone' | 'continuation';
export type ComparisonOperator = 'compare' | 'versus' | 'difference' | 'trend';
export type ComparisonResultSource = 'cache' | 'working_memory' | 'execute';

export interface ComparisonTemporalDetail {
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative';
  value: string;
  normalizedValue?: string;
  direction?: 'current' | 'past' | 'future';
}

export interface ComparisonSideContext {
  label: string;
  temporalDetails: ComparisonTemporalDetail[];
  params: Record<string, unknown>;
  result?: unknown;
  source: ComparisonResultSource;
  temporalMapping?: TemporalParamMappingResult;
}

export interface ComparisonExecutionContext {
  mode: ComparisonMode;
  operator: ComparisonOperator;
  toolTask: PlannerTask;
  tool: Tool;
  analyzerSkill: string;
  commonParams: Record<string, unknown>;
  compatibility: ComparisonValidationResult;
  missingParams: {
    common: string[];
    baseline: string[];
    target: string[];
  };
  baseline: ComparisonSideContext;
  target: ComparisonSideContext;
}

export interface ComparisonExecutionResult {
  apiResults: Record<string, unknown>;
  baselineResult: unknown;
  targetResult: unknown;
  analyzerResult?: unknown;
  metadata: {
    comparison: {
      mode: ComparisonMode;
      operator: ComparisonOperator;
      tool: string;
      baselineLabel: string;
      targetLabel: string;
      baselineParams: Record<string, unknown>;
      targetParams: Record<string, unknown>;
    };
  };
}
