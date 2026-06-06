// ============================================================
// Confidence Aggregator - Combines all continuation scores
// ============================================================
// Weighted scoring: pattern, semantic, memory, workflow, entity
// ============================================================

import { appLogger } from '../../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface ContinuationScores {
  patternScore: number;    // Keyword pattern matching (0-1)
  semanticScore: number;   // Embedding similarity (0-1)
  memoryScore: number;     // Working memory match (0-1)
  workflowScore: number;   // Workflow continuity (0-1)
  entityScore: number;     // Entity substitution (0-1)
}

export interface AggregatedResult {
  finalConfidence: number;      // 0-1 weighted score
  isContinuation: boolean;      // True if >= threshold
  continuationType: string;     // 'refine', 'workflow', 'export', etc.
  scoreBreakdown: ContinuationScores;
  reasoning: string[];          // Human-readable reasons
  recommendation?: {
    action: 'execute' | 'clarify' | 'chat';
    targetSkill?: string;
    targetTool?: string;
  };
}

export interface AggregatorConfig {
  continuationThreshold: number;   // Default: 0.60
  clarifyThreshold: number;        // Default: 0.45
}

// ============================================================
// Confidence Aggregator
// ============================================================

/**
 * ConfidenceAggregator - Combines multiple signals into final confidence
 *
 * Weights (sum to 1.0):
 * - pattern: 0.30    (keyword patterns like "kalau", "export")
 * - semantic: 0.30   (embedding similarity with previous query)
 * - memory: 0.20     (working memory context match)
 * - workflow: 0.10   (multi-step workflow detection)
 * - entity: 0.10     (entity substitution detection)
 */
export class ConfidenceAggregator {
  private readonly DEFAULT_WEIGHTS = {
    pattern: 0.30,
    semantic: 0.30,
    memory: 0.20,
    workflow: 0.10,
    entity: 0.10,
  };

  private readonly DEFAULT_CONFIG: AggregatorConfig = {
    continuationThreshold: 0.35,  // LOWERED from 0.60 to 0.35 for better detection
    clarifyThreshold: 0.45,
  };

  private weights = { ...this.DEFAULT_WEIGHTS };
  private config = { ...this.DEFAULT_CONFIG };

  /**
   * Aggregate all scores into final confidence
   */
  aggregate(scores: ContinuationScores, context?: {
    previousIntent?: string;
    detectedEntity?: string;
    workflowType?: string;
  }): AggregatedResult {
    // Validate scores are in valid range
    const validatedScores = this.validateScores(scores);

    // Calculate weighted confidence
    const finalConfidence =
      validatedScores.patternScore * this.weights.pattern +
      validatedScores.semanticScore * this.weights.semantic +
      validatedScores.memoryScore * this.weights.memory +
      validatedScores.workflowScore * this.weights.workflow +
      validatedScores.entityScore * this.weights.entity;

    // Round to 2 decimal places
    const roundedConfidence = Math.round(finalConfidence * 100) / 100;

    // Determine if it's a continuation
    const isContinuation = roundedConfidence >= this.config.continuationThreshold;

    // Determine continuation type based on highest contributing score
    const continuationType = this.inferContinuationType(validatedScores, context);

    // Build reasoning
    const reasoning = this.buildReasoning(validatedScores, continuationType);

    // Build recommendation
    const recommendation = this.buildRecommendation(roundedConfidence, continuationType, context);

    // Log aggregation result
    appLogger.debug('[ConfidenceAggregator] Aggregated', {
      finalConfidence: roundedConfidence,
      isContinuation,
      continuationType,
      scores: validatedScores,
      weights: this.weights
    });

    return {
      finalConfidence: roundedConfidence,
      isContinuation,
      continuationType,
      scoreBreakdown: validatedScores,
      reasoning,
      recommendation
    };
  }

  /**
   * Validate and normalize scores to 0-1 range
   */
  private validateScores(scores: ContinuationScores): ContinuationScores {
    const clamp = (value: number) => Math.max(0, Math.min(1, value));

    return {
      patternScore: clamp(scores.patternScore ?? 0),
      semanticScore: clamp(scores.semanticScore ?? 0),
      memoryScore: clamp(scores.memoryScore ?? 0),
      workflowScore: clamp(scores.workflowScore ?? 0),
      entityScore: clamp(scores.entityScore ?? 0),
    };
  }

  /**
   * Infer continuation type from scores
   */
  private inferContinuationType(
    scores: ContinuationScores,
    context?: {
      previousIntent?: string;
      detectedEntity?: string;
      workflowType?: string;
    }
  ): string {
    // Entity substitution → 'refine'
    if (scores.entityScore > 0.8) {
      return 'refine';
    }

    // Workflow continuity → 'workflow'
    if (scores.workflowScore > 0.7) {
      return context?.workflowType || 'workflow';
    }

    // Strong pattern match
    if (scores.patternScore > 0.7) {
      // Check for specific patterns
      if (context?.detectedEntity === 'export') {
        return 'export';
      }
      return 'refine';
    }

    // Semantic similarity → 'continuation'
    if (scores.semanticScore > 0.6) {
      return 'continuation';
    }

    // Memory match → 'contextual'
    if (scores.memoryScore > 0.5) {
      return 'contextual';
    }

    // Default
    return 'new';
  }

  /**
   * Build human-readable reasoning
   */
  private buildReasoning(
    scores: ContinuationScores,
    continuationType: string
  ): string[] {
    const reasons: string[] = [];

    if (scores.patternScore > 0.7) {
      reasons.push('Strong keyword pattern match');
    } else if (scores.patternScore > 0.4) {
      reasons.push('Moderate keyword pattern match');
    }

    if (scores.semanticScore > 0.7) {
      reasons.push('High semantic similarity with previous query');
    } else if (scores.semanticScore > 0.4) {
      reasons.push('Moderate semantic similarity');
    }

    if (scores.entityScore > 0.8) {
      reasons.push('Entity substitution detected');
    }

    if (scores.workflowScore > 0.7) {
      reasons.push('Workflow continuation detected');
    }

    if (scores.memoryScore > 0.6) {
      reasons.push('Working memory context match');
    }

    if (reasons.length === 0) {
      reasons.push('No strong continuation signals detected');
    }

    return reasons;
  }

  /**
   * Build action recommendation
   */
  private buildRecommendation(
    confidence: number,
    continuationType: string,
    context?: {
      previousIntent?: string;
      detectedEntity?: string;
      workflowType?: string;
    }
  ): AggregatedResult['recommendation'] {
    if (confidence >= this.config.continuationThreshold) {
      // High confidence → execute
      let targetAction: 'execute' | 'clarify' = 'execute';
      let targetSkill: string | undefined;
      let targetTool: string | undefined;

      // Determine target based on type
      if (continuationType === 'export') {
        targetSkill = context?.detectedEntity === 'pdf' ? 'pdf_generator' : 'xls_generator';
      } else if (continuationType === 'refine') {
        targetTool = context?.previousIntent;
      } else if (continuationType === 'workflow') {
        targetSkill = this.inferWorkflowSkill(context?.workflowType);
      }

      return {
        action: targetAction,
        targetSkill,
        targetTool
      };
    } else if (confidence >= this.config.clarifyThreshold) {
      // Medium confidence → clarify
      return {
        action: 'clarify'
      };
    } else {
      // Low confidence → chat
      return {
        action: 'chat'
      };
    }
  }

  /**
   * Infer skill from workflow type
   */
  private inferWorkflowSkill(workflowType?: string): string | undefined {
    if (!workflowType) {
      return undefined;
    }

    const workflowSkills: Record<string, string> = {
      'analyze': 'data_analyzer',
      'report': 'report_generator',
      'export': 'xls_generator',
      'email': 'email_sender',
    };

    return workflowSkills[workflowType] || undefined;
  }

  /**
   * Update weights (for tuning)
   */
  updateWeights(newWeights: Partial<typeof this.DEFAULT_WEIGHTS>): void {
    this.weights = { ...this.weights, ...newWeights };

    // Normalize weights to sum to 1.0
    const sum = Object.values(this.weights).reduce((a: number, b: number) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      appLogger.warn('[ConfidenceAggregator] Weights do not sum to 1.0', {
        weights: this.weights,
        sum
      });
    }

    appLogger.info('[ConfidenceAggregator] Weights updated', { weights: this.weights });
  }

  /**
   * Update thresholds (for tuning)
   */
  updateThresholds(thresholds: Partial<AggregatorConfig>): void {
    this.config = { ...this.config, ...thresholds };
    appLogger.info('[ConfidenceAggregator] Thresholds updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): { weights: Record<string, number>; config: AggregatorConfig } {
    return {
      weights: this.weights as Record<string, number>,
      config: this.config
    };
  }

  /**
   * Reset to default weights and thresholds
   */
  reset(): void {
    this.weights = { ...this.DEFAULT_WEIGHTS };
    this.config = { ...this.DEFAULT_CONFIG };
    appLogger.info('[ConfidenceAggregator] Reset to defaults');
  }
}

// Singleton instance
export const confidenceAggregator = new ConfidenceAggregator();
