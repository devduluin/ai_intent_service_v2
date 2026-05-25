import { ContinuationResolver, type ContinuationResult } from '../resolvers/continuation.resolver';
import { workingMemoryService, type WorkingMemoryData } from '../../workingMemory.service';
import { WorkingMemoryUpdater } from '../memory/working-memory-updater';
import { ExecutionStage } from './execution.stage';
import { NaturalizationStage } from './naturalization.stage';
import { PipelineMetricsService } from '../metrics/pipeline-metrics.service';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { type Agent } from '../../../types/agent.types';
import { type PipelineInput, type PipelineResult } from '../../../types';
import { type PlannerOutput } from '../../../types/planner.types';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface ContinuationStageOptions {
  skipPipelineIfContinuation?: boolean;
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
 * - Validate handlers exist
 * - Execute continuation if detected
 */
export class ContinuationStage {
  private resolver: ContinuationResolver;

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
        type: continuationResult.intent.type
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

      return {
        shouldSkipPipeline: false,
        intent: { isContinuation: false, confidence: 0, type: 'new' },
        context: { workingMemory: null, hasPreviousResult: false, availableContinuationTools: [] }
      };
    }
  }

  /**
   * Execute continuation handler
   *
   * @param input - Pipeline input
   * @param activeIntent - Active intent string
   * @param agent - Agent context
   * @param continuationResult - Continuation result from detection
   * @param startTotal - Start time for metrics
   * @returns PipelineResult with naturalized response
   */
  async executeContinuationHandler(
    input: PipelineInput,
    activeIntent: string,
    agent: Agent,
    continuationResult: ContinuationResult,
    startTotal: number
  ): Promise<PipelineResult> {
    const { intent, context } = continuationResult;

    try {
      // 1. Use cachedData from intent
      const previousResult = intent.cachedData?.result || context.workingMemory?.activeEntities;
      const cachedEntities = intent.cachedData?.entities || {};

      // 2. Determine resource type from working memory
      // C-009 FIX: Support tools, handlers, and knowledge (not just handlers)
      const activeTool = context.workingMemory?.activeTool;
      const activeHandler = context.workingMemory?.activeHandler;  // NEW: Check for handler
      const activeIntentType = context.workingMemory?.activeIntent;

      // Determine resource type: handler takes priority if activeHandler exists
      let resourceType: 'tool' | 'handler' | 'knowledge' = 'tool'; // Default to tool
      let targetKey: string | undefined;

      // Priority 1: If activeHandler is set, it's a handler
      if (activeHandler) {
        resourceType = 'handler';
        targetKey = activeHandler;
      }
      // Priority 2: If we have cached data with toolSlug, it's a tool
      else if (intent.cachedData?.toolSlug) {
        resourceType = 'tool';
        targetKey = intent.cachedData.toolSlug;
      }
      // Priority 3: Check if it's a known handler pattern from intent type
      else if (activeIntentType && (activeIntentType.includes('export') || activeIntentType.includes('generate'))) {
        resourceType = 'handler';
        targetKey = intent.targetHandler || activeIntentType;
      }
      // Priority 4: Default to tool
      else {
        resourceType = 'tool';
        targetKey = activeTool || intent.targetHandler || activeIntentType || undefined;
      }

      // Fallback: Use targetHandler from intent if nothing else worked
      if (!targetKey && intent.targetHandler) {
        targetKey = intent.targetHandler;
        // Check if targetHandler looks like a handler
        if (targetKey.includes('_generator') || targetKey.includes('_analyzer')) {
          resourceType = 'handler';
        }
      }

      if (!targetKey) {
        appLogger.warn('[ContinuationStage] No target tool/handler found for continuation', {
          userId: input.user_id,
          appName: input.app_name,
          activeTool,
          activeHandler,
          activeIntentType,
          targetHandler: intent.targetHandler
        });

        // Fallback to chat
        return {
          intent: 'general_chat',
          score: 0,
          apiResult: null,
          naturalResponse: '',
          metadata: {}
        };
      }

      appLogger.info('[ContinuationStage] Executing continuation', {
        targetKey,
        resourceType,
        userId: input.user_id,
        appName: input.app_name,
        hasPreviousResult: !!previousResult,
        cachedEntities: Object.keys(cachedEntities)
      });

      // Build single-task plan with correct resource type
      const continuationPlan: PlannerOutput = {
        mode: 'single_step',
        chat: false,
        tasks: [{
          id: "1",
          resource: resourceType,
          key: targetKey,
          depends_on: []
        }]
      };

      // Merge previous result with new params from user input
      const resultCacheData = {
        previousResult
      };

      // Execute using ExecutionStage
      const executionStage = new ExecutionStage();
      const apiResults = await executionStage.execute(
        continuationPlan,
        input,
        resultCacheData,
        {
          cacheResults: true,
          userId: input.user_id,
          appName: input.app_name
        }
      );

      // 3. Update working memory
      const workingMemoryUpdater = new WorkingMemoryUpdater();
      await workingMemoryUpdater.update(input.user_id, input.app_name, {
        type: 'continuation',
        intent: intent,
        apiResults: apiResults.results,
        activeIntent
      });

      // 4. Naturalize response
      const naturalizationStage = new NaturalizationStage();
      const naturalResponse = await naturalizationStage.execute(
        apiResults.results,
        input,
        agent
      );

      // 5. Record metrics
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

    } catch (error) {
      appLogger.error('[ContinuationStage] Continuation execution failed', {
        userId: input.user_id,
        appName: input.app_name,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

}
