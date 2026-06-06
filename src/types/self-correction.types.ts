import type { PlannerOutput } from './planner.types';
import type { PipelineInput } from './index';
import type { PerceptionFrame } from './perception.types';
import type { WorkingMemoryData } from './working-memory.type';
import type { ExecutionResult } from '../services/cores/stages/execution.stage';
import type { DecomposedQuery } from '../services/query-decomposition.service';
import type { PipelineResult } from './index';

export type RecoveryType =
  | 'planner_empty'
  | 'wrong_resource'
  | 'missing_dependency_result'
  | 'temporal_mismatch'
  | 'result_irrelevant'
  | 'unsafe_success_claim'
  | 'pretest_failed'
  | 'memory_replay_incomplete'
  | 'offer_misfire';

export type RecoveryAction =
  | 'continue'
  | 'replan'
  | 'rerun_task'
  | 'ask_clarification'
  | 'block_success_claim';

export interface RecoveryTrace {
  type: RecoveryType;
  action: RecoveryAction;
  reason: string;
  confidence: number;
  timestamp: number;
}

export interface RecoveryContext {
  detectedIssue?: RecoveryType;
  reason?: string;
  recovered: boolean;
  blockedSuccessClaim?: boolean;
  trace?: RecoveryTrace[];
}

export interface SelfCorrectionInput {
  input: PipelineInput;
  perceptionFrame?: PerceptionFrame | null;
  plan: PlannerOutput;
  params: Record<string, unknown>;
  executionResult: ExecutionResult;
  decompositionResult?: DecomposedQuery | null;
  workingMemory?: WorkingMemoryData | null;
  recoveryAttempt?: number;
}

export interface SelfCorrectionResult {
  shouldRecover: boolean;
  recoveryType?: RecoveryType;
  reason?: string;
  confidence: number;
  action: RecoveryAction;
  repairedPlan?: PlannerOutput;
  repairedParams?: Record<string, unknown>;
  recoveredPipelineResult?: PipelineResult;
  recoveredExecutionResult?: ExecutionResult;
  clarificationQuestion?: string;
  trace: RecoveryTrace[];
  recoveryContext?: RecoveryContext;
}
