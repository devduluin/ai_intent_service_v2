// ============================================================
// ContinuationAnalyzer - Main orchestrator for continuation detection
// ============================================================
// Combines all analyzers and aggregators for comprehensive detection
// ============================================================

import { entityAnalyzer } from './analyzers/entity-analyzer';
import { contextAnalyzer } from './analyzers/context-analyzer';
import { workflowAnalyzer } from './analyzers/workflow-analyzer';
import { semanticAnalyzer } from './analyzers/semantic-analyzer';
import { confidenceAggregator } from './aggregators/confidence-aggregator';
import { querySnapshotManager } from './memory/query-snapshot';
import { WorkingMemoryData } from '../../../types/working-memory.type';
import { appLogger } from '../../../utils/logger.util';
import { intentKeywordResolver } from './intentKeyword.resolver';
import { toolParamConfigService } from '../../tool-param-config.service';
import type { ContinuationScores, AggregatedResult } from './aggregators/confidence-aggregator';
import type { EntityAnalysisResult } from './analyzers/entity-analyzer';
import type { ContextAnalysisResult } from './analyzers/context-analyzer';
import type { WorkflowAnalysisResult } from './analyzers/workflow-analyzer';
import type { SemanticAnalysisResult } from './analyzers/semantic-analyzer';
import type { ToolParam } from '../../../types';

// ============================================================
// Types
// ============================================================

export interface ContinuationAnalysisInput {
  userId: string;
  appName: string;
  userInput: string;
  workingMemory: WorkingMemoryData | null;
  currentEmbedding?: number[];  // Optional: pass pre-computed embedding
}

export interface ContinuationAnalysisResult {
  // Final result
  isContinuation: boolean;
  finalConfidence: number;
  continuationType: string;
  recommendation: AggregatedResult['recommendation'];

  // Detailed scores
  scores: ContinuationScores;
  reasoning: string[];

  // Component results
  entityResult?: EntityAnalysisResult;
  contextResult?: ContextAnalysisResult;
  workflowResult?: WorkflowAnalysisResult;
  semanticResult?: SemanticAnalysisResult;

  // Context
  hasPreviousContext: boolean;
  previousIntent?: string;
  previousQuery?: string;
}

// ============================================================
// ContinuationAnalyzer
// ============================================================

/**
 * ContinuationAnalyzer - Main orchestrator for continuation detection
 *
 * Combines:
 * - Entity Analyzer (city, date, export format detection)
 * - Context Analyzer (anaphora, elaboration, comparison)
 * - Workflow Analyzer (multi-step workflow tracking)
 * - Semantic Analyzer (embedding similarity)
 * - Confidence Aggregator (weighted scoring)
 *
 * Flow:
 * 1. Analyze entity changes
 * 2. Analyze context references
 * 3. Analyze workflow continuity
 * 4. Compute semantic similarity
 * 5. Aggregate all scores
 * 6. Return final decision with reasoning
 */
export class ContinuationAnalyzer {
  /**
   * Analyze user input for continuation
   */
  async analyze(input: ContinuationAnalysisInput): Promise<ContinuationAnalysisResult> {
    const { userId, appName, userInput, workingMemory } = input;

    appLogger.debug('[ContinuationAnalyzer] Starting analysis', {
      userId,
      appName,
      userInputLength: userInput.length,
      hasWorkingMemory: !!workingMemory
    });

    // Load query snapshots from working memory
    await querySnapshotManager.loadFromWorkingMemory(userId, appName, workingMemory);

    // NEW: Load tool parameters if we have activeTool
    let toolParams: ToolParam[] = []
    if (workingMemory?.activeTool) {
      toolParams = await toolParamConfigService.loadToolParams(workingMemory.activeTool)
      appLogger.debug('[ContinuationAnalyzer] Tool params loaded', {
        toolSlug: workingMemory.activeTool,
        paramCount: toolParams.length
      })
    }

    // 1. Entity Analysis (with config support)
    const entityResult = entityAnalyzer.analyze(
      userInput,
      workingMemory?.activeEntities || {},
      toolParams  // NEW: Pass tool params with config
    );

    // 2. Context Analysis
    const contextResult = contextAnalyzer.analyze(userInput);

    // 3. Workflow Analysis
    const workflowResult = workflowAnalyzer.analyze(userInput, workingMemory);

    // 4. Semantic Analysis (if we have previous context)
    let semanticResult: SemanticAnalysisResult = {
      similarityScore: 0,
      isSimilar: false
    };

    if (workingMemory?.activeIntent) {
      semanticResult = await semanticAnalyzer.analyze(userId, appName, userInput);
    }

    // 5. Topic Similarity Check (C-009 Phase 2.5 Enhancement)
    const topicSimilarity = await this.computeTopicSimilarity(userInput, workingMemory);

    // 6. Aggregate all scores
    let patternScore = this.computePatternScore(contextResult, workflowResult);

    // C-009 Phase 2 FIX: Boost pattern score for analysis keywords when working memory exists
    if (workingMemory && this.containsAnalysisKeywords(userInput)) {
      // Strong boost for analysis requests with working memory
      patternScore = Math.max(patternScore, 0.8);  // Boost to 0.8 for analysis requests (was 0.65)
      appLogger.debug('[ContinuationAnalyzer] Analysis keywords detected, boosting pattern score', {
        userInput,
        patternScore,
        hasWorkingMemory: true
      });
    }
    
    const scores: ContinuationScores = {
      patternScore,
      semanticScore: semanticResult.similarityScore,
      memoryScore: Math.max(
        this.computeMemoryScore(workingMemory),
        topicSimilarity  // Boost memory score with topic similarity
      ),
      workflowScore: workflowResult.workflowScore,
      entityScore: entityResult.entityScore
    };

    // Build context for aggregator
    const context = {
      previousIntent: workingMemory?.activeIntent || undefined,
      detectedEntity: entityResult.detections.find(d => d.type === 'export')?.value,
      workflowType: workflowResult.detection.workflowType
    };

    // Aggregate
    const aggregatedResult = confidenceAggregator.aggregate(scores, context);

    // Get snapshot info
    const snapshotAnalysis = await querySnapshotManager.analyze(userId, appName);

    // Build final result
    const result: ContinuationAnalysisResult = {
      isContinuation: aggregatedResult.isContinuation,
      finalConfidence: aggregatedResult.finalConfidence,
      continuationType: aggregatedResult.continuationType,
      recommendation: aggregatedResult.recommendation,
      scores,
      reasoning: aggregatedResult.reasoning,
      entityResult,
      contextResult,
      workflowResult,
      semanticResult,
      hasPreviousContext: snapshotAnalysis.hasPreviousContext,
      previousIntent: workingMemory?.activeIntent || undefined,
      previousQuery: snapshotAnalysis.previousSnapshot?.originalQuery
    };

    appLogger.info('[ContinuationAnalyzer] Analysis completed', {
      userId,
      appName,
      isContinuation: result.isContinuation,
      finalConfidence: result.finalConfidence,
      continuationType: result.continuationType
    });

    return result;
  }

  /**
   * Compute pattern score from context and workflow results
   */
  private computePatternScore(
    contextResult: ContextAnalysisResult,
    workflowResult: WorkflowAnalysisResult
  ): number {
    let score = 0;

    // Context reference detected
    if (contextResult.detection.hasReference) {
      score = Math.max(score, contextResult.detection.confidence);
    }

    // Workflow continuation detected
    if (workflowResult.detection.hasWorkflow) {
      score = Math.max(score, workflowResult.detection.confidence * 0.9);
    }

    return score;
  }

  /**
   * Check if input contains analysis/summary keywords
   * Used to boost confidence when working memory exists
   */
  private containsAnalysisKeywords(userInput: string): boolean {
    const analysisKeywords = [
      'analisa', 'analyze', 'analisis', 'summary', 'ringkas', 'rangkum',
      'coba', 'cek', 'check', 'lihat', 'proses', 'lanjut'
    ];

    const normalizedInput = userInput.toLowerCase();
    return analysisKeywords.some(keyword => normalizedInput.includes(keyword));
  }

  /**
   * Compute memory score from working memory
   */
  private computeMemoryScore(workingMemory: WorkingMemoryData | null): number {
    if (!workingMemory) {
      return 0;
    }

    let score = 0;

    // Has active intent
    if (workingMemory.activeIntent) {
      score += 0.4;
    }

    // Has active tool/skill
    if (workingMemory.activeTool || workingMemory.activeSkill) {
      score += 0.3;
    }

    // Has continuation hints
    if (workingMemory.continuationHints) {
      const hints = workingMemory.continuationHints;
      if (hints.canExport || hints.canSummarize || hints.canModify) {
        score += 0.3;
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Compute topic similarity score
   * Boosts confidence when user query is about same topic/intent
   *
   * @param userInput - Current user input
   * @param workingMemory - Working memory with previous context
   * @returns Topic similarity score (0-1)
   */
  private async computeTopicSimilarity(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): Promise<number> {
    if (!workingMemory?.activeIntent) {
      return 0;
    }

    const normalizedInput = userInput.toLowerCase().trim();
    const activeIntent = workingMemory.activeIntent.toLowerCase();
    const activeEntities = workingMemory.activeEntities || {};

    let similarityScore = 0;

    // Check 1: Input contains entity from previous context
    // Example: Previous { location: 'jakarta' }, Current: "bandung"
    const entityValues = Object.values(activeEntities).map(v => 
      String(v).toLowerCase()
    );

    for (const entityValue of entityValues) {
      if (entityValue.length > 2 && normalizedInput.includes(entityValue)) {
        similarityScore = Math.max(similarityScore, 0.85);
        break;
      }
    }

    // Check 2: Input is short (1-2 words) and active intent suggests entity type
    // Example: Active intent 'get_weather', Current: "jakarta" → likely weather query
    const wordCount = normalizedInput.split(/\s+/).length;
    if (wordCount <= 2 && entityValues.length > 0) {
      // Short input with entities in context → likely entity substitution
      try {
        const intentKeywords = await this.getIntentKeywords(activeIntent);

        for (const keyword of intentKeywords) {
          if (normalizedInput.includes(keyword)) {
            similarityScore = Math.max(similarityScore, 0.90);
            break;
          }
        }
      } catch (error) {
        appLogger.warn('[ContinuationAnalyzer] Failed to get intent keywords', {
          activeIntent,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Use fallback: extract from slug
        const fallbackKeywords = activeIntent.split('_').filter(w => w.length > 2);
        for (const keyword of fallbackKeywords) {
          if (normalizedInput.includes(keyword)) {
            similarityScore = Math.max(similarityScore, 0.75);
            break;
          }
        }
      }

      // If no keyword match but input is very short, still boost
      if (wordCount === 1 && similarityScore < 0.8) {
        similarityScore = Math.max(similarityScore, 0.75);
      }
    }

    // Check 3: Input contains continuation markers + entity
    // Example: "kalau bandung?", "yang tadi mana?"
    const continuationMarkers = ['kalau', 'yang', 'itu', 'ini', 'lebih'];
    const hasMarker = continuationMarkers.some(marker => 
      normalizedInput.startsWith(marker)
    );

    if (hasMarker && wordCount <= 3) {
      similarityScore = Math.max(similarityScore, 0.80);
    }

    // Log if high similarity detected
    if (similarityScore > 0.75) {
      appLogger.debug('[ContinuationAnalyzer] Topic similarity detected', {
        userInput,
        activeIntent,
        similarityScore,
        entityCount: entityValues.length
      });
    }

    return similarityScore;
  }

  /**
   * Get keywords associated with an intent
   * Phase 3 Refactoring: Use intentKeywordResolver instead of hardcoding
   */
  private async getIntentKeywords(intentSlug: string): Promise<string[]> {
    const result = await intentKeywordResolver.getKeywords(intentSlug);
    
    appLogger.debug('[ContinuationAnalyzer] Intent keywords resolved', {
      intentSlug,
      source: result.source,
      keywordCount: result.keywords.length,
      confidence: result.confidence
    });
    
    return result.keywords;
  }

  /**
   * Store query snapshot after execution
   */
  async storeSnapshot(
    userId: string,
    appName: string,
    snapshot: {
      originalQuery: string;
      intentSlug: string;
      intentEmbedding?: number[];
      confidence: number;
      entities: Record<string, unknown>;
      executionType: 'tool' | 'skill' | 'knowledge' | 'chat';
      toolSlug?: string;
      skillKey?: string;
      resultSummary?: string;
      hasResult: boolean;
    }
  ): Promise<void> {
    await querySnapshotManager.store(userId, appName, {
      ...snapshot,
      timestamp: Date.now()
    });
  }

  /**
   * Clear continuation context for user
   */
  async clearContext(userId: string, appName: string): Promise<void> {
    await querySnapshotManager.clear(userId, appName);
    appLogger.info('[ContinuationAnalyzer] Context cleared', { userId, appName });
  }

  /**
   * Get analyzer statistics
   */
  getStats(): {
    snapshotStats: {
      totalUsers: number;
      totalSnapshots: number;
      avgSnapshotsPerUser: number;
    };
    aggregatorConfig: {
      weights: Record<string, number>;
      thresholds: { continuation: number; clarify: number };
    };
  } {
    const snapshotStats = querySnapshotManager.getStats();
    const aggregatorConfig = confidenceAggregator.getConfig();

    return {
      snapshotStats,
      aggregatorConfig: {
        weights: aggregatorConfig.weights,
        thresholds: {
          continuation: aggregatorConfig.config.continuationThreshold,
          clarify: aggregatorConfig.config.clarifyThreshold
        }
      }
    };
  }

  /**
   * Update analyzer configuration (for tuning)
   */
  updateConfig(config: {
    weights?: Record<string, number>;
    continuationThreshold?: number;
    clarifyThreshold?: number;
    similarityThreshold?: number;
  }): void {
    if (config.weights) {
      confidenceAggregator.updateWeights(config.weights as any);
    }

    if (config.continuationThreshold || config.clarifyThreshold) {
      confidenceAggregator.updateThresholds({
        continuationThreshold: config.continuationThreshold,
        clarifyThreshold: config.clarifyThreshold
      });
    }

    if (config.similarityThreshold) {
      semanticAnalyzer.updateThreshold(config.similarityThreshold);
    }

    appLogger.info('[ContinuationAnalyzer] Config updated', config);
  }
}

// Singleton instance
export const continuationAnalyzer = new ContinuationAnalyzer();
