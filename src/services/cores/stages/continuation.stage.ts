import { ContinuationResolver, type ContinuationResult, type ContinuationIntent } from '../resolvers/continuation.resolver';
import { WorkingMemoryUpdater } from '../memory/working-memory-updater';
import { ExecutionStage } from './execution.stage';
import { NaturalizationStage } from './naturalization.stage';
import { OfferGenerationStage } from './offer-generation.stage';
import { PipelineMetricsService } from '../metrics/pipeline-metrics.service';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { type Agent } from '../../../types/agent.types';
import { type PipelineInput, type PipelineResult } from '../../../types';
import { type PlannerOutput, type PlannerTask } from '../../../types/planner.types';
import { appLogger } from '../../../utils/logger.util';
import { ChatStage } from '../../cores/stages';
import { topicRelevanceService } from '../continuation/topicRelevance.service';
import { toolResultCache } from '../../memories/toolResultCache.service';
import { llmEntityDetectorService } from '../continuation/llm-entity-detector.service';
import { entityAnalyzer } from '../continuation/analyzers/entity-analyzer';
import { queryDecompositionService } from '../../query-decomposition.service';
import { paramResolutionService } from '../../param-resolution.service';
import { ConversationUtil } from '../../../utils/conversation.util';
import { episodicMemoryService } from '../../episodic-memory.service';
import type { WorkingMemoryData } from '../../../types/working-memory.type';
import { toolParamConfigService } from '../../tool-param-config.service';
import type { ToolParam } from '../../../types';
import { clarificationService } from '../../clarification.service';
import { comparisonOrchestratorService } from '../../comparison-orchestrator.service';
import { skillsRegistry } from '../../skills-registry.service';
import { workingMemoryService } from '../../workingMemory.service';

// ============================================================
// Types
// ============================================================

export interface ContinuationStageOptions {
  skipPipelineIfContinuation?: boolean;
}

/**
 * Continuation Execution Context - Loaded ONCE per continuation
 * Prevents duplicate cache I/O calls
 */
export interface ContinuationExecutionContext {
  cachedResult?: unknown;
  cachedParams?: Record<string, unknown>;
  entities?: Record<string, unknown>;
  toolSlug?: string;
  skillSlug?: string; // new
  knowledgeSource?: string; // new
  sessionKey?: string;
}

type CachedToolLookupSource =
  | 'param_cache'
  | 'slug_cache'
  | 'working_memory_last_execution'
  | 'exec_context'
  | 'none';

interface CachedToolLookupResult {
  result?: unknown;
  source: CachedToolLookupSource;
}

interface ContinuationExecutionPlan {
  plan: PlannerOutput;
  primaryToolTask?: PlannerTask;
  targetSkillTask?: PlannerTask;
  addedSkillTask: boolean;
}

export interface ContinuationStageResult {
  shouldSkipPipeline: boolean;
  continuationResult?: ContinuationResult;
  activeIntent?: string;
}

// ============================================================
// Continuation Stage
// ============================================================

/**
 * ContinuationStage - Handles continuation detection and execution
 * 
 * Responsibilities:
 * - Check working memory for previous context
 * - Detect continuation patterns (export, refine, detail, action, clarify, workflow)
 * - Fetch cached data from tool result cache
 * - Validate skills exist
 * - Execute continuation if detected
 */
export class ContinuationStage {
  private resolver: ContinuationResolver;

  private chatStage: ChatStage | null = null;
  private getChatStage(): ChatStage {
    if (!this.chatStage) {
      this.chatStage = new ChatStage();
    }
    return this.chatStage;
  }

  constructor() {
    this.resolver = new ContinuationResolver();
  }

  /**
   * Execute continuation check
   * 
   * @param input - Pipeline input with user query
   * @param workingMemory - Working memory from pipeline context
   * @param options - Stage options
   * @returns ContinuationResult with continuation detection result
   */
  async execute(
    input: PipelineInput,
    workingMemory: WorkingMemoryData | null,
    options?: ContinuationStageOptions
  ): Promise<ContinuationResult> {
    const skipPipeline = options?.skipPipelineIfContinuation ?? true;

    try {
      // Resolve continuation
      const continuationResult = await this.resolver.resolve(
        input.user_id,
        input.app_name,
        input.text,
        workingMemory
      );

      appLogger.debug('[ContinuationStage] Resolution completed', {
        userId: input.user_id,
        appName: input.app_name,
        isContinuation: continuationResult.intent.isContinuation,
        shouldSkipPipeline: continuationResult.shouldSkipPipeline,
        type: continuationResult.intent.type,
        continuationResult
      });

      // If continuation detected and should skip pipeline
      if (skipPipeline && continuationResult.shouldSkipPipeline && continuationResult.intent.isContinuation) {
        return continuationResult;
      }

      // No continuation or continue with full pipeline
      return continuationResult;

    } catch (error) {
      appLogger.error('[ContinuationStage] Execution failed', {
        error: error instanceof Error ? error.message : error,
        userId: input.user_id,
        appName: input.app_name
      });

      // ✅ CORRECT: Throw error to prevent fallback to main pipeline
      throw error;
    }
  }

  /**
   * Execute continuation skill
   *
   * @param input - Pipeline input
   * @param activeIntent - Active intent string
   * @param agent - Agent context
   * @param continuationResult - Continuation result from detection
   * @param startTotal - Start time for metrics
   * @returns PipelineResult with naturalized response
   */
  async executeContinuationSkill(
    input: PipelineInput,
    activeIntent: string,
    agent: Agent,
    continuationResult: ContinuationResult,
    startTotal: number
  ): Promise<PipelineResult> {
    const { intent, context } = continuationResult;

    // ✅ FIX 2 & 3: Remove variable shadowing - use cachedData directly
    let targetKey: string | undefined;
    let resourceType: 'tool' | 'skill' | 'knowledge' = 'tool';
    let execContext: ContinuationExecutionContext | undefined;

    try {
      // ✅ OPTIMIZATION: Load context ONCE (prevents duplicate I/O)
      execContext = await this.loadContinuationContext(
        input.user_id,
        input.app_name,
        context.workingMemory
      );

      // ✅ Use loaded data
      const previousResult = execContext.cachedResult || (context.workingMemory?.metadata?.lastExecution as any)?.results || null;
      const entities = execContext.entities || context.workingMemory?.activeEntities || {};

      // appLogger.info('[ContinuationStage] Cached data fetched', {
      //   userId: input.user_id,
      //   appName: input.app_name,
      //   hasResult: !!execContext.cachedResult,
      //   entities: entities,
      //   intent: intent,
      //   previousResult: previousResult,
      //   continuationResult: continuationResult
      // });

      appLogger.info('[ContinuationStage] Execution context loaded', {
        toolSlug: execContext.toolSlug,
        sessionKey: execContext.sessionKey,
        hasCachedResult: !!execContext.cachedResult,
        cachedParamsCount: Object.keys(execContext.cachedParams || {}).length,
        execContext: execContext
      });

      // ✅ NEW: Check if we have stored plan from previous execution (skip re-planning!)
      if (context.workingMemory?.activePlan) {
        appLogger.info('[ContinuationStage] Reusing stored plan from working memory', {
          taskCount: context.workingMemory.activePlan.tasks?.length || 0,
          planMode: context.workingMemory.activePlan.mode
        });

        if (intent.type === 'comparison') {
          return await this.executeComparisonContinuation(
            context.workingMemory.activePlan,
            input,
            agent,
            continuationResult,
            execContext,
            startTotal,
            activeIntent
          );
        }

        return await this.executeActivePlanContinuation(
          context.workingMemory.activePlan,
          input,
          agent,
          continuationResult,
          execContext,
          startTotal,
          activeIntent
        );
      }

      const hasPreviousResult = !!previousResult && Object.keys(previousResult as any || {}).length > 0;

      // FIX 2: Check if we have cached data for DIRECT EXECUTION
      if (hasPreviousResult && intent.targetSkill) {
        appLogger.info('[ContinuationStage] Has cached data, executing skill directly', {
          targetSkill: intent.targetSkill,
          hasPreviousResult: true,
          resultKeys: Object.keys(previousResult as any || {})
        });

        return await this.executeSkill(
          intent.targetSkill,
          previousResult as Record<string, unknown>,
          input,
          agent,
          startTotal,
          activeIntent,
          {
            intent,
            activePlan: context.workingMemory?.activePlan || undefined
          }
        );
      }

      // NO CACHED DATA - Build execute tool
      if (!hasPreviousResult && (intent.targetSkill || intent.type === 'export' || intent.type === 'detail')) {
        appLogger.info('[ContinuationStage] No cached data, building execute tool', {
          intentType: intent.type,
          targetSkill: intent.targetSkill,
          activeTool: context.workingMemory?.activeTool
        });

        return await this.executeMultiStepGraph(
          context.workingMemory,
          intent,
          input,
          agent,
          startTotal,
          activeIntent
        );
      }

      // 2. Determine resource type from working memory (for refine/entity substitution)
      const activeTool = context.workingMemory?.activeTool;
      const activeSkill = context.workingMemory?.activeSkill;
      const activeIntentType = context.workingMemory?.activeIntent;

      if (activeSkill) {
        resourceType = 'skill';
        targetKey = activeSkill;
      }
      // Priority 2: If we have cached data with toolSlug, it's a tool
      else if (intent.cachedData?.toolSlug) {
        resourceType = 'tool';
        targetKey = intent.cachedData.toolSlug;
      }
      // Priority 3: Check if it's a known skill pattern from intent type
      else if (activeIntentType && (activeIntentType.includes('export') || activeIntentType.includes('generate'))) {
        resourceType = 'skill';
        targetKey = intent.targetSkill || activeIntentType;
      }
      // Priority 4: Default to tool
      else {
        resourceType = 'tool';
        targetKey = activeTool || intent.targetSkill || activeIntentType || undefined;
      }

      // Fallback: Use targetSkill from intent if nothing else worked
      if (intent.targetSkill) {
        targetKey = intent.targetSkill;
        const isSkillType = this.isSkill(targetKey);
        if (isSkillType) {
          resourceType = 'skill';
        }
      }

      // C-009 Phase 3 FIX: Check for entity substitution ONLY for 'refine' type
      // Export continuation handled above, skip entity check
      if (intent.type === 'refine') {
        const entityChange = await this.detectEntityChange(
          input.text,
          execContext.entities || {},  // ✅ Use loaded entities
          context.workingMemory,
          input,
          execContext  // ✅ Pass context (no reload needed)
        );

        if (entityChange.detected && entityChange.changedParams && Object.keys(entityChange.changedParams).length > 0) {
          appLogger.info('[ContinuationStage] Entity changes detected', {
            entityChange: entityChange,
            changedParams: entityChange.changedParams,
            userId: input.user_id,
            appName: input.app_name
          });

          // ✅ REFINEMENT: Normalize changedParams to extract only newValue
          const normalizedChangedParams = Object.fromEntries(
            Object.entries(entityChange.changedParams).map(([key, value]) => [
              key,
              (value as { oldValue: string; newValue: string }).newValue  // ✅ Extract only newValue
            ])
          );

          // ✅ OPTIMIZATION: Use execContext.cachedParams (loaded ONCE, no duplicate I/O)
          const newParams = {
            ...execContext.cachedParams,  // ✅ Base from cache (single source of truth)
            ...normalizedChangedParams  // ✅ Apply normalized changes
          };

          appLogger.debug('[ContinuationStage] Merged params for execution', {
            cachedParamsCount: Object.keys(execContext.cachedParams || {}).length,
            newParams:newParams,
            changedEntitiesCount: Object.keys(entityChange.changedParams).length
          });

          // Re-execute tool with merged params
          const continuationPlan: PlannerOutput = {
            mode: 'single_step',
            chat: false,
            tasks: [{
              id: "1",
              resource: resourceType,
              key: targetKey!,  // targetKey is guaranteed at this point
              depends_on: []
            }]
          };

          // Execute with MERGED params (preserves timezone, date, etc.)
          const executionStage = new ExecutionStage();
          const apiResults = await executionStage.execute(
            continuationPlan,
            input,
            newParams,
            {
              cacheResults: false,
              userId: input.user_id,
              appName: input.app_name
            }
          );

          // Update working memory with new results
          const workingMemoryUpdater = new WorkingMemoryUpdater();
          await workingMemoryUpdater.update(input.user_id, input.app_name, {
            type: 'continuation',
            intent: intent,
            apiResults: apiResults.results,
            activeIntent
          });

          // Naturalize response
          const naturalizationStage = new NaturalizationStage();
          const naturalResponse = await naturalizationStage.execute(
            apiResults.results,
            input,
            agent,
            {
              contextCache: {
                workingMemory: context.workingMemory || undefined,
                continuationType: intent.type,
                entities: newParams,
                originalQuery: input.text
              }
            }
          );

          // ✅ FIX #2: Update episodic memory
          const messages = ConversationUtil.buildMessages(input, {
            memoryContext: naturalResponse
          });

          await episodicMemoryService.summarize(
            agent,
            activeIntent,
            input.user_id,
            input.app_name,
            messages
          );

          appLogger.debug('[ContinuationStage] Episodic memory updated', {
            userId: input.user_id,
            appName: input.app_name,
            intent: activeIntent
          });

          // Record metrics
          const metricsService = new PipelineMetricsService();
          metricsService.recordSuccess(activeIntent, Date.now() - startTotal);

          return PipelineFormatter.buildEarly(
            {
              intent: activeIntent,
              score: intent.confidence,
              message: naturalResponse,
              apiResult: apiResults.results
            },
            startTotal
          );
        }
      }

      // Example: Previous intent 'get_time', current query "menurutmu sehat?" → check relevance
      if (activeIntentType && targetKey) {
        // Check if this is a discussion query (e.g., "menurutmu", "bagaimana pendapatmu")
        const isDiscussionQuery = topicRelevanceService.isDiscussionQuery(input.text);
        
        if (isDiscussionQuery) {
          // Fallback to chat with full context for discussion
          const chatStage = new ChatStage();
          return await chatStage.execute(
            input,
            agent,
            startTotal,
            {
              contextCache: {
                previousToolResults: entities,  // ✅ Use entities instead of cachedEntities
                previousIntent: activeIntent,
                continuationType: intent.type,
                entities: entities,  // ✅ Use entities instead of previousResult
                originalQuery: input.text,
                timestamp: Date.now()
              }
            }
          );
        }
      }

      // 5. Record metrics
      const metricsService = new PipelineMetricsService();
      metricsService.recordSuccess(activeIntent, Date.now() - startTotal);

      // ✅ FIX #1: Fallback to pipeline re-entry (NOT direct ChatStage call)
      // This ensures episodic memory and working memory are updated properly
      appLogger.warn('[ContinuationStage] No cached data and no target, returning to pipeline flow', {
        userId: input.user_id,
        appName: input.app_name
      });

      // Return special result that signals pipeline.service.ts to re-route
      return PipelineFormatter.buildEarly(
        {
          intent: 'continuation_fallback',  // ✅ Special intent for re-routing
          score: 0,
          message: 'Baik, saya akan bantu dengan pertanyaan Anda.'
        },
        startTotal
      );


    } catch (error) {
      // ✅ FIX #1: Fallback to pipeline re-entry on error (NOT direct ChatStage call)
      appLogger.error('[ContinuationStage] Execution failed, returning to pipeline flow', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return special result that signals pipeline.service.ts to re-route
      return PipelineFormatter.buildEarly(
        {
          intent: 'continuation_fallback',  // ✅ Special intent for re-routing
          score: 0,
          message: 'Maaf, terjadi kesalahan saat memproses permintaan Anda. Mencoba lagi...'
        },
        startTotal
      );
    }
  }

  /**
   * Load continuation execution context (SINGLE I/O - prevents duplicate cache loads)
   * ✅ FIX #1: Fallback to workingMemory.activeEntities on cache miss
   */
  private async loadContinuationContext(
    userId: string,
    appName: string,
    workingMemory: WorkingMemoryData | null
  ): Promise<ContinuationExecutionContext> {
    const sessionKey = `${userId}:${appName}`;
    const toolSlug = workingMemory?.activeTool;
    
    let cachedResult: unknown = undefined;
    let cachedParams: Record<string, unknown> = {};
    let entities: Record<string, unknown> = {};
    
    if (toolSlug) {
      const cached = await toolResultCache.get(sessionKey, toolSlug, { skipRedis: false });
      
      if (cached) {
        // ✅ Cache hit - use cached data
        cachedResult = cached.result;
        cachedParams = cached.params || {};
        entities = cached.entities || {};
        
        appLogger.debug('[ContinuationStage] Cache hit', {
          toolSlug,
          source: 'toolResultCache'
        });
      } else {
        // ✅ Cache miss - fallback to workingMemory.activeEntities
        cachedParams = workingMemory?.activeEntities || {};
        entities = workingMemory?.activeEntities || {};
        
      }
    } else {
      // No toolSlug - use workingMemory.activeEntities
      cachedParams = workingMemory?.activeEntities || {};
      entities = workingMemory?.activeEntities || {};
      
    }
    
    return {
      cachedResult,
      cachedParams,
      entities,
      toolSlug,
      sessionKey
    };
  }

  /**
   * Detect entity substitution using cache-first approach
   * Phase 5: Cache-First, LLM-Fallback (N+1 Optimization)
   * ✅ FIX #1: Support MULTI-ENTITY changes
   * ✅ ENHANCEMENT: Use tool parameter config for validation
   * ✅ OPTIMIZATION: Strong config-aware detection before LLM
   */
  private async detectEntityChange(
    query: string,
    prevEntities: Record<string, unknown>,
    workingMemory: WorkingMemoryData | null,
    input: PipelineInput,
    execContext: ContinuationExecutionContext  // ✅ NEW: Use loaded context
  ): Promise<{
    detected: boolean;
    changedParams?: Record<string, {      // ✅ PRIMARY FIELD: Multiple changes
      oldValue: string;
      newValue: string;
    }>;
    confidence: number;
  }> {
    try {
      // ✅ OPTIMIZATION: Use loaded cachedParams (no duplicate I/O)
      const cachedParams = execContext.cachedParams || {};

      appLogger.debug('[ContinuationStage] Using loaded cached params', {
        toolSlug: execContext.toolSlug,
        cachedParamsCount: Object.keys(cachedParams).length
      });

      // ✅ NEW: Load tool parameters with config
      let toolParams: ToolParam[] = []
      if (workingMemory?.activeTool) {
        toolParams = await toolParamConfigService.loadToolParams(workingMemory.activeTool)
      }

      // ✅ Step 1: Query decomposition (pattern-based, FREE - no LLM)
      const decomposition = await queryDecompositionService.decompose(query);
      const signals = decomposition.signals;

      appLogger.debug('[ContinuationStage] Query decomposition', {
        query,
        confidence: decomposition.confidence,
        temporalHints: signals.temporalHints,
        entityHints: signals.entityHints,
        signals: signals
      });

      // ✅ Step 2: Merge signals with cached params
      const updatedParams = { ...cachedParams };

      // Merge temporal details
      for (const detail of signals.temporalDetails || []) {
        if (detail.type === 'day' || detail.type === 'date' || detail.type === 'week' || detail.type === 'month') {
          if (updatedParams.date !== undefined && detail.normalizedValue) {
            const oldDate = updatedParams.date;
            updatedParams.date = detail.normalizedValue;

            appLogger.debug('[ContinuationStage] Temporal detail mapped', {
              temporalType: detail.type,
              temporalValue: detail.value,
              normalizedValue: detail.normalizedValue,
              oldDate,
              newDate: updatedParams.date
            });
          }
        }
      }

      // Merge entity hints
      for (const hint of signals.entityHints || []) {
        const [type, value] = hint.split(':');
        if (type && value && updatedParams[type] !== undefined) {
          const oldValue = updatedParams[type];
          updatedParams[type] = value;

          appLogger.debug('[ContinuationStage] Entity hint mapped', {
            entityType: type,
            entityValue: value,
            oldValue,
            newValue: updatedParams[type]
          });
        }
      }

      // ✅ Step 3: Entity analyzer FIRST (for all params including date)
      let hasConfigAwareDetection = false;
      if (toolParams && toolParams.length > 0) {
        appLogger.debug('[ContinuationStage] Using config-aware entity detection', {
          toolParamsCount: toolParams.length
        });

        // Use entityAnalyzer with tool config for stronger detection
        const entityAnalysisResult = entityAnalyzer.analyze(
          query,
          cachedParams,
          toolParams  // Pass config for validation
        );

        // Apply ALL entity detections (date will be overridden by temporal later)
        for (const detection of entityAnalysisResult.detections) {
          if (detection.isValid !== false && detection.value) {
            const paramName = detection.type === 'city' || detection.type === 'location'
              ? 'location'
              : detection.type;

            // Check if this param exists in tool params
            const matchingParam = toolParams.find(p => p.name === paramName || p.label === detection.value);

            if (matchingParam && updatedParams[paramName] !== undefined) {
              const oldValue = updatedParams[paramName];
              const newValue = detection.normalizedValue || detection.value;

              if (String(oldValue) !== String(newValue)) {
                updatedParams[paramName] = newValue;
                hasConfigAwareDetection = true;

                appLogger.debug('[ContinuationStage] Config-aware entity detected', {
                  paramName,
                  oldValue,
                  newValue,
                  confidence: detection.confidence,
                  isValid: detection.isValid
                });
              }
            }
          }
        }

        if (entityAnalysisResult.detections.length > 0) {
          appLogger.info('[ContinuationStage] Entity analyzer detected changes', {
            detectionCount: entityAnalysisResult.detections.length,
            entityScore: entityAnalysisResult.entityScore,
            hasConfigAwareDetection
          });
        }
      }

      // ✅ Step 4: Apply temporal details LAST (this overrides raw date text - NORMALIZED WINS!)
      for (const detail of signals.temporalDetails || []) {
        if (detail.type === 'day' || detail.type === 'date' || detail.type === 'week' || detail.type === 'month') {
          if (detail.normalizedValue) {
            const oldDate = updatedParams.date;
            updatedParams.date = detail.normalizedValue;  // ✅ ALWAYS wins (applied last)

            appLogger.debug('[ContinuationStage] Temporal detail applied (FINAL - NORMALIZED WINS)', {
              temporalType: detail.type,
              temporalValue: detail.value,
              normalizedValue: detail.normalizedValue,
              oldDate,
              newDate: updatedParams.date
            });
          }
        }
      }

      // ✅ Step 4: Collect ALL changes (pattern + config-aware)
      const changedParams: Record<string, { oldValue: string; newValue: string }> = {};

      for (const [key, newValue] of Object.entries(updatedParams)) {
        const oldValue = cachedParams[key];
        if (oldValue !== undefined && String(newValue) !== String(oldValue)) {
          changedParams[key] = {
            oldValue: String(oldValue),
            newValue: String(newValue)
          };
        }
      }

      // ✅ Return ALL changes if detected (pattern OR config-aware)
      if (Object.keys(changedParams).length > 0) {
        // Boost confidence if config-aware detection was used
        const finalConfidence = hasConfigAwareDetection 
          ? Math.max(decomposition.confidence, 0.85)  // Boost to at least 0.85
          : decomposition.confidence;

        appLogger.info('[ContinuationStage] Entity changes detected', {
          changedParamsCount: Object.keys(changedParams).length,
          changedParams,
          confidence: finalConfidence,
          hasConfigAwareDetection
        });

        return {
          detected: true,
          changedParams,  // ✅ ALL CHANGED PARAMS
          confidence: finalConfidence
        };
      }

      // ✅ Step 5: LLM fallback (only if confidence low AND no config detection)
      if (decomposition.confidence < 0.6 && !hasConfigAwareDetection) {
        appLogger.debug('[ContinuationStage] Low confidence, using LLM fallback', {
          confidence: decomposition.confidence
        });

        const llmDetection = await llmEntityDetectorService.detectEntityChange(
          query,
          { 
            previousEntities: cachedParams,
            toolParams  // ✅ NEW: Pass tool params with config
          }
        );

        if (llmDetection.detected && llmDetection.confidence >= 0.6) {
          appLogger.info('[ContinuationStage] Entity change detected (LLM)', {
            type: llmDetection.type,
            oldValue: llmDetection.oldValue,
            newValue: llmDetection.newValue,
            confidence: llmDetection.confidence
          });

          return {
            detected: true,
            // For LLM, single change for now (can be extended later)
            changedParams: llmDetection.type ? {
              [llmDetection.type]: {
                oldValue: (llmDetection.oldValue as string) || 'unknown',
                newValue: (llmDetection.newValue as string) || ''
              }
            } : undefined,
            confidence: llmDetection.confidence || 0
          };
        }
      }

      appLogger.debug('[ContinuationStage] No entity change detected', {
        query,
        cachedParamsCount: Object.keys(cachedParams).length,
        toolParamsCount: toolParams.length
      });

      return { detected: false, confidence: 0 };

    } catch (error) {
      appLogger.error('[ContinuationStage] Entity detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // ✅ FIX #4: Return empty instead of fallbackDetectEntityChange
      return { detected: false, confidence: 0 };
    }
  }

  /**
   * Execute continuation from the stored task planner.
   *
   * This keeps continuation on the previous dependency graph, while still
   * re-resolving params from attributes, working memory, cache, and normalized
   * temporal details.
   */
  private async executeActivePlanContinuation(
    plan: PlannerOutput,
    input: PipelineInput,
    agent: Agent,
    continuationResult: ContinuationResult,
    execContext: ContinuationExecutionContext,
    startTotal: number,
    activeIntent: string
  ): Promise<PipelineResult> {
    const intent = continuationResult.intent;
    const workingMemory = continuationResult.context.workingMemory;
    const continuationPlan = this.buildContinuationExecutionPlan(plan, intent, workingMemory);
    const activeExecutionPlan = continuationPlan.plan;
    const primaryToolTask = continuationPlan.primaryToolTask;
    const targetSkillTask = continuationPlan.targetSkillTask;

    appLogger.info('[ContinuationStage] Executing active plan continuation', {
      mode: activeExecutionPlan.mode,
      taskCount: activeExecutionPlan.tasks?.length || 0,
      intentType: intent.type,
      toolTask: primaryToolTask?.key,
      skillTask: targetSkillTask?.key,
      hasCachedResult: !!execContext.cachedResult,
      continuationAugmented: (activeExecutionPlan.meta as any)?.continuationAugmented === true,
      addedSkillTask: continuationPlan.addedSkillTask
    });

    const decomposition = queryDecompositionService.decompose(input.text);
    const baseParams: Record<string, unknown> = {
      ...(workingMemory?.activeEntities || {}),
      ...(execContext.cachedParams || {}),
      ...((input.attributes?.params as Record<string, unknown>) || {})
    };
    const resolutionInput: PipelineInput = {
      ...input,
      attributes: {
        ...(input.attributes || {}),
        params: baseParams
      }
    };
    const resolution = await paramResolutionService.resolve(
      resolutionInput,
      activeExecutionPlan,
      decomposition,
      {
        mode: 'continuation',
        allowOptionalSemanticOverwrite: intent.type === 'refine',
        clearStaleOptionalSemanticParams: true
      }
    );
    const resolvedParams: Record<string, unknown> = {
      ...resolution.availableParams
    };
    const executionInput: PipelineInput = {
      ...input,
      attributes: {
        ...(input.attributes || {}),
        params: resolvedParams
      }
    };

    appLogger.info('[ContinuationStage] Active plan params resolved', {
      resolvedParamKeys: Object.keys(resolvedParams),
      missingParamCount: resolution.missingToolsParams.reduce((total, item) => total + item.missing.length, 0),
      sources: resolution.sources,
      temporalDetails: decomposition.signals.temporalDetails
    });

    if (resolution.missingToolsParams.length > 0) {
      const question = await clarificationService.askForMultipleParametersFromTools(
        agent,
        input,
        resolution.missingToolsParams,
        input.language ?? 'Indonesia'
      );

      appLogger.info('[ContinuationStage] Missing params after continuation resolution, asking clarification', {
        missing: resolution.missingToolsParams.map(item => ({
          toolSlug: item.tool.slug,
          missing: item.missing
        }))
      });

      return PipelineFormatter.buildEarly(
        {
          intent: activeIntent || 'slot_filling',
          score: 1,
          message: question
        },
        startTotal
      );
    }

    const cachedToolLookup = intent.type === 'refine'
      ? ({ source: 'none' } as CachedToolLookupResult)
      : await this.getCachedToolResultForActivePlan(
        input,
        primaryToolTask?.key,
        resolvedParams,
        execContext,
        workingMemory
      );
    const cachedToolResult = cachedToolLookup.result;

    appLogger.info('[ContinuationStage] Active plan cache lookup completed', {
      toolKey: primaryToolTask?.key,
      cachedToolResultSource: cachedToolLookup.source,
      hasCachedToolResult: cachedToolResult !== undefined && cachedToolResult !== null
    });

    if (intent.type === 'refine') {
      appLogger.info('[ContinuationStage] Refine detected, bypassing cache and re-executing active plan', {
        toolKey: primaryToolTask?.key,
        skillKey: targetSkillTask?.key,
        cachedToolResultSource: cachedToolLookup.source
      });
    }

    if (targetSkillTask && cachedToolResult !== undefined && cachedToolResult !== null && this.canUseCachedToolResult(intent)) {
      appLogger.info('[ContinuationStage] Executing active plan skill from cached tool result', {
        skillKey: targetSkillTask.key,
        toolKey: primaryToolTask?.key,
        intentType: intent.type,
        cachedToolResultSource: cachedToolLookup.source
      });

      return await this.executeContinuationskillTaskFromCachedTool(
        targetSkillTask,
        primaryToolTask,
        cachedToolResult,
        executionInput,
        agent,
        startTotal,
        activeIntent,
        intent,
        activeExecutionPlan,
        resolvedParams
      );
    }

    if (topicRelevanceService.isDiscussionQuery(input.text) && cachedToolResult !== undefined && cachedToolResult !== null) {
      const chatStage = this.getChatStage();
      return await chatStage.execute(
        executionInput,
        agent,
        startTotal,
        {
          contextCache: {
            previousToolResults: this.toRecord(cachedToolResult),
            previousIntent: activeIntent,
            continuationType: intent.type,
            entities: resolvedParams,
            originalQuery: input.text,
            timestamp: Date.now()
          }
        }
      );
    }

    const executionStage = new ExecutionStage();
    const executionResult = await executionStage.execute(
      activeExecutionPlan,
      executionInput,
      resolvedParams,
      {
        cacheResults: true,
        userId: input.user_id,
        appName: input.app_name
      }
    );

    const apiResults = executionResult.results;

    // Update working memory with new results
    const workingMemoryUpdater = new WorkingMemoryUpdater();
    await workingMemoryUpdater.update(input.user_id, input.app_name, {
      type: 'plan',
      apiResults,
      plan: activeExecutionPlan,
      params: resolvedParams,
      activeIntent,
      activeTool: primaryToolTask?.key
    });

    // Naturalize response
    const naturalizationStage = new NaturalizationStage();
    const naturalResponse = await naturalizationStage.execute(
      apiResults,
      executionInput,
      agent,
      {
        contextCache: {
          workingMemory: workingMemory || undefined,
          continuationType: intent.type,
          entities: resolvedParams,
          originalQuery: input.text
        }
      }
    );

    // Update episodic memory
    const messages = ConversationUtil.buildMessages(input, {
      memoryContext: naturalResponse
    });

    await episodicMemoryService.summarize(
      agent,
      activeIntent,
      input.user_id,
      input.app_name,
      messages
    );

    // Record metrics
    const metricsService = new PipelineMetricsService();
    metricsService.recordSuccess(activeIntent, Date.now() - startTotal);

    return PipelineFormatter.buildEarly(
      {
        intent: activeIntent,
        score: intent.confidence || 1,
        message: naturalResponse,
        apiResult: apiResults
      },
      startTotal
    );
  }

  private async executeComparisonContinuation(
    plan: PlannerOutput,
    input: PipelineInput,
    agent: Agent,
    continuationResult: ContinuationResult,
    execContext: ContinuationExecutionContext,
    startTotal: number,
    activeIntent: string
  ): Promise<PipelineResult> {
    const intent = continuationResult.intent;
    const workingMemory = continuationResult.context.workingMemory;
    const decomposition = queryDecompositionService.decompose(input.text);
    const comparisonSignal = decomposition.signals.comparison;

    if (!comparisonSignal?.isComparison) {
      appLogger.warn('[ContinuationStage] Comparison type without comparison signal, returning to pipeline flow', {
        userId: input.user_id,
        appName: input.app_name
      });

      return PipelineFormatter.buildEarly(
        {
          intent: 'continuation_fallback',
          score: 0,
          message: 'Saya perlu menjalankan ulang alur utama untuk memahami perbandingan ini.'
        },
        startTotal
      );
    }

    const baseParams: Record<string, unknown> = {
      ...(workingMemory?.activeEntities || {}),
      ...((input.attributes?.params as Record<string, unknown>) || {})
    };

    const comparisonContext = await comparisonOrchestratorService.buildContinuationContext({
      input,
      activePlan: plan,
      workingMemory,
      baseParams,
      comparison: comparisonSignal,
      analyzerSkill: intent.targetSkill
    });

    if (!comparisonContext) {
      appLogger.info('[ContinuationStage] Comparison context unavailable for V1 exact-tool flow', {
        userId: input.user_id,
        appName: input.app_name,
        activeTool: workingMemory?.activeTool,
        temporalDetails: decomposition.signals.temporalDetails
      });

      return PipelineFormatter.buildEarly(
        {
          intent: 'continuation_fallback',
          score: 0,
          message: 'Saya perlu menjalankan ulang alur utama untuk memahami perbandingan ini.'
        },
        startTotal
      );
    }

    const toolKey = comparisonContext.toolTask.key;
    const sessionKey = execContext.sessionKey || `${input.user_id}:${input.app_name}`;
    const toolPlan: PlannerOutput = {
      mode: 'single_step',
      chat: false,
      tasks: [{
        id: 'comparison_tool',
        resource: 'tool',
        key: toolKey,
        depends_on: [],
        confidence: comparisonContext.toolTask.confidence
      }]
    };

    const baselineResult = await this.getOrExecuteComparisonToolResult(
      'baseline',
      toolPlan,
      toolKey,
      input,
      comparisonContext.baseline.params,
      sessionKey,
      workingMemory,
      execContext,
      true
    );

    const targetResult = await this.getOrExecuteComparisonToolResult(
      'target',
      toolPlan,
      toolKey,
      input,
      comparisonContext.target.params,
      sessionKey,
      workingMemory,
      execContext,
      false
    );

    const skillInput = comparisonOrchestratorService.buildSkillInput(
      comparisonContext,
      baselineResult,
      targetResult,
      input.text,
      input.language
    );

    appLogger.info('[ContinuationStage] Executing comparison analyzer', {
      toolKey,
      baselineLabel: comparisonContext.baseline.label,
      targetLabel: comparisonContext.target.label,
      baselineParamKeys: Object.keys(comparisonContext.baseline.params),
      targetParamKeys: Object.keys(comparisonContext.target.params),
      temporalStrategy: comparisonContext.target.temporalMapping?.strategy
    });

    return await this.executeSkill(
      comparisonContext.analyzerSkill,
      skillInput,
      input,
      agent,
      startTotal,
      activeIntent,
      {
        intent,
        sourceToolKey: toolKey,
        sourceToolResult: {
          comparison: {
            baseline: baselineResult,
            target: targetResult
          }
        },
        activePlan: plan,
        resolvedParams: comparisonContext.target.params
      }
    );
  }

  private async getOrExecuteComparisonToolResult(
    source: 'baseline' | 'target',
    toolPlan: PlannerOutput,
    toolKey: string,
    input: PipelineInput,
    params: Record<string, unknown>,
    sessionKey: string,
    workingMemory: WorkingMemoryData | null,
    execContext: ContinuationExecutionContext,
    allowWorkingMemoryFallback: boolean
  ): Promise<unknown> {
    if (allowWorkingMemoryFallback) {
      const lastExecution = workingMemory?.metadata?.lastExecution as any;
      const lastParams = lastExecution?.params as Record<string, unknown> | undefined;
      const lastResult = lastExecution?.results?.[toolKey];

      if (lastResult !== undefined && (!lastParams || this.paramsShallowEqual(lastParams, params))) {
        appLogger.info('[ContinuationStage] Comparison baseline reused from working memory', {
          toolKey,
          source,
          hasStoredParams: !!lastParams
        });
        return lastResult;
      }

      if (execContext.cachedResult && this.paramsShallowEqual(execContext.cachedParams || {}, params)) {
        appLogger.info('[ContinuationStage] Comparison baseline reused from execution context cache', {
          toolKey,
          source
        });
        return execContext.cachedResult;
      }
    }

    const cached = await toolResultCache.get(
      sessionKey,
      toolKey,
      {
        skipRedis: false,
        strictParams: true,
        allowLegacyFallback: false,
        allowLatestFallback: false
      },
      params
    );

    if (cached?.result) {
      appLogger.info('[ContinuationStage] Comparison result reused from strict param cache', {
        toolKey,
        source
      });
      return cached.result;
    }

    appLogger.info('[ContinuationStage] Executing comparison tool result', {
      toolKey,
      source,
      paramKeys: Object.keys(params)
    });

    const executionStage = new ExecutionStage();
    const executionResult = await executionStage.execute(
      toolPlan,
      {
        ...input,
        attributes: {
          ...(input.attributes || {}),
          params
        }
      },
      params,
      {
        cacheResults: true,
        userId: input.user_id,
        appName: input.app_name
      }
    );

    return executionResult.results[toolKey];
  }

  private paramsShallowEqual(
    left: Record<string, unknown>,
    right: Record<string, unknown>
  ): boolean {
    const clean = (value: Record<string, unknown>) => Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== '')
    );
    const cleanedLeft = clean(left);
    const cleanedRight = clean(right);
    const leftKeys = Object.keys(cleanedLeft).sort();
    const rightKeys = Object.keys(cleanedRight).sort();

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key, index) => key === rightKeys[index] && cleanedLeft[key] === cleanedRight[key]);
  }

  private buildContinuationExecutionPlan(
    activePlan: PlannerOutput,
    intent: ContinuationIntent,
    workingMemory: WorkingMemoryData | null
  ): ContinuationExecutionPlan {
    const tasks = [...(activePlan.tasks || [])];
    const toolTasks = tasks.filter(task => task.resource === 'tool');
    const skillTasks = tasks.filter(task => task.resource === 'skill');
    const primaryToolTask = this.selectPrimaryToolTask(toolTasks, workingMemory);
    let targetSkillTask = this.selectActivePlanSkill(skillTasks, intent);
    let addedSkillTask = false;

    if (!targetSkillTask && intent.targetSkill) {
      targetSkillTask = {
        id: this.buildSyntheticTaskId(tasks, 'continuation_skill'),
        resource: 'skill',
        key: intent.targetSkill,
        depends_on: primaryToolTask ? [primaryToolTask.id] : [],
        confidence: intent.confidence
      };
      tasks.push(targetSkillTask);
      addedSkillTask = true;
    }

    const augmentedPlan: PlannerOutput = {
      ...activePlan,
      mode: tasks.some(task => task.depends_on.length > 0) ? 'multi_step' : activePlan.mode,
      chat: false,
      tasks,
      meta: {
        ...(activePlan.meta || {}),
        ...(addedSkillTask
          ? ({
            continuationAugmented: true,
            sourcePlanMode: activePlan.mode,
            addedSkillTaskKey: targetSkillTask?.key
          } as any)
          : {})
      }
    };

    return {
      plan: augmentedPlan,
      primaryToolTask,
      targetSkillTask,
      addedSkillTask
    };
  }

  private selectPrimaryToolTask(
    toolTasks: PlannerTask[],
    workingMemory: WorkingMemoryData | null
  ): PlannerTask | undefined {
    if (toolTasks.length === 0) return undefined;

    if (workingMemory?.activeTool) {
      const activeToolTask = toolTasks.find(task => task.key === workingMemory.activeTool);
      if (activeToolTask) return activeToolTask;
    }

    return toolTasks[toolTasks.length - 1] || toolTasks[0];
  }

  private selectActivePlanSkill(
    skillTasks: PlannerTask[],
    intent: ContinuationIntent
  ): PlannerTask | undefined {
    if (skillTasks.length === 0) return undefined;

    if (intent.targetSkill) {
      const exactMatch = skillTasks.find(task => task.key === intent.targetSkill);
      if (exactMatch) return exactMatch;
    }

    if (intent.type === 'detail') {
      const analyzer = skillTasks.find(task => task.key === 'data_analyzer' || task.key.includes('analyzer'));
      if (analyzer) return analyzer;
    }

    if (intent.type === 'export') {
      const exporter = skillTasks.find(task => task.key.includes('generator') || task.key.includes('export'));
      if (exporter) return exporter;
    }

    return skillTasks[0];
  }

  private buildSyntheticTaskId(tasks: PlannerTask[], prefix: string): string {
    let counter = 1;
    let taskId = `${prefix}_${counter}`;

    while (tasks.some(task => task.id === taskId)) {
      counter += 1;
      taskId = `${prefix}_${counter}`;
    }

    return taskId;
  }

  private canUseCachedToolResult(intent: ContinuationIntent): boolean {
    if (intent.type === 'refine') return false;
    return !!intent.targetSkill || intent.type === 'detail' || intent.type === 'export' || intent.type === 'clarify' || intent.type === 'action';
  }

  private async getCachedToolResultForActivePlan(
    input: PipelineInput,
    toolSlug: string | undefined,
    resolvedParams: Record<string, unknown>,
    execContext: ContinuationExecutionContext,
    workingMemory: WorkingMemoryData | null
  ): Promise<CachedToolLookupResult> {
    if (toolSlug) {
      const sessionKey = execContext.sessionKey || `${input.user_id}:${input.app_name}`;
      const hasResolvedParams = Object.keys(resolvedParams).length > 0;
      const paramCached = hasResolvedParams
        ? await toolResultCache.get(
          sessionKey,
          toolSlug,
          {
            skipRedis: false,
            strictParams: true,
            allowLegacyFallback: false,
            allowLatestFallback: false
          },
          resolvedParams
        )
        : null;

      if (paramCached?.result) {
        return {
          result: paramCached.result,
          source: this.cachedParamsMatch(paramCached.params, resolvedParams) ? 'param_cache' : 'slug_cache'
        };
      }

      if (hasResolvedParams) {
        return { source: 'none' };
      }

      const slugCached = await toolResultCache.get(sessionKey, toolSlug, { skipRedis: false });
      if (slugCached?.result) {
        return { result: slugCached.result, source: 'slug_cache' };
      }

      const lastResults = (workingMemory?.metadata?.lastExecution as any)?.results;
      if (lastResults?.[toolSlug]) {
        return { result: lastResults[toolSlug], source: 'working_memory_last_execution' };
      }
    }

    if (execContext.cachedResult) {
      return { result: execContext.cachedResult, source: 'exec_context' };
    }

    return { source: 'none' };
  }

  private cachedParamsMatch(
    cachedParams: Record<string, unknown> | undefined,
    resolvedParams: Record<string, unknown>
  ): boolean {
    if (!cachedParams || Object.keys(cachedParams).length === 0) {
      return false;
    }

    for (const [key, value] of Object.entries(cachedParams)) {
      if (resolvedParams[key] !== value) {
        return false;
      }
    }

    return true;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return { data: value };
  }

  private buildSkillInputFromToolResult(
    toolTask: PlannerTask | undefined,
    toolResult: unknown
  ): Record<string, unknown> {
    if (!toolTask) {
      return this.toRecord(toolResult);
    }

    return {
      [toolTask.key]: toolResult,
      [toolTask.id]: toolResult,
      data: toolResult
    };
  }

  private async executeContinuationskillTaskFromCachedTool(
    skillTask: PlannerTask,
    toolTask: PlannerTask | undefined,
    cachedToolResult: unknown,
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    activeIntent: string,
    intent: ContinuationIntent,
    activePlan: PlannerOutput,
    resolvedParams: Record<string, unknown>
  ): Promise<PipelineResult> {
    const skillInput = this.buildSkillInputFromToolResult(toolTask, cachedToolResult);
    const result = await this.executeSkill(
      skillTask.key,
      skillInput,
      input,
      agent,
      startTotal,
      activeIntent,
      {
        intent,
        sourceToolKey: toolTask?.key,
        sourceToolResult: cachedToolResult,
        activePlan,
        resolvedParams
      }
    );

    return result;
  }

  private async returnNaturalizedCachedToolResult(
    toolTask: PlannerTask | undefined,
    cachedToolResult: unknown,
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    activeIntent: string,
    intent: ContinuationIntent,
    activePlan: PlannerOutput,
    resolvedParams: Record<string, unknown>
  ): Promise<PipelineResult> {
    const apiResults = toolTask
      ? { [toolTask.key]: cachedToolResult }
      : this.toRecord(cachedToolResult);

    const workingMemoryUpdater = new WorkingMemoryUpdater();
    await workingMemoryUpdater.update(input.user_id, input.app_name, {
      type: 'plan',
      apiResults,
      plan: activePlan,
      params: resolvedParams,
      activeIntent,
      activeTool: toolTask?.key
    });

    const naturalizationStage = new NaturalizationStage();
    const naturalResponse = await naturalizationStage.execute(
      apiResults,
      input,
      agent,
      {
        contextCache: {
          continuationType: intent.type,
          entities: resolvedParams,
          originalQuery: input.text
        }
      }
    );

    const messages = ConversationUtil.buildMessages(input, {
      memoryContext: naturalResponse
    });

    await episodicMemoryService.summarize(
      agent,
      activeIntent,
      input.user_id,
      input.app_name,
      messages
    );

    const metricsService = new PipelineMetricsService();
    metricsService.recordSuccess(activeIntent, Date.now() - startTotal);

    return PipelineFormatter.buildEarly(
      {
        intent: activeIntent,
        score: intent.confidence || 1,
        message: naturalResponse,
        apiResult: apiResults
      },
      startTotal
    );
  }

  /**
   * Execute skill directly (for export/detail continuation)
   */
  private async executeSkill(
    skillKey: string,
    cachedData: Record<string, unknown>,
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    activeIntent: string,
    options?: {
      intent?: ContinuationIntent;
      sourceToolKey?: string;
      sourceToolResult?: unknown;
      activePlan?: PlannerOutput;
      resolvedParams?: Record<string, unknown>;
    }
  ): Promise<PipelineResult> {
    appLogger.info('[ContinuationStage] Executing skill', {
      skillKey,
      hasCachedData: !!cachedData,
      userId: input.user_id,
      appName: input.app_name
    });

    const skillPlan: PlannerOutput = {
      mode: 'single_step',
      chat: false,
      tasks: [{
        id: "1",
        resource: 'skill',
        key: skillKey,
        depends_on: []
      }]
    };

    const executionStage = new ExecutionStage();
    const skillParams = this.buildDirectSkillParams(skillKey, cachedData, input);
    const apiResults = await executionStage.execute(
      skillPlan,
      input,
      skillParams,
      {
        cacheResults: false,  // ✅ FIX 1: Don't overwrite tool cache!
        userId: input.user_id,
        appName: input.app_name
      }
    );

    const selectedOffer = await this.generateContinuationOffer({
      input,
      skillKey,
      skillPlan,
      activePlan: options?.activePlan,
      skillParams,
      cachedData,
      apiResults: apiResults.results,
      workingMemory: options?.intent ? undefined : null
    });

    // Update working memory
    const workingMemoryUpdater = new WorkingMemoryUpdater();
    await workingMemoryUpdater.update(input.user_id, input.app_name, {
      type: 'continuation',
      intent: options?.intent || { type: 'export' as any, targetSkill: skillKey, isContinuation: true, confidence: 1 },
      apiResults: options?.sourceToolKey
        ? {
          [options.sourceToolKey]: options.sourceToolResult,
          ...apiResults.results
        }
        : apiResults.results,
      activeIntent
    });

    // ✅ CHECK: Skip analysis for minimal data (e.g., time data with <10 fields)
    const timeData = apiResults.results['get_time'] as any;
    if (skillKey !== 'data_analyzer' && timeData && Object.keys(timeData).length < 10) {
      appLogger.info('[ContinuationStage] Skipping analysis for minimal time data', {
        fieldCount: Object.keys(timeData).length
      });
    } else if (skillKey === 'data_analyzer' && timeData && Object.keys(timeData).length < 10) {
      appLogger.info('[ContinuationStage] Minimal time shortcut skipped for explicit analyzer request', {
        fieldCount: Object.keys(timeData).length,
        skillKey
      });
    }

    if (skillKey !== 'data_analyzer' && timeData && Object.keys(timeData).length < 10) {
      
      // Return formatted time message directly
      const timezone = input.attributes?.timezone || 'lokasi';
      const naturalResponse = this.appendOfferText(
        `Waktu di ${timezone}: ${timeData.date_time || timeData.time || 'tidak tersedia'}`,
        selectedOffer
      );
      
      // Update episodic memory
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: naturalResponse
      });
      
      await episodicMemoryService.summarize(
        agent,
        activeIntent,
        input.user_id,
        input.app_name,
        messages
      );
      
      // Record metrics
      const metricsService = new PipelineMetricsService();
      metricsService.recordSuccess(activeIntent, Date.now() - startTotal);
      
      return PipelineFormatter.buildEarly(
        {
          intent: activeIntent,
          score: 1,
          message: naturalResponse,
          apiResult: apiResults.results,
          metadata: selectedOffer ? { activeOffer: selectedOffer } : undefined
        },
        startTotal
      );
    }

    // ✅ CHECK: Skip naturalization for structured data_analyzer results
    let naturalResponse: string;

    const dataAnalyzerResult = apiResults.results['data_analyzer'] as any;

    if (dataAnalyzerResult?.analysis &&
        dataAnalyzerResult?.summary &&
        dataAnalyzerResult?.insights?.length > 0) {

      // Already structured - format as natural language (NO LLM)
      appLogger.debug('[ContinuationStage] Using structured analysis (skip LLM naturalization)', {
        skillKey
      });

      const analysis = dataAnalyzerResult.analysis;
      naturalResponse = this.appendOfferText(
        this.formatStructuredAnalysis(analysis),
        selectedOffer
      );

    } else {
      // Unstructured data - use LLM naturalization
      appLogger.debug('[ContinuationStage] Using LLM naturalization', {
        skillKey
      });

      const naturalizationStage = new NaturalizationStage();
      naturalResponse = await naturalizationStage.execute(
        apiResults.results,
        input,
        agent,
        {
          contextCache: {
            ...(options?.intent
              ? {
                continuationType: options.intent.type,
                entities: options.resolvedParams,
                previousToolResults: options.sourceToolKey
                  ? { [options.sourceToolKey]: options.sourceToolResult }
                  : undefined
              }
              : {}),
            originalQuery: input.text,
            allowedOffer: this.buildAllowedOfferForNaturalization(selectedOffer)
          }
        }
      );
    }

    // ✅ FIX #2: Update episodic memory
    const messages = ConversationUtil.buildMessages(input, {
      memoryContext: naturalResponse
    });

    await episodicMemoryService.summarize(
      agent,
      activeIntent,
      input.user_id,
      input.app_name,
      messages
    );

    appLogger.debug('[ContinuationStage] Episodic memory updated', {
      userId: input.user_id,
      appName: input.app_name,
      intent: activeIntent
    });

    // Record metrics
    const metricsService = new PipelineMetricsService();
    metricsService.recordSuccess(activeIntent, Date.now() - startTotal);

    return PipelineFormatter.buildEarly(
      {
        intent: activeIntent,
        score: 1,
        message: naturalResponse,
        apiResult: apiResults.results,
        metadata: selectedOffer ? { activeOffer: selectedOffer } : undefined
      },
      startTotal
    );
  }

  private buildAllowedOfferForNaturalization(selectedOffer: Awaited<ReturnType<ContinuationStage['generateContinuationOffer']>>) {
    if (!selectedOffer) {
      return undefined;
    }

    return {
      label: selectedOffer.label,
      reason: selectedOffer.reason,
      suggestedText: selectedOffer.suggestedText || selectedOffer.label
    };
  }

  private appendOfferText(message: string, selectedOffer: Awaited<ReturnType<ContinuationStage['generateContinuationOffer']>>): string {
    if (!selectedOffer?.suggestedText) {
      return message;
    }

    const trimmed = String(message || '').trim();
    if (!trimmed) {
      return selectedOffer.suggestedText;
    }

    if (trimmed.includes(selectedOffer.suggestedText)) {
      return trimmed;
    }

    return `${trimmed}\n\n${selectedOffer.suggestedText}`;
  }

  private async generateContinuationOffer(input: {
    input: PipelineInput;
    skillKey: string;
    skillPlan: PlannerOutput;
    activePlan?: PlannerOutput;
    skillParams: Record<string, unknown>;
    cachedData: Record<string, unknown>;
    apiResults: Record<string, unknown>;
    workingMemory?: WorkingMemoryData | null;
  }) {
    try {
      const offerStage = new OfferGenerationStage();
      const plan = this.buildOfferPlanForContinuation(input.activePlan, input.skillPlan, input.skillKey);
      const results = this.buildOfferResultsForContinuation(plan, input.cachedData, input.apiResults);

      const offerResult = await offerStage.execute({
        input: input.input,
        plan,
        params: input.skillParams,
        results,
        executedTasks: plan.tasks.map(task => ({
          key: task.key,
          resource: task.resource
        })) as any,
        workingMemory: input.workingMemory
      });

      const selectedOffer = offerResult.selectedOffer;
      if (!selectedOffer) {
        return null;
      }

      if (selectedOffer.target.resource === 'skill' && selectedOffer.target.key === input.skillKey) {
        return null;
      }

      await workingMemoryService.setActiveOffer(
        input.input.user_id,
        input.input.app_name,
        selectedOffer
      );

      return selectedOffer;
    } catch (error) {
      appLogger.warn('[ContinuationStage] Continuation offer generation skipped', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private buildOfferPlanForContinuation(
    activePlan: PlannerOutput | undefined,
    skillPlan: PlannerOutput,
    skillKey: string
  ): PlannerOutput {
    const toolTasks = (activePlan?.tasks || []).filter(task => task.resource === 'tool');
    const skillTask = skillPlan.tasks[0];

    return {
      mode: toolTasks.length > 0 ? 'multi_step' : 'single_step',
      chat: false,
      tasks: [
        ...toolTasks,
        ...(skillTask?.key && skillTask.key !== skillKey ? [skillTask] : []),
        ...(skillTask?.key === skillKey ? [skillTask] : [])
      ]
    };
  }

  private buildOfferResultsForContinuation(
    plan: PlannerOutput,
    cachedData: Record<string, unknown>,
    apiResults: Record<string, unknown>
  ): Record<string, unknown> {
    const results: Record<string, unknown> = {};

    for (const task of plan.tasks) {
      if (task.resource === 'tool' && cachedData[task.key] !== undefined) {
        results[task.key] = cachedData[task.key];
      } else if (apiResults[task.key] !== undefined) {
        results[task.key] = apiResults[task.key];
      }
    }

    return {
      ...results,
      ...apiResults
    };
  }

  /**
   * Format structured analysis as natural language (NO LLM)
   */
  private formatStructuredAnalysis(analysis: any): string {
    let response = analysis.summary || '';
    
    // Add insights
    if (analysis.insights && analysis.insights.length > 0) {
      response += '\n\nInsight utama:';
      response += analysis.insights.map((i: string) => `- ${i}`).join('\n');
    }
    
    // Add patterns
    if (analysis.patterns && analysis.patterns.length > 0) {
      response += '\n\nPola yang terdeteksi:';
      response += analysis.patterns.map((p: string) => `- ${p}`).join('\n');
    }
    
    // Add recommendations
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      response += '\n\nRekomendasi:';
      response += analysis.recommendations.map((r: string) => `- ${r}`).join('\n');
    }
    
    return response;
  }

  /**
   * Execute multi-step graph when no cached data available
   * Step 1: Execute tool from working memory
   * Step 2: Execute skill with tool result
   *
   * @deprecated Active-plan continuations should use
   * executeActivePlanContinuation(). Keep this only as a temporary fallback
   * when no activePlan exists in working memory.
   */
  private async executeMultiStepGraph(
    workingMemory: WorkingMemoryData | null,
    intent: ContinuationIntent,
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    activeIntent: string
  ): Promise<PipelineResult> {
    // Step 1: Execute tool from working memory
    const toolSlug = workingMemory?.activeTool;
    
    if (!toolSlug) {
      throw new Error('No tool available for multi-step execution');
    }

    // Build tool execution plan
    const toolPlan: PlannerOutput = {
      mode: 'single_step',
      chat: false,
      tasks: [{
        id: "1",
        resource: 'tool',
        key: toolSlug,
        depends_on: []
      }]
    };

    // Execute tool
    const executionStage = new ExecutionStage();
    const toolResult = await executionStage.execute(
      toolPlan,
      input,
      workingMemory.activeEntities || {},
      { 
        cacheResults: true, 
        userId: input.user_id, 
        appName: input.app_name 
      }
    );

    // Get tool result
    const toolData = toolResult.results[toolSlug];
    
    if (!toolData) {
      // appLogger.error('[ContinuationStage] Multi-step graph - Tool execution failed', {
      //   toolSlug,
      //   results: toolResult.results
      // });
      
      throw new Error(`Tool execution failed for ${toolSlug}`);
    }

    // Step 2: Execute skill with tool result
    const skillSlug = intent.targetSkill || await this.inferSkillFromType(intent.type);

    if (!skillSlug) {
      appLogger.error('[ContinuationStage] No skill found for multi-step graph', {
        intentType: intent.type,
        targetSkill: intent.targetSkill
      });
      throw new Error(`No skill found for continuation type: ${intent.type}`);
    }

    appLogger.info('[ContinuationStage] Multi-step graph - Step 2: Execute skill', {
      skillSlug,
      hasToolData: !!toolData
    });

    return await this.executeSkill(
      skillSlug,
      toolData as Record<string, unknown>,
      input,
      agent,
      startTotal,
      workingMemory.activeIntent || 'general_chat'
    );
  }

  /**
   * ✅ IMPROVEMENT 1: Infer skill slug from continuation type (from repository, not hardcode)
   */
  private async inferSkillFromType(
    type: ContinuationIntent['type']
  ): Promise<string | undefined> {
    if (type === 'export' && skillsRegistry.hasSkill('xls_generator')) {
      return 'xls_generator';
    }

    if ((type === 'detail' || type === 'clarify' || type === 'comparison') && skillsRegistry.hasSkill('data_analyzer')) {
      return 'data_analyzer';
    }

    appLogger.debug('[ContinuationStage] No skill inferred from continuation type', { type });
    return undefined;
  }

  private buildDirectSkillParams(
    skillKey: string,
    cachedData: Record<string, unknown>,
    input: PipelineInput
  ): Record<string, unknown> {
    const skill = skillsRegistry.getSkillBySlug(skillKey);
    const requiresData = Boolean(skill?.paramSchema?.some(param => param.name === 'data' && param.isRequired));
    const toolOnlyData = this.filterToolResultsForSkillInput(cachedData);

    if (!requiresData) {
      return {
        ...toolOnlyData,
        userQuery: input.text
      };
    }

    return {
      data: toolOnlyData,
      userQuery: input.text,
      language: input.attributes?.language || 'id'
    };
  }

  private filterToolResultsForSkillInput(cachedData: Record<string, unknown>): Record<string, unknown> {
    const entries = Object.entries(cachedData || {});
    const filtered = entries.filter(([key]) => !skillsRegistry.hasSkill(key));

    if (filtered.length === 0) {
      return cachedData;
    }

    return Object.fromEntries(filtered);
  }

  private isSkill(targetKey: string): boolean {
    return skillsRegistry.hasSkill(targetKey);
  }

}
