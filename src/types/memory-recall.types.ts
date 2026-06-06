import type { EpisodicMemory } from './episodic-memory.types';

export type MemoryRecallMode = 'auto' | 'recent' | 'date' | 'range' | 'intent';

export interface MemoryRecallRange {
  label: string;
  start?: string;
  end?: string;
}

export interface MemoryRecallInput {
  userId: string;
  appName: string;
  query: string;
  params?: Record<string, unknown>;
  timezone?: string;
}

export interface MemoryRecallItem {
  intent: string;
  topicKey?: string | null;
  topicLabel?: string | null;
  flowStage?: string | null;
  summary: string;
  taskPlan?: EpisodicMemory['taskPlan'];
  flowTrace?: EpisodicMemory['flowTrace'];
  created_at: string;
}

export interface MemoryRecallResult {
  kind: 'memory_recall';
  query: string;
  source: 'episodic_memory';
  range?: MemoryRecallRange;
  items: MemoryRecallItem[];
  summary: string;
  isEmpty: boolean;
  metadata: {
    itemCount: number;
    mode: Exclude<MemoryRecallMode, 'auto'>;
    topic?: string;
  };
}

export interface MemoryRecallResolvedQuery {
  mode: Exclude<MemoryRecallMode, 'auto'>;
  range?: MemoryRecallRange & {
    startDate?: Date;
    endDate?: Date;
  };
  topic?: string;
  limit: number;
}

export type MemoryRecallMemory = Pick<EpisodicMemory, 'intent' | 'summary' | 'created_at'>;
