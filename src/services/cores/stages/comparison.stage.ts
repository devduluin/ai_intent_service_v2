import { comparisonOrchestratorService } from '../../comparison-orchestrator.service';
import { ExecutionStage } from './execution.stage';
import { NaturalizationStage } from './naturalization.stage';
import type { Agent } from '../../../types/agent.types';
import type { PipelineInput, PipelineResult } from '../../../types';
import type { DecomposedQuery } from '../../query-decomposition.service';
import type { PlannerOutput } from '../../../types/planner.types';
import type { ComparisonExecutionContext } from '../../../types/comparison.types';
import { appLogger } from '../../../utils/logger.util';

export interface StandaloneComparisonStageInput {
  input: PipelineInput;
  agent: Agent;
  plan: PlannerOutput;
  decompositionResult: DecomposedQuery;
  startTotal: number;
  score?: number;
  analyzerSkill?: string;
}

export interface ComparisonStageResult {
  handled: boolean;
  result?: PipelineResult;
  reason?: string;
}

export class ComparisonStage {
  private executionStage = new ExecutionStage();
  private naturalizationStage = new NaturalizationStage();

  async tryExecuteStandalone(
    stageInput: StandaloneComparisonStageInput
  ): Promise<ComparisonStageResult> {
    const comparisonSignal = stageInput.decompositionResult.signals.comparison;
    const hasTemporalPair = (stageInput.decompositionResult.signals.temporalDetails?.length || 0) >= 2;
    const hasCurrentQueryBaseline = comparisonSignal?.baseline?.source === 'current_query';
    if (!comparisonSignal?.isComparison || (!hasCurrentQueryBaseline && !hasTemporalPair)) {
      return {
        handled: false,
        reason: 'not_standalone_comparison'
      };
    }

    const context = await comparisonOrchestratorService.buildStandaloneContext({
      input: stageInput.input,
      plan: stageInput.plan,
      decompositionResult: stageInput.decompositionResult,
      analyzerSkill: stageInput.analyzerSkill
    });

    if (!context) {
      appLogger.warn('[ComparisonStage] Context unavailable', {
        analyzerSkill: stageInput.analyzerSkill,
        temporalCount: stageInput.decompositionResult.signals.temporalDetails?.length || 0,
        comparisonBaselineSource: stageInput.decompositionResult.signals.comparison?.baseline?.source,
        planTasks: stageInput.plan.tasks?.map(t => `${t.resource}:${t.key}`).join(', ')
      });
      return {
        handled: false,
        reason: 'comparison_context_unavailable'
      };
    }

    if (this.hasMissingParams(context)) {
      appLogger.info('[ComparisonStage] Comparison context has missing params, continuing normal pipeline', {
        userId: stageInput.input.user_id,
        appName: stageInput.input.app_name,
        missingParams: context.missingParams
      });

      return {
        handled: false,
        reason: 'missing_params'
      };
    }

    appLogger.info('[ComparisonStage] Executing baseline and target in parallel', {
      userId: stageInput.input.user_id,
      appName: stageInput.input.app_name,
      baselineLabel: context.baseline.label,
      targetLabel: context.target.label,
      toolSlug: context.tool.slug
    });

    // ✅ Parallelize baseline and target execution (same tool, different params)
    const [baselineResult, targetResult] = await Promise.all([
      this.executeToolSide(
        context,
        context.baseline.params,
        stageInput.input,
        'baseline'
      ),
      this.executeToolSide(
        context,
        context.target.params,
        stageInput.input,
        'target'
      )
    ]);

    appLogger.info('[ComparisonStage] Tool execution completed, running analyzer', {
      userId: stageInput.input.user_id,
      appName: stageInput.input.app_name
    });

    const analyzerResult = await this.executeAnalyzer(
      context,
      baselineResult,
      targetResult,
      stageInput.input
    );

    const apiResults = {
      comparison: {
        mode: context.mode,
        operator: context.operator,
        tool: context.tool.slug,
        baseline: {
          label: context.baseline.label,
          params: context.baseline.params,
          result: baselineResult
        },
        target: {
          label: context.target.label,
          params: context.target.params,
          result: targetResult
        }
      },
      [context.analyzerSkill]: analyzerResult
    };

    const naturalResponse = await this.naturalizationStage.execute(
      apiResults,
      stageInput.input,
      stageInput.agent,
      {
        contextCache: {
          entities: context.commonParams,
          originalQuery: stageInput.input.text
        }
      }
    );

    appLogger.info('[ComparisonStage] Standalone comparison executed', {
      userId: stageInput.input.user_id,
      appName: stageInput.input.app_name,
      tool: context.tool.slug,
      baselineLabel: context.baseline.label,
      targetLabel: context.target.label
    });

    return {
      handled: true,
      result: {
        intent: 'comparison',
        score: stageInput.score ?? 1,
        apiResult: apiResults,
        naturalResponse,
        metadata: {
          totalTime: Date.now() - stageInput.startTotal,
          executedTasks: 3,
          totalTasks: 3,
          executedTasksDetails: [
            {
              key: context.toolTask.key,
              resource: 'tool',
              toolSlug: context.toolTask.key
            },
            {
              key: context.toolTask.key,
              resource: 'tool',
              toolSlug: context.toolTask.key
            },
            {
              key: context.analyzerSkill,
              resource: 'skill'
            }
          ],
          comparison: {
            mode: context.mode,
            operator: context.operator,
            tool: context.tool.slug,
            baselineLabel: context.baseline.label,
            targetLabel: context.target.label,
            baselineParams: context.baseline.params,
            targetParams: context.target.params
          } as any,
          resolvedParams: context.commonParams
        }
      }
    };
  }

  private async executeToolSide(
    context: ComparisonExecutionContext,
    params: Record<string, unknown>,
    input: PipelineInput,
    side: 'baseline' | 'target'
  ): Promise<unknown> {
    const result = await this.executionStage.execute(
      {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            ...context.toolTask,
            id: `${side}_${context.toolTask.id}`,
            depends_on: []
          }
        ]
      },
      {
        ...input,
        attributes: {
          ...(input.attributes || {}),
          params
        }
      },
      params,
      {
        cacheResults: true,
        userId: input.user_id,
        appName: input.app_name
      }
    );

    return result.results[context.toolTask.key];
  }

  private async executeAnalyzer(
    context: ComparisonExecutionContext,
    baselineResult: unknown,
    targetResult: unknown,
    input: PipelineInput
  ): Promise<unknown> {
    const analyzerParams = {
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
      userQuery: input.text,
      intent: 'comparison',
      language: input.language === 'en' ? 'en' : 'id',
      analysisDepth: 'standard'
    };

    const result = await this.executionStage.execute(
      {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: 'comparison_analyzer',
            resource: 'skill',
            key: context.analyzerSkill,
            depends_on: []
          }
        ]
      },
      input,
      analyzerParams,
      {
        cacheResults: false,
        userId: input.user_id,
        appName: input.app_name
      }
    );

    return result.results[context.analyzerSkill];
  }

  private hasMissingParams(context: ComparisonExecutionContext): boolean {
    return context.missingParams.common.length > 0 ||
      context.missingParams.baseline.length > 0 ||
      context.missingParams.target.length > 0;
  }
}
