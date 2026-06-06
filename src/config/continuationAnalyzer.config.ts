// ============================================================
// Continuation Analyzer Configuration
// ============================================================
// Configurable parameters for continuation analysis
// All hardcoded values moved to this config object
// ============================================================

// ============================================================
// Types
// ============================================================

export interface ContinuationWeights {
  /** Weight for keyword matching (default: 0.4) */
  keywordMatch: number;
  
  /** Weight for entity continuity (default: 0.4) */
  entityContinuity: number;
  
  /** Weight for semantic similarity (default: 0.2) */
  semanticSimilarity: number;
  
  /** Weight for workflow continuity (default: 0.1) */
  workflowContinuity: number;
}

export interface TopicSimilarityScores {
  /** Score for keyword match (default: 0.85) */
  keywordMatch: number;
  
  /** Score for entity continuity (default: 0.90) */
  entityContinuity: number;
  
  /** Score for pronoun reference (default: 0.75) */
  pronounReference: number;
  
  /** Score for alternative entity pattern (default: 0.80) */
  alternativeEntity: number;
}

export interface ContinuationThresholds {
  /** High relevance threshold (default: 0.6) */
  highRelevance: number;
  
  /** Borderline low threshold (default: 0.4) */
  borderlineLow: number;
  
  /** Borderline high threshold (default: 0.7) */
  borderlineHigh: number;
  
  /** LLM fallback minimum score (default: 0.4) */
  llmFallbackMin: number;
  
  /** LLM fallback maximum score (default: 0.7) */
  llmFallbackMax: number;
}

export interface ContinuationAnalyzerConfig {
  /** Scoring weights (must sum to 1.0) */
  weights: ContinuationWeights;
  
  /** Workflow penalty factor (default: 0.9) */
  workflowPenaltyFactor: number;
  
  /** Topic similarity scores */
  topicSimilarityScores: TopicSimilarityScores;
  
  /** Decision thresholds */
  thresholds: ContinuationThresholds;
  
  /** Keywords that indicate analysis requests */
  analysisKeywords: string[];
  
  /** Enable LLM fallback (default: true) */
  enableLlmFallback: boolean;
  
  /** LLM fallback timeout in ms (default: 2000) */
  llmFallbackTimeout: number;
}

// ============================================================
// Default Configuration
// ============================================================

export const DEFAULT_CONTINUATION_CONFIG: ContinuationAnalyzerConfig = {
  weights: {
    keywordMatch: 0.4,
    entityContinuity: 0.4,
    semanticSimilarity: 0.2,
    workflowContinuity: 0.1
  },
  
  workflowPenaltyFactor: 0.9,
  
  topicSimilarityScores: {
    keywordMatch: 0.85,
    entityContinuity: 0.90,
    pronounReference: 0.75,
    alternativeEntity: 0.80
  },
  
  thresholds: {
    highRelevance: 0.6,
    borderlineLow: 0.4,
    borderlineHigh: 0.7,
    llmFallbackMin: 0.4,
    llmFallbackMax: 0.7
  },
  
  analysisKeywords: [
    'analisa', 'analyze', 'analisis', 'analy',
    'summary', 'ringkas', 'rangkum', 'hitung',
    'coba analisa', 'coba analyze', 'coba summary',
    'menurutmu', 'bagaimana pendapat', 'apa saran'
  ],
  
  enableLlmFallback: true,
  llmFallbackTimeout: 2000
};

// ============================================================
// Configuration Validation
// ============================================================

/**
 * Validate configuration object
 * Throws error if configuration is invalid
 */
export function validateConfig(config: Partial<ContinuationAnalyzerConfig>): void {
  if (config.weights) {
    const weightSum = Object.values(config.weights).reduce((sum, w) => sum + w, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
      throw new Error(
        `Weights must sum to 1.0, got ${weightSum}. ` +
        `Current weights: ${JSON.stringify(config.weights)}`
      );
    }
  }
  
  if (config.thresholds) {
    const { thresholds } = config;
    if (thresholds.borderlineLow >= thresholds.borderlineHigh) {
      throw new Error(
        `borderlineLow (${thresholds.borderlineLow}) must be < ` +
        `borderlineHigh (${thresholds.borderlineHigh})`
      );
    }
    
    if (thresholds.llmFallbackMin >= thresholds.llmFallbackMax) {
      throw new Error(
        `llmFallbackMin (${thresholds.llmFallbackMin}) must be < ` +
        `llmFallbackMax (${thresholds.llmFallbackMax})`
      );
    }
  }
  
  if (config.workflowPenaltyFactor !== undefined && 
      (config.workflowPenaltyFactor < 0 || config.workflowPenaltyFactor > 1)) {
    throw new Error(
      `workflowPenaltyFactor must be between 0 and 1, ` +
      `got ${config.workflowPenaltyFactor}`
    );
  }
}

/**
 * Merge partial config with defaults
 */
export function mergeConfig(
  partial: Partial<ContinuationAnalyzerConfig>
): ContinuationAnalyzerConfig {
  const merged: ContinuationAnalyzerConfig = {
    ...DEFAULT_CONTINUATION_CONFIG,
    ...partial,
    weights: {
      ...DEFAULT_CONTINUATION_CONFIG.weights,
      ...partial.weights
    },
    topicSimilarityScores: {
      ...DEFAULT_CONTINUATION_CONFIG.topicSimilarityScores,
      ...partial.topicSimilarityScores
    },
    thresholds: {
      ...DEFAULT_CONTINUATION_CONFIG.thresholds,
      ...partial.thresholds
    },
    analysisKeywords: [
      ...DEFAULT_CONTINUATION_CONFIG.analysisKeywords,
      ...(partial.analysisKeywords || [])
    ]
  };
  
  // Validate before returning
  validateConfig(merged);
  
  return merged;
}

// ============================================================
// Pre-built Configurations
// ============================================================

/**
 * Strict configuration - higher thresholds for continuation
 */
export const STRICT_CONFIG: ContinuationAnalyzerConfig = mergeConfig({
  thresholds: {
    highRelevance: 0.7,
    borderlineLow: 0.5,
    borderlineHigh: 0.8,
    llmFallbackMin: 0.5,
    llmFallbackMax: 0.8
  }
});

/**
 * Lenient configuration - lower thresholds for continuation
 */
export const LENIENT_CONFIG: ContinuationAnalyzerConfig = mergeConfig({
  thresholds: {
    highRelevance: 0.5,
    borderlineLow: 0.3,
    borderlineHigh: 0.6,
    llmFallbackMin: 0.3,
    llmFallbackMax: 0.6
  },
  weights: {
    keywordMatch: 0.3,
    entityContinuity: 0.5,  // Higher weight on entities
    semanticSimilarity: 0.2,
    workflowContinuity: 0.1
  }
});

/**
 * LLM-heavy configuration - more reliance on LLM fallback
 */
export const LLM_HEAVY_CONFIG: ContinuationAnalyzerConfig = mergeConfig({
  enableLlmFallback: true,
  llmFallbackTimeout: 3000,  // Longer timeout for LLM
  thresholds: {
    highRelevance: 0.5,
    borderlineLow: 0.3,
    borderlineHigh: 0.7,  // Wider borderline zone for LLM
    llmFallbackMin: 0.3,
    llmFallbackMax: 0.7
  }
});
