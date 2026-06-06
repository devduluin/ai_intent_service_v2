import type { PlannerOutput, PlannerTask } from '../types/planner.types';
import type { PipelineInput, Tool } from '../types';
import type { WorkingMemoryData } from '../types/working-memory.type';
import type { DecomposedQuery, UserMessageSignals } from './query-decomposition.service';
import type { ComparisonExecutionContext, ComparisonTemporalDetail } from '../types/comparison.types';
import { comparisonCompatibilityService, type ComparisonValidationResult } from './comparison-compatibility.service';
import { comparisonTemporalSplitterService } from './comparison-temporal-splitter.service';
import { paramResolutionService } from './param-resolution.service';
import { temporalParamAdapterService } from './temporal-param-adapter.service';
import { toolService } from './tools.service';
import { PipelineValidator } from '../utils/pipeline-validator.util';
import { skillsRegistry } from './skills-registry.service';

export interface PrimaryToolSelectionInput {
  plan: PlannerOutput;
  workingMemory?: WorkingMemoryData | null;
}

export interface BuildStandaloneComparisonContextInput {
  input: PipelineInput;
  plan: PlannerOutput;
  decompositionResult: DecomposedQuery;
  analyzerSkill?: string;
}

export interface BuildContinuationComparisonContextInput {
  input: PipelineInput;
  activePlan: PlannerOutput;
  workingMemory: WorkingMemoryData | null;
  baseParams: Record<string, unknown>;
  comparison: NonNullable<UserMessageSignals['comparison']>;
  analyzerSkill?: string;
}

class ComparisonOrchestratorService {
  selectPrimaryToolTask(input: PrimaryToolSelectionInput): PlannerTask | undefined {
    const toolTasks = input.plan.tasks?.filter(task => task.resource === 'tool') || [];
    if (toolTasks.length === 0) {
      return undefined;
    }

    if (input.workingMemory?.activeTool) {
      const activeToolTask = toolTasks.find(task => task.key === input.workingMemory?.activeTool);
      if (activeToolTask) {
        return activeToolTask;
      }
    }

    return toolTasks[0];
  }

  async loadToolForTask(task: PlannerTask | undefined): Promise<Tool | null> {
    if (!task || task.resource !== 'tool') {
      return null;
    }

    const tools = await toolService.getToolsBySlugs([task.key]);
    return tools[0] || null;
  }

  validateExactToolCompatibility(
    baselineTool: Tool,
    targetTool: Tool
  ): ComparisonValidationResult {
    return comparisonCompatibilityService.validateExactTool(baselineTool, targetTool);
  }

  buildSkillInput(
    context: ComparisonExecutionContext,
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
            tool: context.tool.slug,
            params: context.baseline.params,
            result: baselineResult
          },
          target: {
            label: context.target.label,
            tool: context.tool.slug,
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

  async buildStandaloneContext(
    input: BuildStandaloneComparisonContextInput
  ): Promise<ComparisonExecutionContext | null> {
    const comparison = input.decompositionResult.signals.comparison;
    const hasStandaloneTemporalPair = (input.decompositionResult.signals.temporalDetails?.length || 0) >= 2;
    if (!comparison?.isComparison || (comparison.baseline?.source !== 'current_query' && !hasStandaloneTemporalPair)) {
      return null;
    }

    const toolTask = this.selectPrimaryToolTask({ plan: input.plan });
    const tool = await this.loadToolForTask(toolTask);
    if (!toolTask || !tool) {
      return null;
    }

    const compatibility = this.validateExactToolCompatibility(tool, tool);
    if (!compatibility.isComparable) {
      return null;
    }

    const temporalSplit = comparisonTemporalSplitterService.split(
      input.input.text,
      input.decompositionResult.signals.temporalDetails || [],
      comparison
    );

    if (temporalSplit.isAmbiguous) {
      return null;
    }

    const commonParams = await this.resolveCommonParams(input.input, input.plan, input.decompositionResult);
    return this.buildExactToolContext({
      mode: 'standalone',
      operator: comparison.operator,
      toolTask,
      tool,
      analyzerSkill: input.analyzerSkill,
      commonParams,
      compatibility,
      baselineTemporalDetails: temporalSplit.baselineTemporalDetails,
      targetTemporalDetails: temporalSplit.targetTemporalDetails
    });
  }

  async buildContinuationContext(
    input: BuildContinuationComparisonContextInput
  ): Promise<ComparisonExecutionContext | null> {
    if (!input.comparison?.isComparison) {
      return null;
    }

    const toolTask = this.selectPrimaryToolTask({
      plan: input.activePlan,
      workingMemory: input.workingMemory
    });
    const tool = await this.loadToolForTask(toolTask);
    if (!toolTask || !tool) {
      return null;
    }

    const compatibility = this.validateExactToolCompatibility(tool, tool);
    if (!compatibility.isComparable) {
      return null;
    }

    const temporalSplit = comparisonTemporalSplitterService.split(
      input.input.text,
      input.comparison.target?.temporalDetails || [],
      input.comparison
    );

    if (temporalSplit.isAmbiguous || temporalSplit.targetTemporalDetails.length === 0) {
      return null;
    }

    return this.buildExactToolContext({
      mode: 'continuation',
      operator: input.comparison.operator,
      toolTask,
      tool,
      analyzerSkill: input.analyzerSkill,
      commonParams: input.baseParams,
      compatibility,
      baselineTemporalDetails: [],
      targetTemporalDetails: temporalSplit.targetTemporalDetails
    });
  }

  private async resolveCommonParams(
    input: PipelineInput,
    plan: PlannerOutput,
    decompositionResult: DecomposedQuery
  ): Promise<Record<string, unknown>> {
    const resolution = await paramResolutionService.resolve(
      input,
      plan,
      decompositionResult,
      {
        mode: 'pipeline',
        ignoreTemporalDetails: true
      }
    );

    return this.removeTemporalParams(resolution.availableParams);
  }

  private buildExactToolContext(input: {
    mode: 'standalone' | 'continuation';
    operator: NonNullable<UserMessageSignals['comparison']>['operator'];
    toolTask: PlannerTask;
    tool: Tool;
    analyzerSkill?: string;
    commonParams: Record<string, unknown>;
    compatibility: ComparisonValidationResult;
    baselineTemporalDetails: ComparisonTemporalDetail[];
    targetTemporalDetails: ComparisonTemporalDetail[];
  }): ComparisonExecutionContext | null {
    const toolParams = toolService.getToolParams(input.tool);
    const analyzerSkill = input.analyzerSkill || this.selectAnalyzerSkill();

    if (!analyzerSkill) {
      return null;
    }

    const baselineMapping = input.baselineTemporalDetails.length > 0
      ? temporalParamAdapterService.mapTemporalToToolParams(
        input.baselineTemporalDetails,
        toolParams,
        input.commonParams
      )
      : {
        params: { ...input.commonParams },
        mappedKeys: [],
        strategy: 'none' as const,
        missingTemporalParams: [],
        label: this.inferBaselineLabel(input.commonParams)
      };

    const targetMapping = temporalParamAdapterService.mapTemporalToToolParams(
      input.targetTemporalDetails,
      toolParams,
      input.commonParams
    );

    const baselineParams = this.applyDefaultValues(toolParams, baselineMapping.params);
    const targetParams = this.applyDefaultValues(toolParams, targetMapping.params);
    const commonParams = this.applyDefaultValues(toolParams, { ...input.commonParams });

    return {
      mode: input.mode,
      operator: input.operator,
      toolTask: input.toolTask,
      tool: input.tool,
      analyzerSkill,
      commonParams,
      compatibility: input.compatibility,
      missingParams: {
        common: this.findMissingRequired(toolParams, commonParams, { ignoreTemporal: true }),
        baseline: this.findMissingRequired(toolParams, baselineParams),
        target: this.findMissingRequired(toolParams, targetParams)
      },
      baseline: {
        label: baselineMapping.label || this.inferBaselineLabel(baselineParams),
        temporalDetails: input.baselineTemporalDetails,
        params: baselineParams,
        source: input.mode === 'continuation' ? 'working_memory' : 'execute',
        temporalMapping: baselineMapping
      },
      target: {
        label: targetMapping.label || 'target',
        temporalDetails: input.targetTemporalDetails,
        params: targetParams,
        source: 'execute',
        temporalMapping: targetMapping
      }
    };
  }

  private findMissingRequired(
    toolParams: ReturnType<typeof toolService.getToolParams>,
    params: Record<string, unknown>,
    options: { ignoreTemporal?: boolean } = {}
  ): string[] {
    return toolParams
      .filter(param => param.isRequired)
      .filter(param => !(options.ignoreTemporal && this.isTemporalParam(param.name)))
      // Skip params with non-empty defaultValue — they're auto-resolvable
      .filter(param => {
        if (param.defaultValue !== undefined && param.defaultValue !== null && param.defaultValue !== '') {
          return false;
        }
        return !PipelineValidator.validateParamValue(param, params[param.name]);
      })
      .map(param => param.name);
  }

  private applyDefaultValues(
    toolParams: ReturnType<typeof toolService.getToolParams>,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...params };
    for (const param of toolParams) {
      if (result[param.name] === undefined || result[param.name] === null || result[param.name] === '') {
        if (param.defaultValue !== undefined && param.defaultValue !== null && param.defaultValue !== '') {
          result[param.name] = param.defaultValue;
        }
      }
    }
    return result;
  }

  private removeTemporalParams(params: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(params).filter(([key]) => !this.isTemporalParam(key))
    );
  }

  private isTemporalParam(name: string): boolean {
    return [
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun',
      'period',
      '__dateBlind',
      '__temporalQuestionType',
      '__clearedTemporalFilters'
    ].includes(name);
  }

  private selectAnalyzerSkill(): string | null {
    // ✅ PREFER trend_analyzer for comparison operations
    if (skillsRegistry.hasSkill('trend_analyzer')) {
      return 'trend_analyzer';
    }
    // Fallback to data_analyzer if trend_analyzer not available
    return skillsRegistry.hasSkill('data_analyzer') ? 'data_analyzer' : null;
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

export const comparisonOrchestratorService = new ComparisonOrchestratorService();
export { ComparisonOrchestratorService };
