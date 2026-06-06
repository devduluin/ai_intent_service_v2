import type { Tool } from '../types';

export enum ComparisonCompatibilityLevel {
  EXACT_TOOL = 'exact_tool',
  SAME_DOMAIN = 'same_domain',
  AGGREGATABLE = 'aggregatable',
  INCOMPATIBLE = 'incompatible'
}

export interface ComparisonValidationResult {
  level: ComparisonCompatibilityLevel;
  isComparable: boolean;
  reason: string;
  baselineTool: string;
  targetTool: string;
}

class ComparisonCompatibilityService {
  validateExactTool(
    baselineTool: Tool,
    targetTool: Tool
  ): ComparisonValidationResult {
    if (baselineTool.slug === targetTool.slug) {
      return {
        level: ComparisonCompatibilityLevel.EXACT_TOOL,
        isComparable: true,
        reason: 'Same tool comparison is supported in V1',
        baselineTool: baselineTool.slug,
        targetTool: targetTool.slug
      };
    }

    return {
      level: ComparisonCompatibilityLevel.INCOMPATIBLE,
      isComparable: false,
      reason: 'V1 only supports exact same-tool comparison',
      baselineTool: baselineTool.slug,
      targetTool: targetTool.slug
    };
  }
}

export const comparisonCompatibilityService = new ComparisonCompatibilityService();
