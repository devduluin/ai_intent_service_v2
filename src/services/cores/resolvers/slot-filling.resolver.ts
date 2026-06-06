import type { Agent } from '../../../types/agent.types';
import type { PipelineInput, PendingIntentState, ToolParam, Intent, ToolMissingParams } from '../../../types';
import type { PlannerOutput } from '../../../types/planner.types';
import { conversationStateService } from '../../conversationState.service';
import { paramExtractorService, type ExtractedParamsWithConfidence } from '../../paramExtractor.service';
import { paramHydratorService } from '../../param-hydrator.service';
import { toolService } from '../../tools.service';
import { toolRepository } from '../../../repositories/tool.repository';
import { queryDecompositionService } from '../../query-decomposition.service';
import { clarificationService } from '../../clarification.service';
import { PipelineValidator } from '../../../utils/pipeline-validator.util';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { TemporalInjector } from '../injectors/temporal.injector';
import type { TemporalDetailWithDates } from '../injectors/temporal.injector';
import { appLogger } from '../../../utils/logger.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import { intentRegistry } from '../../intent-registry.service';
import { config } from '../../../config';

const DEFAULT_TIMEOUT = 15000;

// ============================================================
// Types
// ============================================================

export interface SlotFillingResult {
  shouldContinue: boolean;
  collectedParams: Record<string, unknown>;
  missingParams: ToolMissingParams[];
  question?: string;
  retryCount?: number;
}

export interface SlotFillingContext {
  intentSlugs: string[];
  collectedParams: Record<string, unknown>;
  lastUserMessage: string;
  maxRetry: number;
  currentRetry: number;
  originalPlan: PlannerOutput;
}

// ============================================================
// Slot Filling Resolver
// ============================================================

export class SlotFillingResolver {
  /**
   * Resume a pending intent with slot filling
   * 
   * This method:
   * 1. Resolves intents from slugs
   * 2. Extracts params from user input
   * 3. Merges with collected params
   * 4. Re-checks missing params
   * 5. Executes if complete, or continues slot filling
   */
  async resume(
    input: PipelineInput,
    pending: PendingIntentState,
    agent: Agent | null,
    startTotal: number,
    executeFn: (
      input: PipelineInput,
      plan: PlannerOutput,
      params: Record<string, unknown>
    ) => Promise<Record<string, unknown>>,
    naturalizeFn: (
      input: PipelineInput,
      apiResults: Record<string, unknown>,
      agent: Agent
    ) => Promise<string>
  ): Promise<{
    shouldContinue: boolean;
    result?: any;
  }> {
    appLogger.info('Resuming pending intent', {
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
        appLogger.error('No intents found for pending slugs', {
          intentSlugs
        });

        await conversationStateService.clear(input.user_id, input.app_name);
        return { shouldContinue: false };
      }

      // 2. Get missing tools params from state
      const missingToolsParams: Array<{ toolSlug: string; missing: string[] }> =
        pending.missingToolsParams || [];

      const allMissingParamNames = missingToolsParams.flatMap(m => m.missing);
      const uniqueMissingNames = [...new Set(allMissingParamNames)];

      // 3. Get parameter definitions from tools
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

      appLogger.debug('Relevant params for extraction', {
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

      appLogger.debug('Extracted params from user input', {
        params: newParams,
        confidences: paramConfidences,
        lowConfidenceParams
      });

      // 4.1 Extract temporal details from user input
      const decomposition = queryDecompositionService.decompose(input.text);
      const temporalDetails = decomposition.signals.temporalDetails || [];

      if (temporalDetails && temporalDetails.length > 0) {
        appLogger.info('Temporal context detected in slot filling', {
          temporalCount: temporalDetails.length,
          temporal: temporalDetails.map((t: any) => ({
            type: t.type,
            value: t.value,
            resolved: t.normalizedValue
          }))
        });

        const temporalInjector = new TemporalInjector();
        temporalInjector.inject(newParams, temporalDetails as TemporalDetailWithDates[]);

        appLogger.debug('Temporal params injected for slot filling', {
          params: newParams
        });
      }

      // Check if all params have low confidence (user input not relevant)
      const CONFIDENCE_THRESHOLD = 0.5;
      const hasAnyHighConfidenceParam = Object.values(paramConfidences).some(
        (conf: number) => conf >= CONFIDENCE_THRESHOLD
      );
      const hasAnyExtractedParam = Object.keys(newParams).length > 0;

      if (relevantParams.length > 0 && hasAnyExtractedParam && !hasAnyHighConfidenceParam) {
        appLogger.warn('All extracted params have low confidence - user input may not be relevant', {
          inputText: input.text,
          confidences: paramConfidences,
          lowConfidenceParams
        });

        await conversationStateService.clear(input.user_id, input.app_name);
        return { shouldContinue: false };
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
        tasks: [],
      };

      // 6. Branching: Still missing or complete?
      if (stillMissing.length > 0) {
        // Check if user is answering parameter or exiting flow
        const isAnsweringParam = PipelineValidator.isUserAnsweringParameter(input.text);

        if (!isAnsweringParam) {
          await conversationStateService.incrementRetry(input.user_id, input.app_name);
          const state = conversationStateService.get(input.user_id, input.app_name);

          if (!state) {
            await conversationStateService.clear(input.user_id, input.app_name);
            return { shouldContinue: false };
          }
        }

        // Continue slot filling
        const question = await clarificationService.askForMultipleParametersFromTools(
          agent ?? {} as Agent,
          input,
          stillMissing,
          input.language ?? 'Indonesia'
        );

        const intentDisplayName = intents.length > 1
          ? intents.map(i => i.slug).join(', ')
          : intents[0]?.slug || 'unknown';

        return {
          shouldContinue: true,
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

      appLogger.info('All params complete, executing', {
        plan: originalPlan
      });

      const lastUserMessage = `${pending.lastUserMessage} ${input.text}`;

      // Execute with originalPlan
      const apiResults = await withTimeout(
        executeFn(input, {
          ...originalPlan,
          mode: originalPlan.mode || 'single_step'
        } as PlannerOutput, mergedParams),
        DEFAULT_TIMEOUT,
        'executeSafePlan-resume'
      );

      const naturalizeInput: PipelineInput = {
        ...input,
        text: lastUserMessage
      };

      const naturalResponse = await withTimeout(
        naturalizeFn(naturalizeInput, apiResults, agent ?? {} as Agent),
        DEFAULT_TIMEOUT,
        'naturalize-resume'
      );

      return {
        shouldContinue: true,
        result: {
          apiResults,
          naturalResponse,
          intent: intentSlugs.join(','),
          params: mergedParams
        }
      };

    } catch (err) {
      appLogger.error('Resume pending intent failed', {
        error: err instanceof Error ? err.message : err
      });

      return { shouldContinue: false };
    }
  }

  /**
   * Handle missing parameters for tools
   * 
   * Saves state to conversation state service and returns clarification question
   */
  async handleMissingParams(
    agent: Agent,
    input: PipelineInput,
    intents: Intent[],
    missingToolsParams: ToolMissingParams[],
    collectedParams: Record<string, unknown>,
    originalPlan: PlannerOutput
  ): Promise<{
    question: string;
    intentDisplayName: string;
    state: SlotFillingContext;
  }> {
    const intentSlugs = intents.map(i => i.slug);

    // Save to conversation state
    await conversationStateService.set(input.user_id, input.app_name, {
      intentSlugs,
      missingToolsParams: missingToolsParams.map(item => ({
        toolSlug: item.tool.slug,
        toolName: item.tool.name,
        missing: item.missing
      })),
      collectedParams,
      lastUserMessage: input.text,
      maxRetry: config.slotFilling.maxRetry,
      isMultiIntent: intents.length > 1,
      originalPlan: {
        mode: originalPlan.mode || 'single_step',
        chat: originalPlan.chat ?? false,
        tasks: originalPlan.tasks || [],
      }
    });

    appLogger.info('Missing parameters detected for tools', {
      intentSlugs,
      missingTools: missingToolsParams.map(m => m.tool.slug)
    });

    appLogger.debug('Slot filling - missing params', {
      missing: missingToolsParams.map(m => ({ tool: m.tool.slug, missing: m.missing }))
    });

    const question = await clarificationService.askForMultipleParametersFromTools(
      agent,
      input,
      missingToolsParams,
      input.language ?? 'Indonesia'
    );

    const intentDisplayName = intents.length > 1
      ? intents.map((i: Intent) => i.slug).join(', ')
      : intents[0]?.slug || 'unknown';

    return {
      question,
      intentDisplayName,
      state: {
        intentSlugs,
        collectedParams,
        lastUserMessage: input.text,
        maxRetry: config.slotFilling.maxRetry,
        currentRetry: 0,
        originalPlan
      }
    };
  }
}
