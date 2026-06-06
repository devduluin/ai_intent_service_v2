import type { PlannerOutput } from '../types/planner.types';
import type { ActiveOffer, OfferHistoryItem } from './active-offer.types';

export interface WorkingMemoryData {
  /**
   * Intent yang sedang aktif (misal: 'leave', 'expense', 'meeting')
   */
  activeIntent?: string | null;

  /**
   * Workflow yang sedang dijalankan (misal: 'create_leave', 'approve_expense')
   */
  activeWorkflow?: string;

  /**
   * Tool yang sedang dieksekusi (misal: 'get_time', 'get_weather')
   */
  activeTool?: string;

  /**
   * Skill internal yang sedang/terakhir dieksekusi.
   */
  activeSkill?: string;

  /**
   * ✅ NEW: Planner tasks from last execution (for continuation reuse)
   */
  activePlan?: PlannerOutput | null;

  activeOffer?: ActiveOffer | null;
  offerHistory?: OfferHistoryItem[];

  /**
   * Entitas yang sedang diproses (dinamis, tergantung workflow)
   * Contoh: { leaveType: 'annual', duration: '3 days' }
   */
  activeEntities?: Record<string, unknown>;

  /**
   * Hint untuk continuation (apa yang bisa dilakukan selanjutnya)
   */
  continuationHints?: {
    canExport?: boolean;
    canSummarize?: boolean;
    canModify?: boolean;
    canCancel?: boolean;
    lastToolSlug?: string;  // Last executed tool slug for fallback
    lastSkillSlug?: string; // Last executed internal skill slug
    [key: string]: boolean | string | undefined;
  };

  /**
   * Metadata tambahan
   */
  metadata?: {
    createdAt?: number;
    updatedAt?: number;
    lastAccessedAt?: number;
    accessCount?: number;
    
    // C-009 Phase 2: Discussion mode tracking
    discussionTurns?: number;        // Number of turns in current discussion
    prevIntent?: string;             // Previous intent for discussion continuity
    topicRelevance?: number;         // Last topic relevance score
    lastDiscussionQuery?: string;    // Last discussion query
    discussionStartedAt?: number;    // When discussion mode started
    
    [key: string]: unknown;
  };
}

export interface WorkingMemoryOptions {
  ttl?: number; // Time to live in milliseconds
  userId?: string;
  appName?: string;
}

export interface WorkingMemoryResult {
  success: boolean;
  data?: WorkingMemoryData | null;
  error?: string;
}
