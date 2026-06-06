import type { PlannerOutput, PlannerTask } from '../types/planner.types';
import type { Tool } from '../types';
import type { WorkingMemoryData } from '../types/working-memory.type';
import type { UserMessageSignals } from './query-decomposition.service';
import { comparisonCompatibilityService, type ComparisonValidationResult } from './comparison-compatibility.service';
import { temporalParamAdapterService, type TemporalParamMappingResult } from './temporal-param-adapter.service';
import { toolService } from './tools.service';

export interface ComparisonContext {
  mode: 'continuation' | 'standalone';
  operator: 'compare' | 'versus' | 'difference' | 'trend';
  sourceToolTask: PlannerTask;
  baselineTool: Tool;
  targetTool: Tool;
  compatibility: ComparisonValidationResult;
  baseline: {
    label: string;
    params: Record<string, unknown>;
    result?: unknown;
    source: 'cache' | 'working_memory' | 'execute';
  };
  target: {
    label: string;
    params: Record<string, unknown>;
    result?: unknown;
    source: 'execute';
    temporalMapping: TemporalParamMappingResult;
  };
}

class ComparisonPlanService {
  async detectExactToolComparison(input: {
    activePlan: PlannerOutput;
    workingMemory: WorkingMemoryData | null;
    baseParams: Record<string, unknown>;
    comparison: NonNullable<UserMessageSignals['comparison']>;
  }): Promise<ComparisonContext | null> {
    const sourceToolTask = this.selectPrimaryToolTask(input.activePlan, input.workingMemory);
    if (!sourceToolTask) {
      return null;
    }

    const tools = await toolService.getToolsBySlugs([sourceToolTask.key]);
    const baselineTool = tools[0];
    if (!baselineTool) {
      return null;
    }

    const targetTool = baselineTool;
    const compatibility = comparisonCompatibilityService.validateExactTool(baselineTool, targetTool);
    if (!compatibility.isComparable) {
      return null;
    }

    const toolParams = toolService.getToolParams(targetTool);
    const targetTemporal = input.comparison.target?.temporalDetails || [];
    const temporalMapping = temporalParamAdapterService.mapTemporalToToolParams(
      targetTemporal,
      toolParams,
      input.baseParams
    );

    if (temporalMapping.strategy === 'none') {
      return null;
    }

    return {
      mode: 'continuation',
      operator: input.comparison.operator,
      sourceToolTask,
      baselineTool,
      targetTool,
      compatibility,
      baseline: {
        label: this.inferBaselineLabel(input.baseParams),
        params: { ...input.baseParams },
        source: 'working_memory'
      },
      target: {
        label: temporalMapping.label || 'target',
        params: temporalMapping.params,
        source: 'execute',
        temporalMapping
      }
    };
  }

  buildSkillInput(
    context: ComparisonContext,
    baselineResult: unknown,
    targetResult: unknown,
    userQuery: string,
    language?: string
  ): Record<string, unknown> {
    return {
      data: {
        comparison: {
          mode: context.compatibility.level,
          operator: context.operator,
          baseline: {
            label: context.baseline.label,
            tool: context.baselineTool.slug,
            params: context.baseline.params,
            result: baselineResult
          },
          target: {
            label: context.target.label,
            tool: context.targetTool.slug,
            params: context.target.params,
            result: targetResult
          }
        }
      },
      userQuery,
      intent: 'comparison',
      language: language === 'en' ? 'en' : 'id',
      analysisDepth: 'standard'
    };
  }

  private selectPrimaryToolTask(
    activePlan: PlannerOutput,
    workingMemory: WorkingMemoryData | null
  ): PlannerTask | undefined {
    const toolTasks = activePlan.tasks?.filter(task => task.resource === 'tool') || [];
    if (toolTasks.length === 0) return undefined;

    if (workingMemory?.activeTool) {
      const activeToolTask = toolTasks.find(task => task.key === workingMemory.activeTool);
      if (activeToolTask) return activeToolTask;
    }

    return toolTasks[0];
  }

  private inferBaselineLabel(params: Record<string, unknown>): string {
    for (const key of ['date', 'period', 'month', 'start_date', 'from_date']) {
      const value = params[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value);
      }
    }

    return 'baseline';
  }
}

export const comparisonPlanService = new ComparisonPlanService();
