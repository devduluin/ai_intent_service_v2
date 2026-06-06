// ============================================================
// Perception Types — VIPER Perception & Intent Frame
// ============================================================
// Defines structured understanding of user intent before planning.
// PerceptionStage produces a PerceptionFrame that informs Planner.
// ============================================================

// ============================================================
// PerceptionIntentType — What kind of work is this?
// ============================================================

export type PerceptionIntentType =
  | 'direct_task'
  | 'memory_question'
  | 'memory_task_replay'
  | 'automation_request'
  | 'continuation_refine'
  | 'comparison'
  | 'offer_response'
  | 'small_talk'
  | 'unknown';

// ============================================================
// PerceptionOperation — What operations are implied?
// ============================================================

export type PerceptionOperation =
  | 'recall'
  | 'select'
  | 'execute'
  | 'schedule'
  | 'monitor'
  | 'compare'
  | 'analyze'
  | 'export'
  | 'notify'
  | 'clarify';

// ============================================================
// PerceptionFrame — Structured intent understanding
// ============================================================

export interface PerceptionFrame {
  /** Classified intent type */
  type: PerceptionIntentType;

  /** Implied operations ordered by logical sequence */
  operations: PerceptionOperation[];

  /** Confidence in frame classification (0-1) */
  confidence: number;

  /** Human-readable reasoning chain for debugging */
  reasoning: string[];

  /** Temporal scope extracted from query */
  temporalScope?: {
    /** Raw temporal expression from user text */
    raw?: string;
    /** Normalized temporal expression */
    normalized?: string;
    /** ISO date string for start of range */
    startDate?: string;
    /** ISO date string for end of range */
    endDate?: string;
    /** Relative offset in days from now */
    relativeOffsetDays?: number;
  };

  /** Target resource and kind */
  target?: {
    /** Resource category being targeted */
    resource?: 'tool' | 'skill' | 'knowledge' | 'memory' | 'automation';
    /** Specific resource key if identified */
    key?: string;
    /** Temporal/contextual kind of target */
    kind?: 'previous_task' | 'previous_topic' | 'current_context' | 'future_task';
  };

  /** Replay configuration (only set when type = memory_task_replay) */
  replay?: {
    /** Whether replay was explicitly requested */
    requested: boolean;
    /** Source of replay data */
    source: 'memory';
    /** Auto-execute if only one rerunnable task found */
    autoExecuteIfSingle: boolean;
    /** Ask user to choose if multiple candidates */
    clarifyIfMultiple: boolean;
  };

  /** Automation configuration (only set when type = automation_request) */
  automation?: {
    /** Whether automation was explicitly requested */
    requested: boolean;
    /** Type of automation */
    kind?: 'reminder' | 'scheduled_workflow' | 'conditional_alert';
    /** Whether this is a future task */
    futureTask: boolean;
  };

  /** Safety assessment for this frame */
  safety?: {
    /** Whether confirmation should be required before execution */
    requiresConfirmation?: boolean;
    /** Side effect level of the implied operations */
    sideEffectLevel?: 'none' | 'write' | 'external';
  };

  /** User emotional signal. This may adapt tone, but must never bypass safety. */
  emotion?: import('../utils/emotion-detector.util').EmotionResult;
}

// ============================================================
// PerceptionStage Input/Output
// ============================================================

import type { DecomposedQuery } from '../services/query-decomposition.service';
import type { WorkingMemoryData } from './working-memory.type';
import type { EpisodicMemory } from './episodic-memory.types';

export interface PerceptionStageInput {
  /** Original/normalized user text */
  text: string;
  /** Query decomposition result from PreProcessingStage */
  decomposition: DecomposedQuery;
  /** Active working memory (for continuation/offer context) */
  workingMemory?: WorkingMemoryData | null;
  /** Recent episodic memory entries */
  episodicMemory?: EpisodicMemory | null;
}

export interface PerceptionStageResult {
  /** The classified perception frame */
  frame: PerceptionFrame;
  /** Whether the frame is high-confidence enough to skip embedding */
  skipEmbedding?: boolean;
}
