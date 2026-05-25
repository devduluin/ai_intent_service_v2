import { SlotFillingResolver } from '../resolvers/slot-filling.resolver';
import { conversationStateService } from '../../conversationState.service';
import { clarificationService } from '../../clarification.service';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { type Agent } from '../../../types/agent.types';
import { type PipelineInput, type PendingIntentState, type PipelineResult, type ToolParam, type ToolMissingParams, type Intent } from '../../../types';
import { type PlannerOutput } from '../../../types/planner.types';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface SlotFillingStageOptions {
  maxRetry?: number;
  confidenceThreshold?: number;
}

export interface SlotFillingStageResult {
  shouldContinue: boolean;
  isComplete: boolean;
  result?: PipelineResult;
  collectedParams?: Record<string, unknown>;
  missingParams?: Array<{ toolSlug: string; missing: string[] }>;
}

// ============================================================
// Slot Filling Stage
// ============================================================

/**
 * SlotFillingStage - Handles slot filling for missing parameters
 * 
 * Responsibilities:
 * - Resume pending intents with collected params
 * - Extract params from user response
 * - Inject temporal details
 * - Re-check missing params
 * - Execute if complete or continue slot filling
 */
export class SlotFillingStage {
  private resolver: SlotFillingResolver;

  constructor() {
    this.resolver = new SlotFillingResolver();
  }

  /**
   * Resume a pending intent with slot filling
   * 
   * @param input - Pipeline input with user response
   * @param pending - Pending state from conversation state service
   * @param agent - Agent context
   * @param startTotal - Start time for metrics
   * @param options - Stage options
   * @returns SlotFillingStageResult with execution result or clarification question
   */
  async resume(
    input: PipelineInput,
    pending: PendingIntentState,
    agent: Agent | null,
    startTotal: number,
    options?: SlotFillingStageOptions
  ): Promise<SlotFillingStageResult> {
    const maxRetry = options?.maxRetry ?? 3;
    const confidenceThreshold = options?.confidenceThreshold ?? 0.5;

    appLogger.info('[SlotFillingStage] Resuming pending intent', {
      userId: input.user_id,
      text: input.text,
      oldText: pending.lastUserMessage,
      intentSlugs: pending.intentSlugs,
      missingCount: pending.missingToolsParams?.length
    });

    try {
      // 1. Resolve intents from slugs
      const intentSlugs: string[] = pending.intentSlugs || [];
      const intents = intentRegistry.getBySlugs(intentSlugs, agent?.id);

      if (!intents.length) {
        appLogger.error('[SlotFillingStage] No intents found for pending slugs', {
          intentSlugs
        });

        await conversationStateService.clear(input.user_id, input.app_name);

        return {
          shouldContinue: false,
          isComplete: false
        };
      }

      // 2. Get missing tools params from state
      const missingToolsParams: Array<{ toolSlug: string; missing: string[] }> =
        pending.missingToolsParams || [];

      const allMissingParamNames = missingToolsParams.flatMap(m => m.missing);
      const uniqueMissingNames = [...new Set(allMissingParamNames)];

      // 3. Get parameter definitions from tools
      const relevantParams = await this.getRelevantParams(missingToolsParams, uniqueMissingNames);

      appLogger.debug('[SlotFillingStage] Relevant params for extraction', {
        params: relevantParams.map(p => p.name)
      });

      // 4. Extract params from user input (with confidence)
      const extractionResult = await paramExtractorService.extractAll(
        input.text,
        relevantParams
      );

      const newParams = extractionResult.params;
      const paramConfidences = extractionResult.confidences;
      const lowConfidenceParams = extractionResult.lowConfidenceParams;

      appLogger.debug('[SlotFillingStage] Extracted params from user input', {
        params: newParams,
        confidences: paramConfidences,
        lowConfidenceParams
      });

      // 4.1 Extract temporal details from user input
      const decomposition = queryDecompositionService.decompose(input.text);
      const temporalDetails = decomposition.signals.temporalDetails || [];

      if (temporalDetails.length > 0) {
        appLogger.info('[SlotFillingStage] Temporal context detected', {
          temporalCount: temporalDetails.length
        });

        // Use TemporalInjector for consistent injection
        const temporalInjector = new TemporalInjector();
        temporalInjector.inject(newParams, temporalDetails as TemporalDetailWithDates[]);
      }

      // Check if all params have low confidence (user input not relevant)
      const hasAnyHighConfidenceParam = Object.values(paramConfidences).some(
        (conf: number) => conf >= confidenceThreshold
      );
      const hasAnyExtractedParam = Object.keys(newParams).length > 0;

      if (relevantParams.length > 0 && hasAnyExtractedParam && !hasAnyHighConfidenceParam) {
        appLogger.warn('[SlotFillingStage] All extracted params have low confidence', {
          inputText: input.text,
          confidences: paramConfidences
        });

        await conversationStateService.clear(input.user_id, input.app_name);

        return {
          shouldContinue: false,
          isComplete: false
        };
      }

      // Merge with collected params
      const mergedParams = paramHydratorService.hydrate(
        {
          ...pending.collectedParams,
          ...newParams
        },
        input.attributes
      );

      // 5. Re-check missing params
      const toolSlugsFromState = [...new Set(missingToolsParams.map(m => m.toolSlug))];
      const allTools = await toolService.getToolsBySlugs(toolSlugsFromState);
      const stillMissing = await toolService.getMissingParamsForTools(allTools, mergedParams);

      // Get original plan
      const originalPlan = pending.originalPlan || {
        mode: 'single_step',
        chat: false,
        tasks: []
      } as PlannerOutput;

      // 6. Branching: Still missing or complete?
      if (stillMissing.length > 0) {
        // Check if user is answering parameter or exiting flow
        const isAnsweringParam = PipelineValidator.isUserAnsweringParameter(input.text);

        if (!isAnsweringParam) {
          await conversationStateService.incrementRetry(input.user_id, input.app_name);
          const state = conversationStateService.get(input.user_id, input.app_name);

          if (!state) {
            await conversationStateService.clear(input.user_id, input.app_name);
            return {
              shouldContinue: false,
              isComplete: false
            };
          }
        }

        // Continue slot filling - generate clarification question
        const question = await clarificationService.askForMultipleParametersFromTools(
          agent ?? {} as Agent,
          input,
          stillMissing,
          input.language ?? 'Indonesia'
        );

        const intentDisplayName = intents.length > 1
          ? intents.map((i: Intent) => i.slug).join(', ')
          : intents[0]?.slug || 'unknown';

        return {
          shouldContinue: true,
          isComplete: false,
          missingParams: stillMissing as any,
          result: PipelineFormatter.buildEarly(
            {
              intent: intentDisplayName,
              score: 1,
              message: question
            },
            startTotal
          )
        };
      }

      // ============ ALL PARAMS COMPLETE → EXECUTE ============
      await conversationStateService.clear(input.user_id, input.app_name);

      appLogger.info('[SlotFillingStage] All params complete, executing', {
        plan: originalPlan
      });

      const lastUserMessage = `${pending.lastUserMessage} ${input.text}`;

      // Execute with originalPlan
      const apiResults = await withTimeout(
        this.executePlan(originalPlan, input, mergedParams),
        DEFAULT_TIMEOUT,
        'executeSafePlan-resume'
      );

      const naturalizeInput: PipelineInput = {
        ...input,
        text: lastUserMessage
      };

      const naturalResponse = await withTimeout(
        this.naturalize(naturalizeInput, apiResults, agent ?? {} as Agent),
        DEFAULT_TIMEOUT,
        'naturalize-resume'
      );

      // C-009 FIX: Update Working Memory to maintain conversation context
      // This allows follow-up questions like "kalau bandung?" to maintain intent
      const workingMemoryService = await import('../../workingMemory.service');
      await workingMemoryService.workingMemoryService.update(input.user_id, input.app_name, {
        activeIntent: intentSlugs[0] || 'slot_filling',
        activeWorkflow: originalPlan.mode === 'multi_step' ? 'multi_intent' : 'single_intent',
        activeTool: originalPlan.tasks?.[0]?.key || intentSlugs[0],
        activeEntities: mergedParams, // Store extracted params for context
        continuationHints: {
          canExport: false,
          canSummarize: false,
          canModify: true, // User can modify params (e.g., "kalau bandung?")
          canCancel: true
        },
        metadata: {
          lastAccessedAt: Date.now(),
          lastExecution: {
            timestamp: Date.now(),
            intent: intentSlugs[0],
            params: mergedParams
          }
        }
      });

      appLogger.debug('[SlotFillingStage] Working Memory updated for context maintenance', {
        userId: input.user_id,
        appName: input.app_name,
        activeIntent: intentSlugs[0],
        activeTool: originalPlan.tasks?.[0]?.key
      });

      return {
        shouldContinue: true,
        isComplete: true,
        collectedParams: mergedParams,
        result: PipelineFormatter.buildSuccessMulti(
          intentSlugs.join(',') || 'executed',
          1,
          apiResults,
          naturalResponse,
          startTotal
        )
      };

    } catch (err) {
      appLogger.error('[SlotFillingStage] Resume pending intent failed', {
        error: err instanceof Error ? err.message : err
      });

      return {
        shouldContinue: false,
        isComplete: false
      };
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private async getRelevantParams(
    missingToolsParams: Array<{ toolSlug: string; missing: string[] }>,
    uniqueMissingNames: string[]
  ): Promise<ToolParam[]> {
    const relevantParams: ToolParam[] = [];
    const seenParams = new Set<string>();

    for (const missingTool of missingToolsParams) {
      const tool = await toolRepository.findBySlug(missingTool.toolSlug);
      if (tool) {
        const toolParams = toolService.getToolParams(tool);
        for (const param of toolParams) {
          if (uniqueMissingNames.includes(param.name) && !seenParams.has(param.name)) {
            seenParams.add(param.name);
            relevantParams.push(param);
          }
        }
      }
    }

    return relevantParams;
  }

  /**
   * Handle PipelineCore result that requires slot filling
   *
   * @param coreResult - Result from PipelineCore.execute()
   * @param input - Original pipeline input
   * @param agent - Agent context
   * @param startTotal - Start time for metrics
   * @returns PipelineResult with clarification question or undefined if not slot filling
   */
  async handleCoreResult(
    coreResult: { intent: string; metadata: Record<string, number>; apiResult: unknown; naturalResponse: string; score: number },
    input: PipelineInput,
    agent: Agent,
    startTotal: number
  ): Promise<PipelineResult | undefined> {
    // Check if this is a slot filling response
    if (coreResult.intent !== 'slot_filling') {
      return undefined;
    }

    // Extract missing params from metadata
    const missingParams = coreResult.metadata.missingParams as any;
    const collectedParams = coreResult.metadata.collectedParams as any;
    
    // C-009 FIX: Get intent slugs from metadata (passed from PipelineCore)
    const intentSlugsFromMetadata = (coreResult.metadata as any).intentSlugs as string[] || [];

    // Get intents for slot filling - use intentSlugs from metadata if available
    const intents = intentSlugsFromMetadata.length > 0
      ? intentRegistry.getBySlugs(intentSlugsFromMetadata, agent?.id)
      : intentRegistry.getAll({ agentId: agent?.id });

    // Get relevant intents for slot filling
    const relevantIntents = intents.filter(intent =>
      intent.tools?.some(t => missingParams?.some((m: any) => m.tool.slug === t.tool?.slug))
    );

    // Save state for slot filling
    const intentSlugs = (relevantIntents.length > 0 ? relevantIntents : intents).map(i => i.slug);
    
    // C-009 FIX: Get originalPlan from metadata (passed from PipelineCore)
    const originalPlanFromMetadata = (coreResult.metadata as any).originalPlan as PlannerOutput;
    
    await conversationStateService.set(input.user_id, input.app_name, {
      intentSlugs,
      missingToolsParams: missingParams?.map((item: any) => ({
        toolSlug: item.tool.slug,
        toolName: item.tool.name,
        missing: item.missing
      })) || [],
      collectedParams: collectedParams || {},
      lastUserMessage: input.text,
      maxRetry: 3,
      isMultiIntent: intents.length > 1,
      // Use plan from metadata if available, otherwise fallback to empty plan
      originalPlan: originalPlanFromMetadata || { mode: 'single_step', chat: false, tasks: [] }
    });

    // Generate clarification question
    const question = await clarificationService.askForMultipleParametersFromTools(
      agent,
      input,
      missingParams || [],
      input.language ?? 'Indonesia'
    );

    const intentDisplayName = intentSlugs.length > 1
      ? intentSlugs.join(', ')
      : intentSlugs[0] || 'unknown';

    return PipelineFormatter.buildEarly(
      {
        intent: intentDisplayName,
        score: 1,
        message: question
      },
      startTotal
    );
  }

  private async executePlan(
    plan: PlannerOutput,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const executionStage = new ExecutionStage();
    const result = await executionStage.execute(
      plan,
      input,
      params,
      {
        cacheResults: true,
        userId: input.user_id,
        appName: input.app_name
      }
    );
    return result.results;
  }

  private async naturalize(
    input: PipelineInput,
    apiResults: Record<string, unknown>,
    agent: Agent
  ): Promise<string> {
    const naturalizationStage = new NaturalizationStage();
    return await naturalizationStage.execute(apiResults, input, agent);
  }
}

// ============================================================
// Imports (moved to bottom to avoid circular dependencies)
// ============================================================
import { intentRegistry } from '../../intent-registry.service';
import { paramExtractorService } from '../../paramExtractor.service';
import { paramHydratorService } from '../../param-hydrator.service';
import { queryDecompositionService } from '../../query-decomposition.service';
import { TemporalInjector } from '../injectors/temporal.injector';
import type { TemporalDetailWithDates } from '../injectors/temporal.injector';
import { toolService } from '../../tools.service';
import { toolRepository } from '../../../repositories/tool.repository';
import { PipelineValidator } from '../../../utils/pipeline-validator.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import { ExecutionStage } from './execution.stage';
import { NaturalizationStage } from './naturalization.stage';

const DEFAULT_TIMEOUT = 15000;
