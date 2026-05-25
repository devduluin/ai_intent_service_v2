// ============================================================
// Pipeline Core - Main Orchestrator
// ============================================================

import { intentRegistry } from '../intent-registry.service';
import { queryRewriteService } from '../query-rewrite.service';
import { confidenceDecisionService } from '../confidence-decision.service';
import { vectorService } from '../vector.service';
import { withTimeout } from '../../utils/async-helpers.util';
import { appLogger } from '../../utils/logger.util';
import { config } from '../../config';

import { PlanValidator } from './validators/plan.validator';
import { TemporalInjector, EntityInjector } from './injectors';
import type { TemporalDetailWithDates } from './injectors/temporal.injector';

import {
  PreProcessingStage,
  EmbeddingStage,
  IntentMatchingStage,
  PlannerStage,
  ExecutionStage,
  NaturalizationStage
} from './stages';

import type { Agent } from '../../types/agent.types';
import type { EpisodicMemory } from '../../types/episodic-memory.types';
import type { WorkingMemoryData } from '../workingMemory.service';
import type {
  PipelineInput,
  PipelineResult,
  Intent,
  IntentMatch,
  ToolMissingParams,
  ToolParam
} from '../../types';
import type { PlannerOutput } from '../../types/planner.types';
import type { UserMessageSignals } from '../query-decomposition.service';

// ============================================================
// Types
// ============================================================

export interface PipelineCoreConfig {
  allowCrossIntent: boolean;
  maxIntentsPerQuery: number;
  defaultTimeout: number;
  plannerTimeout: number;
}

export interface PipelineExecutionContext {
  agent: Agent;
  workingMemory: WorkingMemoryData | null;
  episodicMemory: EpisodicMemory | null;
  startTotal: number;
}

export interface PipelineBranchResult {
  matches: IntentMatch[];
  source: 'multi_intent' | 'single_intent' | 'memory_fallback';
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_CONFIG: PipelineCoreConfig = {
  allowCrossIntent: true,
  maxIntentsPerQuery: 3,
  defaultTimeout: 15000,
  plannerTimeout: 20000
};

// ============================================================
// Pipeline Core Class
// ============================================================

/**
 * PipelineCore - Main orchestrator for the AI intent pipeline
 * 
 * Coordinates all pipeline stages:
 * 1. Pre-processing (query decomposition)
 * 2. Embedding & Intent Matching
 * 3. Planning
 * 4. Confidence Decision
 * 5. Execution
 * 6. Naturalization
 */
export class PipelineCore {
  private config: PipelineCoreConfig;
  
  // Stages
  private preProcessingStage: PreProcessingStage;
  private embeddingStage: EmbeddingStage;
  private intentMatchingStage: IntentMatchingStage;
  private plannerStage: PlannerStage;
  private executionStage: ExecutionStage;
  private naturalizationStage: NaturalizationStage;
  
  // Validators & Injectors
  private planValidator: PlanValidator;
  private temporalInjector: TemporalInjector;
  private entityInjector: EntityInjector;

  constructor(config?: Partial<PipelineCoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize stages
    this.preProcessingStage = new PreProcessingStage();
    this.embeddingStage = new EmbeddingStage();
    this.intentMatchingStage = new IntentMatchingStage();
    this.plannerStage = new PlannerStage();
    this.executionStage = new ExecutionStage();
    this.naturalizationStage = new NaturalizationStage();
    
    // Initialize validators & injectors
    this.planValidator = new PlanValidator();
    this.temporalInjector = new TemporalInjector();
    this.entityInjector = new EntityInjector();
    
    appLogger.info('[PipelineCore] Initialized', {
      config: this.config
    });
  }

  // ============================================================
  // MAIN PIPELINE ENTRY POINT
  // ============================================================

  /**
   * Execute the main pipeline flow
   *
   * @param input - Pipeline input with user query
   * @param context - Execution context with agent, memory, etc.
   * @returns Pipeline result with natural language response
   * @throws Error if agent context is invalid
   */
  async execute(
    input: PipelineInput,
    context: PipelineExecutionContext
  ): Promise<PipelineResult> {
    // C-001: Agent Context Validation
    if (!context) {
      const error = new Error('[PipelineCore] Execution context is null or undefined');
      appLogger.error('Pipeline execution failed: null context', {
        userId: input?.user_id,
        appName: input?.app_name
      });
      throw error;
    }

    const { agent, workingMemory, episodicMemory, startTotal } = context;

    // Validate agent exists
    if (!agent) {
      const error = new Error('[PipelineCore] Agent is null or undefined');
      appLogger.error('Pipeline execution failed: null agent', {
        userId: input.user_id,
        appName: input.app_name
      });
      throw error;
    }

    // Validate agent has valid id
    if (!agent.id) {
      const error = new Error('[PipelineCore] Agent ID is missing');
      appLogger.error('Pipeline execution failed: missing agent.id', {
        userId: input.user_id,
        appName: input.app_name,
        agentName: agent.name,
        agentSlug: agent.slug
      });
      throw error;
    }

    // C-009: Variables for memory cleanup in finally block
    let decompositionResult: any = null;
    let branchResult: any = null;
    let finalVectorHints: IntentMatch[] = [];
    let plannerOutput: PlannerOutput | null = null;
    let safePlan: PlannerOutput | null = null;
    let safeParams: Record<string, unknown> = {};
    let executionResult: any = null;

    try {
      // ============================================================
      // STAGE 0: GET INTENTS
      // ============================================================
      const intents = intentRegistry.getAll({
        agentId: agent?.id
      });

      // ============================================================
      // STAGE 1: QUERY REWRITE (with memory context) - C-006 Timeout
      // ============================================================
      const enrichedUserQuery = await withTimeout(
        this.rewriteQuery(agent, episodicMemory, input),
        this.config.defaultTimeout,
        'rewriteQuery'
      );

      const orchestrationInput: PipelineInput = {
        ...input,
        text: enrichedUserQuery
      };

      // ============================================================
      // STAGE 2: PRE-PROCESSING (query decomposition) - C-006 Timeout
      // ============================================================
      decompositionResult = await withTimeout(
        this.preProcessingStage.execute(enrichedUserQuery),
        this.config.defaultTimeout,
        'preProcessingStage.execute'
      );

      const { text: preprocessedText, hasMultipleIntents, signals } = decompositionResult;

      appLogger.debug('[PipelineCore] Query decomposition completed', {
        originalText: input.text,
        preprocessedText,
        hasMultipleIntents,
        signals
      });

      // ============================================================
      // STAGE 3: EMBEDDING & INTENT MATCHING (branching logic) - C-006 Timeout
      // ============================================================
      branchResult = await withTimeout(
        this.executeMatchingBranch(
          hasMultipleIntents,
          decompositionResult,
          intents,
          agent,
          orchestrationInput,
          workingMemory
        ),
        this.config.defaultTimeout,
        'executeMatchingBranch'
      );

      finalVectorHints = branchResult.matches;

      appLogger.debug('[PipelineCore] Intent matching completed', {
        matchCount: finalVectorHints.length,
        topScore: finalVectorHints[0]?.score ?? 0,
        source: branchResult.source
      });

      // ============================================================
      // STAGE 4: PLANNING - C-006 Timeout
      // ============================================================
      plannerOutput = await withTimeout(
        this.plannerStage.execute(
          finalVectorHints,
          orchestrationInput,
          agent
        ),
        this.config.plannerTimeout,
        'plannerStage.execute'
      );

      safePlan = {
        mode: plannerOutput.mode || 'single_step',
        tasks: plannerOutput.tasks || [],
        chat: plannerOutput.chat === true
      };

      // ============================================================
      // STAGE 5: CONFIDENCE DECISION
      // ============================================================
      const decision = confidenceDecisionService.evaluate({
        plan: plannerOutput,
        userText: enrichedUserQuery,
        signals: this.normalizeSignals(signals)
      });

      // C-009 FIX: Log resource breakdown and recommendation for planner feedback
      appLogger.debug('[PipelineCore] Confidence decision', {
        action: decision.action,
        confidence: decision.confidence,
        resourceBreakdown: decision.resourceBreakdown,
        recommendedResource: decision.recommendedResource,
        planTaskCount: safePlan.tasks?.length || 0
      });

      // Log if recommended resource differs from plan for debugging
      if (decision.recommendedResource) {
        const planHasTools = safePlan.tasks?.some(t => t.resource === 'tool')
        const planHasHandlers = safePlan.tasks?.some(t => t.resource === 'handler')
        const planHasKnowledge = safePlan.tasks?.some(t => t.resource === 'knowledge')

        const planResourceType = planHasTools ? 'tool' : planHasHandlers ? 'handler' : planHasKnowledge ? 'knowledge' : 'none'

        if (decision.recommendedResource !== planResourceType && decision.confidence >= 0.70) {
          appLogger.warn('[PipelineCore] Resource mismatch detected - Planner may need adjustment', {
            userId: input.user_id,
            appName: input.app_name,
            planResourceType,
            recommendedResource: decision.recommendedResource,
            confidence: decision.confidence,
            resourceBreakdown: decision.resourceBreakdown
          })
        }
      }

      // ============================================================
      // STAGE 6: VALIDATE PLAN & DECISION (C-005: Type Validation)
      // ============================================================
      
      // C-005: Validate shouldFallbackToChat is boolean
      const shouldFallbackToChat = this.planValidator.shouldFallbackToChat(safePlan, decision);
      
      if (typeof shouldFallbackToChat !== 'boolean') {
        const error = new Error('[PipelineCore] shouldFallbackToChat returned non-boolean value');
        appLogger.error('Pipeline validation failed: invalid fallback decision', {
          userId: input.user_id,
          appName: input.app_name,
          fallbackType: typeof shouldFallbackToChat,
          fallbackValue: shouldFallbackToChat
        });
        throw error;
      }

      if (shouldFallbackToChat) {
        appLogger.info('[PipelineCore] Fallback to chat decision', {
          userId: input.user_id,
          appName: input.app_name
        });
        return {
          intent: 'general_chat',
          score: decision.confidence,
          apiResult: null,
          naturalResponse: '',
          metadata: {
            durationMs: Date.now() - startTotal,
            fallbackToChat: 1
          }
        };
      }

      // ============================================================
      // STAGE 7: PARAM EXTRACTION & INJECTION
      // ============================================================
      // C-009: Assign to declared variable for memory cleanup
      safeParams = await this.extractAndInjectParams(
        enrichedUserQuery,
        safePlan,
        input,
        signals
      );

      // Check for missing params (slot filling trigger)
      const missingParamsResult = await this.checkMissingParams(input, agent, safePlan, safeParams);
      if (missingParamsResult.hasMissing) {
        // Get intent slugs for slot filling context
        const intentSlugsForSlotFilling = finalVectorHints
          .filter(match => match.intent.tools && match.intent.tools.length > 0)
          .map(match => match.intent.slug);

        return {
          intent: 'slot_filling',
          score: 1,
          apiResult: null,
          naturalResponse: missingParamsResult.question || '',
          metadata: {
            durationMs: Date.now() - startTotal,
            missingParams: missingParamsResult.missingParams as any,
            collectedParams: safeParams as any,
            intentSlugs: intentSlugsForSlotFilling,
            // C-009 FIX: Include the actual plan with tasks for execution after slot filling
            originalPlan: safePlan
          } as any
        };
      }

      // ============================================================
      // STAGE 8: EXECUTION - C-006 Timeout
      // ============================================================
      executionResult = await withTimeout(
        this.executionStage.execute(
          safePlan,
          orchestrationInput,
          safeParams,
          {
            cacheResults: true,
            userId: input.user_id,
            appName: input.app_name
          }
        ),
        this.config.defaultTimeout,
        'executionStage.execute'
      );

      const apiResults = executionResult.results;

      // ============================================================
      // STAGE 9: NATURALIZATION - C-006 Timeout
      // ============================================================
      const naturalResponse = await withTimeout(
        this.naturalizationStage.execute(
          apiResults,
          { ...input, text: enrichedUserQuery },
          agent
        ),
        this.config.defaultTimeout,
        'naturalizationStage.execute'
      );

      // ============================================================
      // BUILD RESULT
      // ============================================================
      const intentLabel = finalVectorHints[0]?.intent.slug || 'unknown';
      const intentScore = finalVectorHints[0]?.score ?? 0;

      // Log if intent is unknown for debugging
      if (intentLabel === 'unknown' || intentScore === 0) {
        appLogger.warn('[PipelineCore] Unknown or zero-confidence intent', {
          userId: input.user_id,
          appName: input.app_name,
          query: input.text,
          matchCount: finalVectorHints.length,
          topScore: intentScore,
          source: branchResult.source
        });
      }

      return {
        intent: intentLabel,
        score: intentScore,
        apiResult: apiResults,
        naturalResponse,
        metadata: {
          durationMs: Date.now() - startTotal,
          executedTasks: executionResult.metrics.executedTasks,
          totalTasks: executionResult.metrics.totalTasks
        }
      };

    } catch (error) {
      appLogger.error('[PipelineCore] Execution failed', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        userId: input.user_id,
        appName: input.app_name
      });

      throw error;

    } finally {
      // ============================================================
      // C-009: MEMORY CLEANUP
      // ============================================================
      // Cleanup large objects to prevent memory leaks
      decompositionResult = null;
      branchResult = null;
      finalVectorHints = [];
      plannerOutput = null;
      safePlan = null;
      safeParams = {};
      executionResult = null;

      // Force garbage collection if available
      // Note: This requires Node.js to be run with --expose-gc flag
      if (global.gc) {
        global.gc();
      }

      appLogger.debug('[PipelineCore] Memory cleanup completed');
    }
  }

  // ============================================================
  // STAGE 1: Query Rewrite
  // ============================================================

  private async rewriteQuery(
    agent: Agent,
    episodicMemory: EpisodicMemory | null,
    input: PipelineInput
  ): Promise<string> {
    const rewrittenQuery = await queryRewriteService.rewriteWithMemory(
      agent,
      episodicMemory?.summary || null,
      input
    );

    appLogger.debug('[PipelineCore] Query rewritten', {
      originalLength: input.text.length,
      enrichedQuery: rewrittenQuery
    });

    return rewrittenQuery;
  }

  // ============================================================
  // STAGE 3: Matching Branch Logic
  // ============================================================

  private async executeMatchingBranch(
    hasMultipleIntents: boolean,
    decompositionResult: {
      text: string;
      hasMultipleIntents: boolean;
      subQueries: string[];
      connectors: string[];
      signals: UserMessageSignals;
    },
    intents: Intent[],
    agent: Agent,
    input: PipelineInput,
    workingMemory: WorkingMemoryData | null
  ): Promise<PipelineBranchResult> {
    const { text: preprocessedText, subQueries, signals } = decompositionResult;

    // BRANCH 1: Multi-intent mode
    if (hasMultipleIntents && this.config.allowCrossIntent && subQueries.length > 0) {
      appLogger.info('[PipelineCore] Multi-intent mode: Processing sub-queries', {
        subQueriesCount: subQueries.length
      });

      const allMatches = await this.processMultiIntentQueries(
        subQueries,
        intents,
        agent
      );

      const boostedMatches = this.applySignalBoost(allMatches, signals);

      return {
        matches: boostedMatches,
        source: 'multi_intent'
      };
    }

    // BRANCH 2: Single intent mode
    appLogger.debug('[PipelineCore] Single-intent mode: Using vector matching');

    const queryForMatching = preprocessedText !== input.text && preprocessedText.length > 0
      ? preprocessedText
      : input.text;

    try {
      // Generate embedding
      const queryEmbedding = await this.embeddingStage.execute(
        queryForMatching,
        { agentId: agent.id }
      );

      // Vector matching
      const matches = await this.intentMatchingStage.execute(
        queryEmbedding,
        intents,
        agent,
        { signals }
      );

      // C-002: Error Recovery - Memory fallback with proper error handling
      if (!matches || matches.length === 0) {
        appLogger.warn('[PipelineCore] No intent matches found, attempting memory fallback', {
          userId: input.user_id,
          appName: input.app_name,
          hasWorkingMemory: !!workingMemory
        });

        if (workingMemory?.activeIntent) {
          try {
            const memoryMatches = await vectorService.getIntentBySlug(
              intents,
              workingMemory.activeIntent
            );
            if (memoryMatches && memoryMatches.length > 0) {
              appLogger.info('[PipelineCore] Memory fallback successful', {
                matchCount: memoryMatches.length
              });
              return {
                matches: memoryMatches,
                source: 'memory_fallback'
              };
            }
          } catch (memoryError) {
            appLogger.error('[PipelineCore] Memory fallback failed', {
              error: memoryError instanceof Error ? memoryError.message : 'Unknown error'
            });
            // Continue to throw error for no matches
          }
        }

        // No matches and no fallback - throw error
        const error = new Error('[PipelineCore] No intent matches found and no memory fallback available');
        appLogger.error('Pipeline matching failed: no matches', {
          userId: input.user_id,
          appName: input.app_name,
          queryLength: queryForMatching.length
        });
        throw error;
      }

      // Apply limit if cross-intent disabled
      let finalMatches = matches;
      if (!this.config.allowCrossIntent) {
        finalMatches = matches.slice(0, 3);
      }

      return {
        matches: finalMatches,
        source: 'single_intent'
      };

    } catch (error) {
      // Re-throw with context
      if (error instanceof Error && error.message.includes('No intent matches')) {
        throw error;
      }
      appLogger.error('[PipelineCore] Vector matching failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: input.user_id,
        appName: input.app_name
      });
      throw error;
    }
  }

  // ============================================================
  // Multi-Intent Processing (C-004: Concurrent Processing)
  // ============================================================

  // C-004: Concurrency limit for batch processing
  private readonly MAX_CONCURRENT_QUERIES = 5;

  private async processMultiIntentQueries(
    subQueries: string[],
    intents: Intent[],
    agent: Agent
  ): Promise<IntentMatch[]> {
    const allMatches: IntentMatch[] = [];
    const processedIntents = new Set<string>();
    const startTime = Date.now();

    // C-004: Process queries concurrently with limit
    const batchSize = this.MAX_CONCURRENT_QUERIES;
    
    for (let i = 0; i < subQueries.length; i += batchSize) {
      const batch = subQueries.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      appLogger.debug('[PipelineCore] Processing batch of sub-queries', {
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        totalBatches: Math.ceil(subQueries.length / batchSize)
      });

      // Process batch concurrently with Promise.allSettled
      const batchPromises = batch.map(async (query) => {
        try {
          const embedding = await this.embeddingStage.execute(
            query,
            { agentId: agent.id }
          );

          const matches = await this.intentMatchingStage.execute(
            embedding,
            intents,
            agent,
            { topK: 3 }
          );

          return { query, matches, success: true };
        } catch (error) {
          appLogger.warn('[PipelineCore] Sub-query processing failed', {
            query,
            error: error instanceof Error ? error.message : error
          });
          return { query, matches: [] as IntentMatch[], success: false, error };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { matches } = result.value;
          for (const match of matches) {
            const intentId = match.intent.id;
            if (!processedIntents.has(intentId)) {
              processedIntents.add(intentId);
              allMatches.push(match);
            }
          }

          // Stop if we have enough intents
          if (allMatches.length >= this.config.maxIntentsPerQuery) {
            break;
          }
        }
      }

      // Log batch performance
      const batchDuration = Date.now() - batchStartTime;
      appLogger.debug('[PipelineCore] Batch completed', {
        batchIndex: Math.floor(i / batchSize) + 1,
        durationMs: batchDuration,
        matchesFound: allMatches.length
      });

      // Stop if we have enough intents
      if (allMatches.length >= this.config.maxIntentsPerQuery) {
        break;
      }
    }

    // Sort by score
    allMatches.sort((a, b) => b.score - a.score);

    const totalDuration = Date.now() - startTime;
    appLogger.info('[PipelineCore] Multi-intent processing completed', {
      subQueriesCount: subQueries.length,
      totalMatches: allMatches.length,
      returnedMatches: Math.min(allMatches.length, this.config.maxIntentsPerQuery),
      durationMs: totalDuration,
      avgTimePerQuery: totalDuration / subQueries.length
    });

    return allMatches.slice(0, this.config.maxIntentsPerQuery);
  }

  // ============================================================
  // Signal Boost (C-007: Validation, C-010: Factor Capping)
  // ============================================================

  // C-010: Boost factor constants
  private readonly BOOST_MULTIPLIER = 1.15;
  private readonly MAX_BOOST_FACTOR = 1.5;
  private readonly MAX_SCORE = 1.0;
  private readonly MIN_SCORE = 0.0;

  private applySignalBoost(
    matches: IntentMatch[],
    signals: UserMessageSignals
  ): IntentMatch[] {
    // C-007: Validate input matches
    if (!matches || !Array.isArray(matches)) {
      appLogger.warn('[PipelineCore] applySignalBoost: invalid matches input');
      return [];
    }

    const actionHints = signals.actionHints || [];
    const formatHints = signals.formatHints || [];

    return matches.map(match => {
      // C-007: Validate match structure
      if (!match || !match.intent || typeof match.intent.slug !== 'string') {
        appLogger.warn('[PipelineCore] Signal boost: skipping invalid match');
        return match;
      }

      let boostFactor = 1.0;
      const appliedBoosts: string[] = [];
      let cumulativeBoost = 0;

      const intentSlug = match.intent.slug.toLowerCase();

      // Format-based boosts
      if (formatHints.length > 0 && (formatHints.includes('xlsx') || formatHints.includes('csv'))) {
        if (intentSlug.includes('xls') || intentSlug.includes('excel') || intentSlug.includes('export')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push(`format:${formatHints.join(',')}`);
        }
      }

      // File-related boosts
      if (signals.asksForFile) {
        if (intentSlug.includes('xls') || intentSlug.includes('export') || intentSlug.includes('download')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push('asksForFile');
        }
      }

      // Action-based boosts
      if (actionHints.includes('buat') || actionHints.includes('generate')) {
        if (intentSlug.includes('xls') || intentSlug.includes('generator') || intentSlug.includes('export')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push('action:generate');
        }
      }

      // C-010: Cap cumulative boost factor
      const cappedBoostFactor = Math.min(1 + cumulativeBoost, this.MAX_BOOST_FACTOR);
      boostFactor = cappedBoostFactor;

      // Calculate boosted score with clamping
      const boostedScore = match.score * boostFactor;
      
      // C-010: Clamp score to valid range [MIN_SCORE, MAX_SCORE]
      const finalScore = Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, boostedScore));

      if (appliedBoosts.length > 0) {
        appLogger.debug('[PipelineCore] Signal boost applied', {
          intentSlug,
          originalScore: match.score,
          boostFactor: cappedBoostFactor,
          cumulativeBoost,
          finalScore,
          appliedBoosts
        });
      }

      return {
        ...match,
        score: finalScore
      };
    });
  }

  // ============================================================
  // Param Extraction & Injection
  // ============================================================

  private async extractAndInjectParams(
    enrichedUserQuery: string,
    safePlan: PlannerOutput,
    input: PipelineInput,
    signals: UserMessageSignals
  ): Promise<Record<string, unknown>> {
    let safeParams: Record<string, unknown> = {};

    // C-003: Type-Safe Param Injection - Validate input structure
    if (!input) {
      appLogger.error('[PipelineCore] Input is null/undefined in extractAndInjectParams');
      return safeParams;
    }

    // Inject temporal details with type validation
    const temporalDetails = signals.temporalDetails || [];
    if (temporalDetails.length > 0) {
      try {
        // Validate and initialize attributes
        if (!input.attributes) {
          input.attributes = {};
        }
        if (!input.attributes.params) {
          input.attributes.params = {} as Record<string, unknown>;
        }

        // Type-safe cast with validation
        const paramsObj = input.attributes.params as Record<string, unknown>;
        
        // Validate temporal details before injection
        const validTemporalDetails = temporalDetails.filter(t => t && t.type && t.normalizedValue);
        if (validTemporalDetails.length > 0) {
          this.temporalInjector.inject(paramsObj, validTemporalDetails as TemporalDetailWithDates[]);
        }
      } catch (injectionError) {
        appLogger.error('[PipelineCore] Temporal injection failed', {
          error: injectionError instanceof Error ? injectionError.message : 'Unknown error',
          temporalDetailsCount: temporalDetails.length
        });
        // Continue without temporal injection
      }
    }

    // Inject entity hints with validation
    try {
      const entityHints = (signals as any).entityHints || [];
      if (entityHints.length > 0 && Array.isArray(entityHints)) {
        this.entityInjector.inject(input, entityHints);
      }
    } catch (entityError) {
      appLogger.error('[PipelineCore] Entity injection failed', {
        error: entityError instanceof Error ? entityError.message : 'Unknown error'
      });
      // Continue without entity injection
    }

    // Extract params for tools
    const toolTasks = safePlan.tasks.filter(t => t.resource === 'tool');
    if (toolTasks.length > 0) {
      const toolSlugs = toolTasks.map(t => t.key);

      try {
        // Use paramExtractorService with proper tool params
        const { paramExtractorService } = await import('../paramExtractor.service');
        const { paramHydratorService } = await import('../param-hydrator.service');
        const { toolService } = await import('../tools.service');

        // Get tool definitions to know what params to extract
        const allTools = await toolService.getToolsBySlugs(toolSlugs);
        
        // Validate tools were found
        if (!allTools || allTools.length === 0) {
          appLogger.warn('[PipelineCore] No tools found for extraction', {
            toolSlugs
          });
          return safeParams;
        }

        const allParams: ToolParam[] = [];
        for (const tool of allTools) {
          const toolParams = toolService.getToolParams(tool);
          allParams.push(...toolParams);
        }

        // Validate params before extraction
        if (!allParams || allParams.length === 0) {
          appLogger.warn('[PipelineCore] No parameters found for tools', {
            toolSlugs
          });
          return safeParams;
        }

        // Extract params with knowledge of what params are needed
        const extractionResult = await paramExtractorService.extractAll(
          enrichedUserQuery,
          allParams
        );

        // Validate extraction result
        if (extractionResult && extractionResult.params) {
          safeParams = paramHydratorService.hydrate(
            extractionResult.params,
            input.attributes ?? {}
          );
        }
      } catch (extractionError) {
        appLogger.error('[PipelineCore] Param extraction failed', {
          error: extractionError instanceof Error ? extractionError.message : 'Unknown error',
          toolSlugs
        });
        // Return empty params on error
        return {};
      }
    }

    return safeParams;
  }

  // ============================================================
  // Missing Params Check
  // ============================================================

  private async checkMissingParams(
    input: PipelineInput,
    agent: Agent,
    safePlan: PlannerOutput,
    safeParams: Record<string, unknown>
  ): Promise<{
    hasMissing: boolean;
    missingParams?: ToolMissingParams[];
    question?: string;
  }> {
    const toolTasks = safePlan.tasks.filter(t => t.resource === 'tool');
    if (toolTasks.length === 0) {
      return { hasMissing: false };
    }

    const toolSlugs = toolTasks.map(t => t.key);
    const { toolService } = await import('../tools.service');
    const { clarificationService } = await import('../clarification.service');

    const allTools = await toolService.getToolsBySlugs(toolSlugs);
    const missingToolsParams = await toolService.getMissingParamsForTools(
      allTools,
      safeParams
    );

    if (missingToolsParams.length === 0) {
      return { hasMissing: false };
    }

    // Generate clarification question
    const question = await clarificationService.askForMultipleParametersFromTools(
      agent,
      input,
      missingToolsParams,
      'Indonesia'
    );

    return {
      hasMissing: true,
      missingParams: missingToolsParams,
      question
    };
  }

  // ============================================================
  // Utilities
  // ============================================================

  private normalizeSignals(signals: UserMessageSignals): {
    actionHints: string[];
    formatHints: string[];
    temporalHints: string[];
    temporalDetails: any[];
    entityHints: string[];
    asksForFile: boolean;
    asksForRealtimeData: boolean;
    isQuestion: boolean;
    language: 'id' | 'en' | 'unknown';
  } {
    return {
      actionHints: signals.actionHints || [],
      formatHints: signals.formatHints || [],
      temporalHints: signals.temporalHints || [],
      temporalDetails: signals.temporalDetails || [],
      entityHints: (signals as any).entityHints || [],
      asksForFile: signals.asksForFile,
      asksForRealtimeData: signals.asksForRealtimeData,
      isQuestion: (signals as any).isQuestion || false,
      language: signals.language || 'id'
    };
  }
}
