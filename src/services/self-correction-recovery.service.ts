import { ExecutionStage } from './cores/stages/execution.stage';
import { ComparisonStage } from './cores/stages/comparison.stage';
import type { Agent } from '../types/agent.types';
import type { PipelineInput, PipelineResult } from '../types';
import type { PlannerOutput } from '../types/planner.types';
import type { DecomposedQuery } from './query-decomposition.service';
import type { SelfCorrectionResult, RecoveryTrace } from '../types/self-correction.types';
import { appLogger } from '../utils/logger.util';

export interface SelfCorrectionRecoveryInput {
  input: PipelineInput;
  agent: Agent;
  plan: PlannerOutput;
  params: Record<string, unknown>;
  decompositionResult: DecomposedQuery;
  correction: SelfCorrectionResult;
  startTotal: number;
}

class SelfCorrectionRecoveryService {
  private executionStage = new ExecutionStage();
  private comparisonStage = new ComparisonStage();

  async recover(input: SelfCorrectionRecoveryInput): Promise<SelfCorrectionResult> {
    if (!input.correction.shouldRecover || input.correction.action === 'continue') {
      return input.correction;
    }

    if (input.correction.recoveryType === 'temporal_mismatch') {
      const recovered = await this.recoverComparison(input);
      if (recovered) return recovered;
    }

    if (input.correction.recoveryType === 'missing_dependency_result') {
      const recovered = await this.recoverDependencyExecution(input);
      if (recovered) return recovered;
    }

    return input.correction;
  }

  private async recoverComparison(input: SelfCorrectionRecoveryInput): Promise<SelfCorrectionResult | null> {
    try {
      const comparisonResult = await this.comparisonStage.tryExecuteStandalone({
        input: input.input,
        agent: input.agent,
        plan: input.plan,
        decompositionResult: input.decompositionResult,
        startTotal: input.startTotal,
        score: input.correction.confidence,
        analyzerSkill: 'trend_analyzer'
      });

      if (!comparisonResult.handled || !comparisonResult.result) {
        appLogger.debug('[SelfCorrectionRecovery] Comparison recovery unavailable', {
          userId: input.input.user_id,
          appName: input.input.app_name,
          reason: comparisonResult.reason
        });
        return null;
      }

      const trace = this.appendTrace(input.correction.trace, {
        type: 'temporal_mismatch',
        action: 'rerun_task',
        reason: 'Recovered comparison by executing baseline and target through ComparisonStage.',
        confidence: 0.88,
        timestamp: Date.now()
      });

      const result: PipelineResult = {
        ...comparisonResult.result,
        metadata: {
          ...(comparisonResult.result.metadata || {}),
          recovery: {
            detectedIssue: 'temporal_mismatch',
            reason: input.correction.reason,
            recovered: true,
            trace
          },
          recoveryTrace: trace
        }
      };

      return {
        ...input.correction,
        shouldRecover: false,
        action: 'rerun_task',
        confidence: 0.88,
        reason: 'Comparison recovered successfully.',
        recoveredPipelineResult: result,
        trace,
        recoveryContext: {
          detectedIssue: 'temporal_mismatch',
          reason: input.correction.reason,
          recovered: true,
          trace
        }
      };
    } catch (error) {
      appLogger.warn('[SelfCorrectionRecovery] Comparison recovery failed', {
        userId: input.input.user_id,
        appName: input.input.app_name,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async recoverDependencyExecution(input: SelfCorrectionRecoveryInput): Promise<SelfCorrectionResult | null> {
    const hasDependencies = input.plan.tasks?.some(task => task.depends_on?.length > 0);
    if (!hasDependencies) {
      return null;
    }

    try {
      const repairedPlan: PlannerOutput = {
        ...input.plan,
        mode: 'multi_step',
        chat: false,
        meta: {
          ...(input.plan.meta || {}),
          repaired: true
        }
      };

      const recoveredExecutionResult = await this.executionStage.execute(
        repairedPlan,
        input.input,
        input.params,
        {
          cacheResults: true,
          userId: input.input.user_id,
          appName: input.input.app_name
        }
      );

      const trace = this.appendTrace(input.correction.trace, {
        type: 'missing_dependency_result',
        action: 'rerun_task',
        reason: 'Re-ran plan in multi_step mode so dependencyResults are passed to data-dependent skills.',
        confidence: 0.82,
        timestamp: Date.now()
      });

      return {
        ...input.correction,
        shouldRecover: false,
        action: 'rerun_task',
        confidence: 0.82,
        reason: 'Dependency execution recovered successfully.',
        repairedPlan,
        recoveredExecutionResult,
        trace,
        recoveryContext: {
          detectedIssue: 'missing_dependency_result',
          reason: input.correction.reason,
          recovered: true,
          trace
        }
      };
    } catch (error) {
      appLogger.warn('[SelfCorrectionRecovery] Dependency recovery failed', {
        userId: input.input.user_id,
        appName: input.input.app_name,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private appendTrace(existing: RecoveryTrace[], next: RecoveryTrace): RecoveryTrace[] {
    return [...(existing || []), next];
  }
}

export const selfCorrectionRecoveryService = new SelfCorrectionRecoveryService();

