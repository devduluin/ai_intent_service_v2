import { SlotFillingResolver } from '../resolvers/slot-filling.resolver';
import { conversationStateService } from '../../conversationState.service';
import { clarificationService } from '../../clarification.service';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { type Agent } from '../../../types/agent.types';
import { type PipelineInput, type PendingIntentState, type PipelineResult, type ToolParam, type ToolMissingParams, type Intent, type PipelineMetadata, type ResourceMissingParams } from '../../../types';
import { type PlannerOutput } from '../../../types/planner.types';
import { appLogger } from '../../../utils/logger.util';
import { config } from '../../../config';
import { isGenericAutomationGoal } from '../../../utils/automation-param.util';

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
  retryCount?: number;
  maxRetry?: number;
  retryExceeded?: boolean;
  needsClarification?: boolean;
  reason?: 'retry_exceeded' | 'invalid_pending_state' | 'execution_failed' | 'low_confidence' | 'still_missing' | 'complete';
  error?: string;  // ✅ FIX #2: Add error field
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
    const maxRetry = options?.maxRetry ?? pending.maxRetry ?? config.slotFilling.maxRetry;
    // ✅ FIX #3: Lower confidence threshold for simple entities (40% instead of 50%)
    const confidenceThreshold = options?.confidenceThreshold ?? 0.4;

    // ✅ FIX #1: CHECK RETRY COUNT AT START
    const currentRetryCount = await conversationStateService.getRetryCount(
      input.user_id,
      input.app_name
    );

    appLogger.info('[SlotFillingStage] Resuming pending intent', {
      userId: input.user_id,
      text: input.text,
      oldText: pending.lastUserMessage,
      intentSlugs: pending.intentSlugs,
      missingCount: pending.missingToolsParams?.length,
      missingResourceCount: pending.missingResourceParams?.length,
      currentRetryCount,
      maxRetry
    });

    // ✅ MAX RETRIES EXCEEDED - CLEAR STATE
    if (currentRetryCount >= maxRetry) {
      appLogger.warn('[SlotFillingStage] Max retries exceeded, clearing state', {
        userId: input.user_id,
        appName: input.app_name,
        retryCount: currentRetryCount,
        maxRetry
      });

      await conversationStateService.clear(input.user_id, input.app_name);

      return {
        shouldContinue: false,
        isComplete: false,
        retryExceeded: true,
        reason: 'retry_exceeded'
      };
    }

    try {
      // 1. Resolve intents from slugs
      const intentSlugs: string[] = pending.intentSlugs || [];
      const intents = intentRegistry.getBySlugs(intentSlugs, agent?.id);
      const hasExecutablePendingPlan = !!pending.originalPlan?.tasks?.length;

      if (!intents.length && !hasExecutablePendingPlan) {
        appLogger.error('[SlotFillingStage] No intents found for pending slugs and no executable plan', {
          intentSlugs
        });

        await conversationStateService.clear(input.user_id, input.app_name);

        return {
          shouldContinue: false,
          isComplete: false,
          reason: 'invalid_pending_state',
          error: 'No intents found for pending slot filling state'
        };
      }

      if (!intents.length && hasExecutablePendingPlan) {
        appLogger.warn('[SlotFillingStage] Pending slugs not found, continuing with stored plan', {
          intentSlugs,
          taskCount: pending.originalPlan?.tasks?.length || 0
        });
      }

      // 2. Get missing resource params from state. Prefer new generic format,
      // fallback to tool-only format for backward compatibility.
      const missingResourceParams = this.normalizeMissingResourceParams(pending);
      const missingToolsParams = this.toMissingToolsState(missingResourceParams);

      const allMissingParamNames = missingResourceParams.flatMap(m => m.missing);
      const uniqueMissingNames = [...new Set(allMissingParamNames)];

      // 3. Get parameter definitions from resources
      const relevantParams = await this.getRelevantParams(missingResourceParams, uniqueMissingNames);

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

      // ✅ FIX #2: INCREMENT RETRY ON LOW CONFIDENCE (DON'T CLEAR IMMEDIATELY)
      if (relevantParams.length > 0 && hasAnyExtractedParam && !hasAnyHighConfidenceParam) {
        appLogger.warn('[SlotFillingStage] All extracted params have low confidence', {
          inputText: input.text,
          confidences: paramConfidences
        });

        // ✅ INCREMENT RETRY COUNT
        const newRetryCount = await conversationStateService.incrementRetry(
          input.user_id,
          input.app_name
        );

        if (newRetryCount >= maxRetry) {
          // ✅ MAX RETRIES - CLEAR STATE
          await conversationStateService.clear(input.user_id, input.app_name);

          return {
            shouldContinue: false,
            isComplete: false,
            retryExceeded: true,
            retryCount: newRetryCount,
            maxRetry,
            reason: 'retry_exceeded'
          };
        }

        const question = missingToolsParams.length > 0
          ? await clarificationService.askForMultipleParametersFromTools(
              agent ?? {} as Agent,
              input,
              missingToolsParams.map(m => ({ tool: { slug: m.toolSlug, name: m.toolName || m.toolSlug } as any, missing: m.missing })),
              input.language ?? 'Indonesia'
            )
          : await clarificationService.askForMultipleParametersFromResources(
              agent ?? {} as Agent,
              input,
              missingResourceParams,
              input.language ?? 'Indonesia'
            );
        const intentDisplayName = intents.length > 1
          ? intents.map((i: any) => i.slug).join(', ')
          : intents[0]?.slug || 'unknown';

        return {
          shouldContinue: true,
          isComplete: false,
          retryCount: newRetryCount,
          maxRetry,
          needsClarification: true,
          reason: 'low_confidence',
          result: PipelineFormatter.buildEarly(
            {
              intent: intentDisplayName,
              score: paramConfidences[Object.keys(paramConfidences)[0]] || 0,
              message: `${question} (Percobaan ${newRetryCount}/${maxRetry})`
            },
            startTotal
          )
        };
      }

      // ✅ SUCCESSFUL EXTRACTION - RESET RETRY COUNT
      if (hasAnyHighConfidenceParam) {
        await conversationStateService.resetRetry(input.user_id, input.app_name);
      }

      // Merge with collected params
      const paramsForMerge = this.mergeIncrementalSlotParams(pending, newParams);
      const mergedParams = paramHydratorService.hydrate(
        paramsForMerge,
        input.attributes
      );

      // 5. Re-check missing params
      const stillMissingResources = this.getStillMissingResourceParams(missingResourceParams, mergedParams);
      const stillMissing = await this.toToolMissingParams(stillMissingResources);

      // ✅ FIX #4: Add comprehensive logging for decision making
      appLogger.info('[SlotFillingStage] Slot filling decision', {
        userId: input.user_id,
        hasAnyHighConfidenceParam,
        hasAnyExtractedParam,
        stillMissingCount: stillMissingResources.length,
        confidenceThreshold,
        newParamsCount: Object.keys(newParams).length,
        mergedParamsCount: Object.keys(mergedParams).length
      });

      // Get original plan
      const originalPlan = pending.originalPlan || {
        mode: 'single_step',
        chat: false,
        tasks: []
      } as PlannerOutput;

      // 6. Branching: Still missing or complete?
      if (stillMissingResources.length > 0) {
        // Check if user is answering parameter or exiting flow
        const isAnsweringParam = PipelineValidator.isUserAnsweringParameter(input.text);
        const shouldCountAsFailedAttempt = !hasAnyHighConfidenceParam;
        let retryCountAfterAttempt = currentRetryCount;

        if (shouldCountAsFailedAttempt) {
          // ✅ INCREMENT RETRY IF USER NOT ANSWERING PARAMETER
          retryCountAfterAttempt = await conversationStateService.incrementRetry(
            input.user_id,
            input.app_name
          );

          appLogger.warn('[SlotFillingStage] Missing params unresolved after user answer', {
            userId: input.user_id,
            appName: input.app_name,
            inputText: input.text,
            isAnsweringParam,
            hasAnyExtractedParam,
            hasAnyHighConfidenceParam,
            retryCount: retryCountAfterAttempt,
            maxRetry,
            stillMissing: stillMissingResources.map(m => ({ resource: m.resource, key: m.key, missing: m.missing }))
          });

          if (retryCountAfterAttempt >= maxRetry) {
            await conversationStateService.clear(input.user_id, input.app_name);
            return {
              shouldContinue: false,
              isComplete: false,
              retryExceeded: true,
              retryCount: retryCountAfterAttempt,
              maxRetry,
              reason: 'retry_exceeded'
            };
          }
        }

        // ✅ FIX #3 & #4: Batch update state with latest missing + collected params
        await conversationStateService.updateSlotState(
          input.user_id,
          input.app_name,
          {
            missingParams: stillMissingResources.flatMap(m => m.missing),
            collectedParams: this.sanitizeAutomationSlotParams(pending, { ...pending.collectedParams, ...newParams })
          }
        );

        // Continue slot filling - generate clarification question
        const question = this.isAutomationManagerPending(pending)
          ? automationClarificationService.buildQuestion(
              [...new Set(stillMissingResources.flatMap(item => item.missing))],
              mergedParams
            )
          : stillMissing.length > 0
            ? await clarificationService.askForMultipleParametersFromTools(
                agent ?? {} as Agent,
                input,
                stillMissing,
                input.language ?? 'Indonesia'
              )
            : await clarificationService.askForMultipleParametersFromResources(
                agent ?? {} as Agent,
                input,
                stillMissingResources,
                input.language ?? 'Indonesia'
              );

        const intentDisplayName = intents.length > 1
          ? intents.map((i: Intent) => i.slug).join(', ')
          : intents[0]?.slug || 'unknown';

        return {
          shouldContinue: true,
          isComplete: false,
          missingParams: stillMissingResources.map(m => ({ toolSlug: m.key, missing: m.missing })) as any,
          reason: 'still_missing',
          retryCount: retryCountAfterAttempt,
          maxRetry,
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
        plan: originalPlan,
        mergedParamsCount: Object.keys(mergedParams).length
      });

      const lastUserMessage = `${pending.lastUserMessage} ${input.text}`;

      // ✅ FIX #2: Execute with error handling
      try {
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

        return {
          shouldContinue: true,
          isComplete: true,
          collectedParams: mergedParams,
          reason: 'complete',
          result: PipelineFormatter.buildSuccessMulti(
            intentSlugs.join(',') || 'executed',
            1,
            apiResults,
            naturalResponse,
            startTotal
          )
        };
        
      } catch (execError) {
        // ✅ FIX #2: Handle execution error
        appLogger.error('[SlotFillingStage] Execution failed', {
          error: execError instanceof Error ? execError.message : execError,
          userId: input.user_id,
          appName: input.app_name
        });
        
        // Return error result
        return {
          shouldContinue: false,
          isComplete: false,
          reason: 'execution_failed',
          error: execError instanceof Error ? execError.message : 'Execution failed'
        };
      }

    } catch (err) {
      appLogger.error('[SlotFillingStage] Resume pending intent failed', {
        error: err instanceof Error ? err.message : err
      });

      return {
        shouldContinue: false,
        isComplete: false,
        reason: 'execution_failed',
        error: err instanceof Error ? err.message : 'Resume pending intent failed'
      };
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  private normalizeMissingResourceParams(pending: PendingIntentState): ResourceMissingParams[] {
    if (pending.missingResourceParams?.length) {
      return pending.missingResourceParams;
    }

    return (pending.missingToolsParams || []).map(item => ({
      resource: 'tool',
      key: item.toolSlug,
      name: item.toolName || item.toolSlug,
      missing: item.missing
    }));
  }

  private mergeIncrementalSlotParams(
    pending: PendingIntentState,
    newParams: Record<string, unknown>
  ): Record<string, unknown> {
    const merged = {
      ...pending.collectedParams,
      ...newParams
    };

    const isAutomationManager = this.isAutomationManagerPending(pending);

    if (isAutomationManager && isGenericAutomationGoal(merged.goal)) {
      delete merged.goal;
    }

    const previousSchedule = typeof pending.collectedParams?.schedule === 'string'
      ? pending.collectedParams.schedule.trim()
      : '';
    const nextSchedule = typeof newParams.schedule === 'string'
      ? newParams.schedule.trim()
      : '';

    if (
      isAutomationManager &&
      previousSchedule &&
      nextSchedule &&
      previousSchedule !== nextSchedule &&
      !this.scheduleTextContains(previousSchedule, nextSchedule)
    ) {
      merged.schedule = `${previousSchedule} ${nextSchedule}`.replace(/\s+/g, ' ').trim();
    }

    return merged;
  }

  private sanitizeAutomationSlotParams(
    pending: PendingIntentState,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    if (!this.isAutomationManagerPending(pending)) return params;

    const sanitized = { ...params };
    if (isGenericAutomationGoal(sanitized.goal)) {
      delete sanitized.goal;
    }
    return sanitized;
  }

  private isAutomationManagerPending(pending: PendingIntentState): boolean {
    return pending.originalPlan?.tasks?.some(task =>
      task.resource === 'skill' && task.key === 'automation_manager'
    ) || pending.missingResourceParams?.some(item =>
      item.resource === 'skill' && item.key === 'automation_manager'
    ) || pending.intentSlugs?.includes('automation_manager') || false;
  }

  private scheduleTextContains(source: string, fragment: string): boolean {
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalize(source).includes(normalize(fragment));
  }

  private toMissingToolsState(
    missingResourceParams: ResourceMissingParams[]
  ): Array<{ toolSlug: string; toolName?: string; missing: string[] }> {
    return missingResourceParams
      .filter(item => item.resource === 'tool')
      .map(item => ({
        toolSlug: item.key,
        toolName: item.name || item.key,
        missing: item.missing
      }));
  }

  private async getParamsForResource(item: ResourceMissingParams): Promise<ToolParam[]> {
    if (item.params?.length) {
      return item.params;
    }

    if (item.resource === 'tool') {
      const tool = await toolRepository.findBySlug(item.key);
      return tool ? toolService.getToolParams(tool) : [];
    }

    const skill = skillsRegistry.getSkillBySlug(item.key);
    return skill ? normalizeSkillParamsToToolParams(skill.paramSchema) : [];
  }

  private async getRelevantParams(
    missingResourceParams: ResourceMissingParams[],
    uniqueMissingNames: string[]
  ): Promise<ToolParam[]> {
    const relevantParams: ToolParam[] = [];
    const seenParams = new Set<string>();

    for (const missingResource of missingResourceParams) {
      const params = await this.getParamsForResource(missingResource);
      for (const param of params) {
        if (uniqueMissingNames.includes(param.name) && !seenParams.has(param.name)) {
          seenParams.add(param.name);
          relevantParams.push(param);
        }
      }
    }

    return relevantParams;
  }

  private getStillMissingResourceParams(
    missingResourceParams: ResourceMissingParams[],
    mergedParams: Record<string, unknown>
  ): ResourceMissingParams[] {
    return missingResourceParams
      .map(item => {
        const params = item.params || [];
        const missing = params.length > 0
          ? PipelineValidator.getMissingParamsFromTools(params, mergedParams)
              .filter(paramName => item.missing.includes(paramName))
          : item.missing.filter(paramName => !PipelineValidator.isMeaningfulValue(mergedParams[paramName]));

        return {
          ...item,
          missing
        };
      })
      .filter(item => item.missing.length > 0);
  }

  private async toToolMissingParams(
    missingResourceParams: ResourceMissingParams[]
  ): Promise<ToolMissingParams[]> {
    const missingTools: ToolMissingParams[] = [];

    for (const item of missingResourceParams.filter(resource => resource.resource === 'tool')) {
      const tool = await toolRepository.findBySlug(item.key);
      if (!tool) continue;

      missingTools.push({
        tool,
        missing: item.missing
      });
    }

    return missingTools;
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
    coreResult: { intent: string; metadata: PipelineMetadata; apiResult: unknown; naturalResponse: string; score: number },
    input: PipelineInput,
    agent: Agent,
    startTotal: number
  ): Promise<PipelineResult | undefined> {
    // Check if this is a slot filling response
    if (coreResult.intent !== 'slot_filling') {
      return undefined;
    }

    const maxRetry = config.slotFilling.maxRetry;

    // Extract missing params from metadata
    const missingParams = coreResult.metadata.missingParams || [];
    const missingResourceParams = coreResult.metadata.missingResourceParams || [];
    const collectedParams = coreResult.metadata.collectedParams || {};
    
    // C-009 FIX: Get intent slugs from metadata (passed from PipelineCore)
    const intentSlugsFromMetadata = coreResult.metadata.intentSlugs || [];

    // C-009 FIX: Get originalPlan from metadata (passed from PipelineCore)
    const originalPlanFromMetadata = coreResult.metadata.originalPlan;

    // Get intents for slot filling - use intentSlugs from metadata if available
    const intents = intentSlugsFromMetadata.length > 0
      ? intentRegistry.getBySlugs(intentSlugsFromMetadata, agent?.id)
      : intentRegistry.getAll({ agentId: agent?.id });

    // Get relevant intents for slot filling
    const relevantIntents = intents.filter(intent =>
      intent.tools?.some(t => missingParams.some(m => m.tool.slug === t.tool?.slug))
    );

    // Save state for slot filling
    const resolvedIntentSlugs = (relevantIntents.length > 0 ? relevantIntents : intents).map(i => i.slug);
    const fallbackIntentSlug =
      intentSlugsFromMetadata[0] ||
      originalPlanFromMetadata?.tasks?.find(task => task.resource === 'tool')?.key ||
      originalPlanFromMetadata?.tasks?.[0]?.key ||
      missingResourceParams[0]?.key ||
      missingParams[0]?.tool.slug ||
      'slot_filling';
    const intentSlugs = resolvedIntentSlugs.length > 0 ? resolvedIntentSlugs : [fallbackIntentSlug];
    
    await conversationStateService.set(input.user_id, input.app_name, {
      intentSlugs,
      missingToolsParams: missingParams.map(item => ({
        toolSlug: item.tool.slug,
        toolName: item.tool.name,
        missing: item.missing
      })) || [],
      missingResourceParams,
      collectedParams,
      lastUserMessage: input.text,
      maxRetry: maxRetry,
      isMultiIntent: intents.length > 1,
      // Use plan from metadata if available, otherwise fallback to empty plan
      originalPlan: originalPlanFromMetadata || { mode: 'single_step', chat: false, tasks: [] }
    });

    const isAutomationCoreSlotFilling = originalPlanFromMetadata?.tasks?.some(task =>
      task.resource === 'skill' && task.key === 'automation_manager'
    ) || missingResourceParams.some(item =>
      item.resource === 'skill' && item.key === 'automation_manager'
    ) || intentSlugs.includes('automation_manager');

    // Reuse PipelineCore question except for automation, where we need deterministic,
    // domain-neutral examples.
    const question = isAutomationCoreSlotFilling
      ? automationClarificationService.buildQuestion(
          [...new Set(missingResourceParams.flatMap(item => item.missing))],
          collectedParams
        )
      : coreResult.naturalResponse || await clarificationService.askForMultipleParametersFromResources(
          agent,
          input,
          missingResourceParams.length > 0
            ? missingResourceParams
            : missingParams.map(item => ({
                resource: 'tool',
                key: item.tool.slug,
                name: item.tool.name,
                missing: item.missing,
                params: item.tool.parameters || []
              })),
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
import { skillsRegistry } from '../../skills-registry.service';
import { normalizeSkillParamsToToolParams } from '../../../utils/resource-param-normalizer.util';
import { automationClarificationService } from '../../automation/automation-clarification.service';

const DEFAULT_TIMEOUT = 15000;
