import type { AllowedOfferNaturalization } from '../../../../types/active-offer.types';
import type { EmotionResult } from '../../../../utils/emotion-detector.util';
import type { RecoveryContext } from '../../../../types/self-correction.types';

// ============================================================
// Context Cache - For passing previous results to ChatStage
// ============================================================
// Allows ChatStage to respond with knowledge of previous tool execution
// ============================================================

export interface ContextCache {
  /**
   * Previous tool/handler execution results
   * Example: { sales: 1000, trend: -0.20, period: 'minggu ini' }
   */
  previousToolResults?: Record<string, unknown>;

  /**
   * Previous intent slug
   * Example: 'sales_report', 'get_weather'
   */
  previousIntent?: string;

  /**
   * Continuation type that led to this context
   * Example: 'export', 'refine', 'detail', 'workflow'
   */
  continuationType?: string;

  /**
   * Extracted entities from previous execution
   * Example: { location: 'jakarta', date: '2024-01-15' }
   */
  entities?: Record<string, unknown>;

  /**
   * Original user query that triggered the execution
   * Example: 'penjualan minggu ini'
   */
  originalQuery?: string;

  /**
   * Timestamp of when context was cached
   */
  timestamp?: number;

  /**
   * Tool/handler slug that produced the cached results
   * Example: 'get_time', 'xls_generator'
   */
  cachedToolSlug?: string;

  /**
   * Flag indicating if cached context is available
   */
  hasCachedContext?: boolean;

  // ✅ OPTIMIZATION: Episodic memories for long-term context
  episodicMemories?: Array<{
    summary?: string;
    content?: string;
    lastAccessedAt?: number;
  }>;

  // ✅ OPTIMIZATION: Working memory for current context
  workingMemory?: {
    activeIntent?: string | null;
    activeEntities?: Record<string, unknown>;
    activeTool?: string;
    continuationHints?: any;
  };

  allowedOffer?: AllowedOfferNaturalization;

  emotion?: EmotionResult;

  recoveryContext?: RecoveryContext;
}

export interface ChatStageOptions {
  /**
   * Context cache from previous execution
   * If provided, ChatStage will include it in LLM prompt
   */
  contextCache?: ContextCache;
}
