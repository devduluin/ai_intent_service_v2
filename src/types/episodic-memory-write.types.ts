import type { PlannerOutput } from './planner.types';

export type EpisodicFlowStage =
  | 'main_pipeline'
  | 'slot_filling'
  | 'continuation'
  | 'comparison'
  | 'offer_generated'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'general_chat'
  | 'memory_replay'
  | 'memory_replay_clarify'
  | 'memory_replay_none'
  | 'error';

export interface EpisodicFlowTraceItem {
  stage: EpisodicFlowStage | string;
  resource?: 'tool' | 'skill' | 'knowledge';
  key?: string;
  type?: string;
  timestamp: number;
  params?: Record<string, unknown>;
}

export interface EpisodicMemoryWriteContext {
  topicKey: string;
  topicLabel?: string;
  flowStage: EpisodicFlowStage;
  summary?: string;
  taskPlan?: PlannerOutput | null;
  flowTrace?: EpisodicFlowTraceItem[];
  memoryMeta?: Record<string, unknown>;
}
