import { ollamaService } from './ollama.service';

import { vectorService } from './vector.service';
import { intentRegistry } from './intent-registry.service';
import { paramExtractorService } from './paramExtractor.service';
import { clarificationService } from './clarification.service';
import { conversationStateService } from './conversationState.service';
import { generalChatService } from './generalChat.service';
import { paramCacheService } from './param-cache.service';
import { naturalizationService } from './naturalization.service';
import { queryDecompositionService } from './query-decomposition.service';

import { agentRepository } from '../repositories/agent.repository';
import { toolRepository } from '../repositories/tool.repository';

import { PipelineValidator } from '../utils/pipeline-validator.util';
import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { circuitBreaker } from '../utils/circuit-breaker.util';
import { ConversationUtil } from '../utils/conversation.util';
import { appLogger } from '../utils/logger.util';

import { embeddingCache } from './embedding-cache.service';
import { paramHydratorService } from './param-hydrator.service';
import { toolPlannerService } from './toolPlanner.service';
import { knowledgeHelper } from '../services/knowledge-helper.service';
import { toolService } from '../services/tools.service';
import { episodicMemoryService } from '../services/episodic-memory.service';
import { queryRewriteService } from '../services/query-rewrite.service';
import { confidenceDecisionService } from '../services/confidence-decision.service';

import { config } from '../config';
import type {
  PipelineInput,
  PipelineResult,
  ToolMissingParams,
  Intent,
  IntentMatch,
  PendingIntentState,
  ToolParam,
} from '../types';
import type { PlannerOutput } from "../types/planner.types"
import type { Agent } from '../types/agent.types';
import { executionContext } from '../utils/strategies/execution-context';
import { withRetry, withTimeout } from '../utils/async-helpers.util';
import { en } from 'zod/v4/locales';

// ============================================================
// Pipeline Metrics Interface
// ============================================================

interface PipelineMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  intentDistribution: Record<string, number>;
  fallbackToChatCount: number;
  slotFillingCount: number;
}

// ============================================================
// Constants & Configuration
// ============================================================

const DEFAULT_TIMEOUT = 15000; // 15 seconds for pipeline operations
const PLANNER_TIMEOUT = 20000; // 20 seconds for planner

// Multi-Intent Configuration
const ALLOW_CROSS_INTENT = true; // Allow multiple intents from decomposed queries
const MAX_INTENTS_PER_QUERY = 3;  // Maximum intents to process from multi-intent query

// ============================================================
// Pipeline Service Class
// ============================================================

class PipelineService {
  private metrics: PipelineMetrics = {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    averageDuration: 0,
    intentDistribution: {},
    fallbackToChatCount: 0,
    slotFillingCount: 0,
  };

  // ============================================================
  // PUBLIC ENTRYPOINT
  // ============================================================
  async run(input: PipelineInput): Promise<PipelineResult> {
    const startTotal = Date.now();
    this.metrics.totalRuns++;

    appLogger.info('Pipeline started', {
      userId: input.user_id,
      appName: input.app_name,
      textLength: input.text.length
    });

    try {
      // ============================================================
      // Get agent by slug from input.app_name
      // ============================================================
      const agent = await withRetry(
        () => this.getAgentBySlug(input.app_name),
        'getAgentBySlug'
      );

      try {
        PipelineValidator.validateAgent(agent, input.app_name);
      } catch (err: any) {
      
        this.metrics.failedRuns++;
        return PipelineFormatter.buildEarly({
          intent: 'error',
          score: 0,
          message: err.message
        }, startTotal);
      }

      // ============================================================
      // Cek apakah ada conversation state yang pending (slot filling)
      // ============================================================
      const pending = conversationStateService.get(input.user_id, input.app_name);

      // Clear state jika user mengirim pesan "cancel"
      if (input.text.toLowerCase() === 'cancel' || input.text.toLowerCase() === 'batal') {
        await conversationStateService.clear(input.user_id, input.app_name);
        appLogger.info('User cancelled pending intent', {
          userId: input.user_id,
          appName: input.app_name
        });

        this.metrics.successfulRuns++;
        return PipelineFormatter.buildEarly({
          intent: 'cancel',
          score: 1,
          message: 'Oke, permintaan sebelumnya sudah saya batalkan. Ada lagi yang bisa saya bantu?'
        }, startTotal);
      }

      if (pending) {
        appLogger.debug('Resuming pending intent', {
          userId: input.user_id,
          intentSlugs: pending.intentSlugs
        });

        this.metrics.slotFillingCount++;
        return await this.resumePendingIntent(input, pending, agent, startTotal);
      }

      // ============================================================
      // MAIN PIPELINE FLOW
      // ============================================================
      const result = await this.executeMainPipeline(input, agent, startTotal);

      this.updateAverageDuration(Date.now() - startTotal);

      // Track intent distribution
      const intentLabel = result.intent;
      this.metrics.intentDistribution[intentLabel] =
        (this.metrics.intentDistribution[intentLabel] || 0) + 1;

      return result;

    } catch (err) {
      this.metrics.failedRuns++;
      const duration = Date.now() - startTotal;

      appLogger.error('Pipeline failed', {
        userId: input.user_id,
        appName: input.app_name,
        error: err instanceof Error ? err.message : err,
        durationMs: duration
      });

      // Return error response instead of throwing
      return PipelineFormatter.buildEarly({
        intent: 'error',
        score: 0,
        message: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.'
      }, startTotal);
    }
  }

  // ============================================================
  // MAIN PIPELINE EXECUTION
  // ============================================================
  private async executeMainPipeline(
    input: PipelineInput,
    agent: Agent | null,
    startTotal: number
  ): Promise<PipelineResult> {
    try {
      const intents = intentRegistry.getAll({
        agentId: agent?.id
      });

      // ============================================================
      // GET EPISODIC MEMORY
      // ============================================================
      const episodicMemory = await episodicMemoryService.getLastContext(
        input.user_id,
        input.app_name
      );

      const recentTools = await episodicMemoryService.getToolUsageHints(
        input.user_id,
        input.app_name
      );

      // appLogger.debug('Memory context retrieved', {
      //   hasContext: !!episodicMemory,
      //   recentTools: recentTools
      // });

      // Safe agent casting with validation
      if (!agent) {
        appLogger.warn('Agent is null, using default behavior');
      }

      const rewrittenQuery = await queryRewriteService.rewriteWithMemory(
        agent ?? {} as Agent,
        episodicMemory?.summary || null,
        input
      );

      const enrichedUserQuery = rewrittenQuery;

      // appLogger.debug('Query enriched', {
      //   originalLength: input.text.length,
      //   enrichedQuery: enrichedUserQuery
      // });

      const orchestrationInput: PipelineInput = {
        ...input,
        text: enrichedUserQuery
      };

      // ============================================================
      // TEXT PRE-PROCESSING / Query Decomposition
      // ============================================================
      const decompositionResult = await withTimeout(
        this.preprocessTextWithDecomposition(enrichedUserQuery, agent?.id),
        DEFAULT_TIMEOUT,
        'preprocessTextWithDecomposition'
      );

      const preprocessedText = decompositionResult.text;
      const hasMultipleIntents = decompositionResult.hasMultipleIntents;
      const subQueries = decompositionResult.subQueries;
      const connectors = decompositionResult.connectors;
      const decompositionReason = decompositionResult.reason;
      const confidence = decompositionResult.confidence;
      const signals = decompositionResult.signals;

      // appLogger.debug('Query decomposition completed', {
      //   originalText: input.text,
      //   preprocessedText,
      //   hasMultipleIntents,
      //   subQueries: subQueries,
      //   connectors,
      //   reason: decompositionReason,
      //   confidence,
      //   signals,
      //   allowCrossIntent: ALLOW_CROSS_INTENT
      // });

      // ============================================================
      // EMBEDDING & VECTOR MATCHING
      // Optimized flow: Prioritize hasMultipleIntents detection
      // - If hasMultipleIntents=true: Process sub-queries directly (skip primary matching)
      // - If hasMultipleIntents=false: Use single intent matching
      // ============================================================
      let finalVectorHints: IntentMatch[] = [];
      // const embeddingText = input.text; // Use original input text for accurate intent matching

      // ============================================================
      // APPLY SIGNALS TO ENHANCE INTENT MATCHING
      // ============================================================
      // Use action hints to boost matching for specific intents
      const actionHints = signals.actions || [];
      const formatHints = signals.formats || [];
      const temporalDetails = signals.temporalDetails || [];
      const entityHints = (signals as any).entityHints || [];

      appLogger.debug('Signals extracted from query', {
        actions: actionHints,
        formats: formatHints,
        temporal: temporalDetails?.map((t: any) => `${t.value} → ${t.normalizedValue}`),
        entities: entityHints,
        asksForFile: signals.asksForFile,
        asksForRealtimeData: signals.asksForRealtimeData
      });

      // ============================================================
      // BRANCH 1: MULTI-INTENT MODE (hasMultipleIntents = true)
      // ============================================================
      if (hasMultipleIntents && ALLOW_CROSS_INTENT && subQueries.length > 0) {
        appLogger.info('Multi-intent mode: Processing sub-queries directly', {
          subQueriesCount: subQueries.length,
          subQueries,
          reason: decompositionReason
        });

        // Process sub-queries directly without primary matching (optimization)
        const allMatches = await this.processMultiIntentQueries(
          subQueries,
          intents,
          agent,
          MAX_INTENTS_PER_QUERY
        );

        // Boost scores based on format hints (e.g., if user mentions "excel", boost xls_generator)
        const boostedMatches = this.applySignalBoost(allMatches, {
          actions: actionHints,
          formats: formatHints,
          asksForFile: signals.asksForFile
        });

        appLogger.debug('Multi-intent processing completed', {
          totalMatches: boostedMatches.length,
          source: 'sub_queries_direct'
        });

        finalVectorHints = boostedMatches.length > 0 ? boostedMatches : [];

      }
      // ============================================================
      // BRANCH 2: SINGLE INTENT MODE (hasMultipleIntents = false)
      // ============================================================
      else {
        appLogger.debug('Single-intent mode: Using primary vector matching', {
          hasMultipleIntents,
          allowCrossIntent: ALLOW_CROSS_INTENT
        });

        // Single embedding + vector match
        const queryEmbedding = await withTimeout(
          this.embedQuery(enrichedUserQuery, agent?.id),
          DEFAULT_TIMEOUT,
          'embedQuery'
        );

        const vectorHints = await withTimeout(
          vectorService.findIntent(queryEmbedding, intents, agent as Agent),
          DEFAULT_TIMEOUT,
          'findIntent'
        );

        // Boost scores based on signals
        const boostedHints = this.applySignalBoost(vectorHints, {
          actions: actionHints,
          formats: formatHints,
          asksForFile: signals.asksForFile
        });

        appLogger.debug('Vector matching completed with signal boost', {
          matchCount: boostedHints.length,
          topScore: boostedHints[0]?.score ?? 0,
          intentRegistry: boostedHints,
          appliedBoosts: {
            actions: actionHints.length > 0,
            formats: formatHints.length > 0
          }
        });

        // If cross-intent disabled or high confidence, use primary matches
        if (!ALLOW_CROSS_INTENT) {
          appLogger.debug('Cross-intent disabled, using top 3 matches only');
          finalVectorHints = boostedHints.slice(0, 3);
        } else {
          finalVectorHints = boostedHints;
        }
      }

      appLogger.debug('Final vector hints', {
        queryUser: enrichedUserQuery,
        matchCount: finalVectorHints.length,
        topScore: finalVectorHints[0]?.score ?? 0,
        intentRegistry: finalVectorHints,
        source: hasMultipleIntents ? 'multi_intent' : 'single_intent'
      });

      // ============================================================
      // PLANNER INTENT
      // ============================================================
      const plannerOutput = await withTimeout(
        this.plannerIntent(agent as Agent, signals, recentTools, finalVectorHints, {
          ...orchestrationInput
        }, true),
        PLANNER_TIMEOUT,
        'plannerIntent'
      );

      appLogger.debug('Planner output', {
        task: plannerOutput.tasks,
        chat: plannerOutput.chat
      });

      // ============================================
      // CONFIDENCE DECISION ENGINE
      // ============================================
      const decision = confidenceDecisionService.evaluate(
        plannerOutput,
        enrichedUserQuery
      );

      appLogger.debug('Confidence decision', {
        action: decision.action,
        confidence: decision.confidence
      });

      // LOW CONFIDENCE → CHAT
      // if (decision.action === 'chat') {
      //   this.metrics.fallbackToChatCount++;
      //   return await this.handlePureChat(
      //     agent as Agent,
      //     input,
      //     startTotal
      //   );
      // }

      if (decision.action === 'chat') {
        this.metrics.fallbackToChatCount++;
        return await this.handlePureChat(
          agent as Agent,
          input,
          startTotal
        );
      }

      // ============================================
      // VALIDATE SAFE PLAN
      // ============================================
      const safePlan: PlannerOutput = {
        mode: plannerOutput.mode || 'single_step',
        tasks: plannerOutput.tasks || [],
        chat: plannerOutput.chat === true
      };

      if (safePlan.chat === true && safePlan.tasks.length === 0) {
        this.metrics.fallbackToChatCount++;
        return await this.handlePureChat(
          agent as Agent,
          input,
          startTotal
        );
      }

      appLogger.debug('Safe plan validated', {
        mode: safePlan.mode,
        tasks: safePlan.tasks,
        chat: safePlan.chat
      });


      // ============================================================
      // PARAM EXTRACTION FOR SAFEPLAN.TOOLS
      // ============================================================
      let safeParams: Record<string, unknown> = {};

      // Inject temporal context into parameters for date filtering
      if (temporalDetails && temporalDetails.length > 0) {
        appLogger.info('Temporal context detected, injecting into params', {
          temporalCount: temporalDetails.length,
          temporal: temporalDetails.map((t: any) => ({
            type: t.type,
            value: t.value,
            resolved: t.normalizedValue,
            startDate: t.startDate,
            endDate: t.endDate
          }))
        });

        // Add temporal context to input for downstream handlers
        input.temporalContext = temporalDetails.map((t: any) => ({
          type: t.type,
          value: t.value,
          resolvedValue: t.normalizedValue,
          startDate: t.startDate?.toISOString(),
          endDate: t.endDate?.toISOString(),
          direction: t.direction
        }));
      }

      // Inject entity context (locations, names, etc.)
      if (entityHints && entityHints.length > 0) {
        appLogger.debug('Entity hints detected, injecting into params', {
          entities: entityHints
        });

        input.entityContext = entityHints;
      }

      if (safePlan.tasks && safePlan.tasks.map(t => t.resource).includes('tool')) {
        const toolsToExecute = safePlan.tasks
          .filter(t => t.resource === 'tool')
          .map(t => t.key);

        appLogger.debug('Extracting parameters for tools', {
          tools: toolsToExecute
        });

        const extractedParams = await this.extractParamsForTools(
          enrichedUserQuery,
          toolsToExecute
        );

        // Hydrate dengan user attributes
        safeParams = paramHydratorService.hydrate(
          extractedParams,
          input.attributes ?? {}
        );

        // CEK MISSING PARAMS
        const allTools = await toolService.getToolsBySlugs(toolsToExecute);
        const missingToolsParams = await toolService.getMissingParamsForTools(
          allTools,
          safeParams
        );

        // Jika ada missing params, handle slot filling
        if (missingToolsParams.length > 0) {
          appLogger.debug('Missing parameters detected', {
            missingCount: missingToolsParams.length,
            tools: missingToolsParams.map(m => m.tool.slug)
          });

          // Cari intents yang memiliki tools ini untuk konteks slot filling
          const relevantIntents = intents.filter(intent =>
            intent.tools?.some(t => toolsToExecute.includes(t.tool?.slug))
          );

          return this.handleMissingParametersForTools(
            agent as Agent,
            input,
            relevantIntents.length > 0 ? relevantIntents : intents,
            missingToolsParams,
            safeParams,
            startTotal,
            safePlan
          );
        }
      }

      // ============================================================
      // EKSEKUSI INTENTS (HANDLERS, TOOLS, KNOWLEDGE)
      // ============================================================
      const apiResults = await withTimeout(
        this.executeSafePlan(orchestrationInput, safePlan, safeParams),
        DEFAULT_TIMEOUT,
        'executeSafePlan'
      );

      appLogger.debug('API execution completed', {
        resultKeys: Object.keys(apiResults)
      });

      

      // ============================================================
      // NATURALIZE RESPONSE
      // ============================================================
      const naturalResponse = await withTimeout(
        this.naturalize(
          { ...input, text: enrichedUserQuery },
          apiResults,
          agent as Agent
        ),
        DEFAULT_TIMEOUT,
        'naturalize'
      );

      const intentLabel = [
        ...(safePlan.tasks.map(t => t.key) || []),
      ].join(',');

      // ============================================================
      // STORE EPISODIC MEMORY
      // ============================================================
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: naturalResponse
      });

      const summary = await episodicMemoryService.summarize(
        agent as Agent,
        (finalVectorHints[0]?.intent.slug as string || episodicMemory?.intent ||null),
        input.user_id,
        input.app_name,
        messages,
        {
          ...safePlan,
          mode: safePlan.mode || 'single_step'
        } as PlannerOutput
      );

      appLogger.debug('Episodic memory stored', {
        summary: summary
      });

      // ============================================================
      // RETURN RESULT
      // ============================================================
      return PipelineFormatter.buildSuccessMulti(
        intentLabel || 'unknown',
        1,
        apiResults,
        naturalResponse,
        startTotal
      );

    } catch (err) {
      appLogger.error('Main pipeline execution failed', {
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined
      });
      throw err;
    }
  }

  // ============================================================
  // STAGE 0 — RESUME CONVERSATION (slot filling)
  // ============================================================
  private async resumePendingIntent(
    input: PipelineInput,
    pending: PendingIntentState,
    agent: Agent | null,
    startTotal: number
  ): Promise<PipelineResult> {
    appLogger.info('Resuming pending intent', {
      userId: input.user_id,
      text: input.text,
      oldText: pending.lastUserMessage,
      intentSlugs: pending.intentSlugs,
      missingCount: pending.missingToolsParams?.length
    });

    try {
      // ============================================================
      // 1. RESOLVE INTENTS dari slugs
      // ============================================================
      const intentSlugs: string[] = pending.intentSlugs || [];
      const intents = intentRegistry.getBySlugs(intentSlugs, agent?.id);

      if (!intents.length) {
        appLogger.error('No intents found for pending slugs', {
          intentSlugs
        });

        await conversationStateService.clear(input.user_id, input.app_name);

        return await this.handlePureChat(
          agent as Agent,
          input,
          // null,
          startTotal
        );
      }

      // ============================================================
      // 2. GET MISSING TOOLS PARAMS FROM STATE
      // ============================================================
      const missingToolsParams: Array<{ toolSlug: string; missing: string[] }> =
        pending.missingToolsParams || [];

      const allMissingParamNames = missingToolsParams.flatMap(m => m.missing);
      const uniqueMissingNames = [...new Set(allMissingParamNames)];

      // ============================================================
      // 3. Ambil parameter definitions dari tools yang missing
      // ============================================================
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

      // ============================================================
      // 4. Extract params dari user input
      // ============================================================
      const newParams = await paramExtractorService.extractAll(
        input.text,
        relevantParams
      );

      // Merge dengan collected params sebelumnya
      const mergedParams = paramHydratorService.hydrate(
        {
          ...pending.collectedParams,
          ...newParams
        },
        input.attributes
      );

      // appLogger.debug('Merged params', {
      //   paramCount: Object.keys(mergedParams).length
      // });

      // ============================================================
      // 5. RE-CHECK missing params untuk semua tools
      // ============================================================
      const toolSlugsFromState = [...new Set(missingToolsParams.map(m => m.toolSlug))];
      const allTools = await toolService.getToolsBySlugs(toolSlugsFromState);
      const stillMissing = await toolService.getMissingParamsForTools(allTools, mergedParams);

      // appLogger.debug('Still missing params', {
      //   missing: stillMissing.map(m => ({ tool: m.tool.slug, missing: m.missing }))
      // });

      // IMPORTANT: Gunakan originalPlan yang lengkap (tools + knowledge)
      const originalPlan = pending.originalPlan || {
        mode: 'single_step',
        chat: false,
        tasks: [],
      };

      // ============================================================
      // 6. BRANCHING: Masih ada missing atau sudah lengkap?
      // ============================================================
      if (stillMissing.length > 0) {
        // Cek apakah user benar-benar menjawab parameter atau keluar flow
        const isAnsweringParam = PipelineValidator.isUserAnsweringParameter(input.text);

        if (!isAnsweringParam) {
          await conversationStateService.incrementRetry(input.user_id, input.app_name);
          const state = conversationStateService.get(input.user_id, input.app_name);

          if (!state) {
            await conversationStateService.clear(input.user_id, input.app_name);
            return await this.handlePureChat(
              agent ?? {} as Agent,
              input,
              startTotal
            );
          }
        }

        // Lanjutkan slot filling
        return this.handleMissingParametersForTools(
          agent ?? {} as Agent,
          input,
          intents,
          stillMissing,
          mergedParams,
          startTotal,
          {
            ...originalPlan,
            mode: originalPlan.mode || 'single_step'
          } as PlannerOutput
        );
      }

      // ============ SEMUA PARAMETER LENGKAP → EKSEKUSI ============
      await conversationStateService.clear(input.user_id, input.app_name);

      // appLogger.info('All params complete, executing', {
      //   plan: originalPlan
      // });

      const lastUserMessage = `${pending.lastUserMessage} ${input.text}`;

      // Execute dengan originalPlan yang lengkap (tools + knowledge)
      // Circuit breaker already applied in executeSafePlan -> executeTasksWithDependencies
      const apiResults = await withTimeout(
        this.executeSafePlan(input, {
          ...originalPlan,
          mode: originalPlan.mode || 'single_step'
        } as PlannerOutput, mergedParams),
        DEFAULT_TIMEOUT,
        'executeSafePlan-resume'
      );

      const naturalizeInput: PipelineInput = {
        ...input,
        text: lastUserMessage // ← Gunakan pertanyaan asli
      };

      const naturalResponse = await withTimeout(
        this.naturalize(naturalizeInput, apiResults, agent ?? {} as Agent),
        DEFAULT_TIMEOUT,
        'naturalize-resume'
      );

      const intentLabel = [
        ...(originalPlan.tasks.map(t => t.key) || []),
      ].join(',');

      return PipelineFormatter.buildSuccessMulti(
        intentLabel || 'executed',
        1,
        apiResults,
        naturalResponse,
        startTotal
      );

    } catch (err) {
      appLogger.error('Resume pending intent failed', {
        error: err instanceof Error ? err.message : err
      });

      // Return error response instead of throwing (consistent with main pipeline)
      return PipelineFormatter.buildEarly({
        intent: 'error',
        score: 0,
        message: 'Maaf, terjadi kesalahan saat melanjutkan permintaan Anda.'
      }, startTotal);
    }
  }

  // ============================================================
  // STAGE 1 — EMBEDDING (OPTIMIZED)
  // ============================================================
  private async embedQuery(text: string, agentId?: string): Promise<number[]> {
    try {
      const normalizedText = text.toLowerCase().trim();

      // Quick path: no cache
      if (!config.cache.enableEmbeddingCache) {
        return await ollamaService.embed(normalizedText);
      }

      // Use cache with circuit breaker protection
      return await embeddingCache.getOrCompute(
        normalizedText,
        () => circuitBreaker.call(() => ollamaService.embed(normalizedText)),
        agentId,
        config.cache.embeddingTTL
      );
    } catch (err) {
      appLogger.error('Embedding generation failed', {
        error: err instanceof Error ? err.message : err,
        textLength: text.length
      });
      throw PipelineFormatter.buildError('embed', 'Gagal generate embedding', err);
    }
  }

  // ============================================================
  // STAGE 2 — INTENT MATCHING VECTOR AND PLANNER
  // ============================================================
  private async plannerIntent(
    agent: Agent,
    signals: {
      actions: string[];
      formats: string[];
      asksForFile: boolean;
      asksForRealtimeData: boolean;
    },
    recentUsage: PlannerOutput,
    matches: IntentMatch[],
    input: PipelineInput,
    usePlan: boolean = true
  ): Promise<PlannerOutput> {
    const hasMatches = matches && matches.length > 0;
    const hasRecentUsage =
      recentUsage &&
      (recentUsage.tasks?.length);

    // ==========================================================
    // EARLY EXIT — PURE CHAT (NO MATCH + NO MEMORY)
    // ==========================================================
    if (!hasMatches && !hasRecentUsage) {
      appLogger.debug('No matches & no memory → PURE CHAT');
      return {
        "mode": "single_step",
        "chat": true,
        "tasks": []
      };
    }

    const matchedIntents = matches.map(m => m.intent);

    const handlerIntents = matchedIntents
      .filter(m => m.executionType === 'handler')
      .map(m => m);

    const toolIntents = matchedIntents
      .filter(m => m.tools && m.tools.length > 0)
      .map(m => m);

    const knowledgeIntents = matchedIntents
      .filter(m => m.knowledge && m.knowledge.length > 0)
      .map(m => m);

    // ----------------------------------------------------------
    // BUILD HANDLER CANDIDATES
    // ----------------------------------------------------------
    const handlerForPrompt = handlerIntents.flatMap(intent => ({
      slug: intent.slug,
      name: intent.name,
      description: intent.description,
      intentSlug: intent.slug,
      intentName: intent.name,
      handlerKey: intent.handlerKey
    }));

    // ----------------------------------------------------------
    // BUILD TOOL CANDIDATES
    // ----------------------------------------------------------
    const toolsForPrompt = toolIntents.flatMap(intent => {
      return (intent.tools || []).map((t: any) => {
        const toolData = t.tool || t;
        return {
          slug: toolData.slug,
          name: toolData.name,
          description: toolData.description,
          intentSlug: intent.slug,
          intentName: intent.name,
          handlerKey: intent.handlerKey
        };
      });
    });

    // ----------------------------------------------------------
    // BUILD KNOWLEDGE CANDIDATES
    // ----------------------------------------------------------
    const knowledgeForPrompt = knowledgeIntents.flatMap(intent => {
      return (intent.knowledge || []).map((k: any) => {
        const knowledgeData = k.knowledge || k;
        return {
          slug: knowledgeData.slug,
          name: knowledgeData.title || knowledgeData.slug,
          description:
            knowledgeData.description ||
            knowledgeData.title ||
            knowledgeData.slug,
          intentSlug: intent.slug,
          intentName: intent.name,
          handlerKey: intent.handlerKey
        };
      });
    });

    const uniqueHandler = [
      ...new Map(handlerForPrompt.map(h => [h.slug, h])).values()
    ];

    const uniqueTools = [
      ...new Map(toolsForPrompt.map(t => [t.slug, t])).values()
    ];

    const uniqueKnowledge = [
      ...new Map(knowledgeForPrompt.map(k => [k.slug, k])).values()
    ];

    appLogger.debug('Intent candidates', {
      handlers: uniqueHandler.map(h => h.slug),
      tools: uniqueTools.map(t => t.slug),
      knowledge: uniqueKnowledge.map(k => k.slug)
    });

    const totalCandidates = uniqueHandler.length + uniqueTools.length + uniqueKnowledge.length;
    if (totalCandidates === 0) {
      return {
        mode: 'single_step',
        chat: true,
        tasks: []
      };
    }

    // ==========================================================
    // FAST PATH (SKIP PLANNER)
    // ==========================================================
    // 0️⃣ ONLY ONE HANDLER → DIRECT EXECUTION
    if (uniqueHandler.length === 1 && uniqueTools.length === 0 && uniqueKnowledge.length === 0) {
      appLogger.debug('Single handler detected → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: `1`,
            resource: 'handler',
            key: uniqueHandler[0].slug,
            depends_on: []
          }
        ]
      };
    };

    // 1️⃣ ONLY ONE TOOL → DIRECT EXECUTION
    if (uniqueTools.length === 1 && uniqueHandler.length === 0 && uniqueKnowledge.length === 0) {
      appLogger.debug('Single tool detected → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: `1`,
            resource: 'tool',
            key: uniqueTools[0].slug,
            depends_on: []
          }
        ]
      };
    }

    // 2️⃣ ONLY ONE KNOWLEDGE → DIRECT EXECUTION
    if (uniqueKnowledge.length === 1 && uniqueHandler.length === 0 && uniqueTools.length === 0) {
      appLogger.debug('Single knowledge detected → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: `1`,
            resource: 'knowledge',
            key: uniqueKnowledge[0].slug,
            depends_on: []
          }
        ]
      };
    }

    // 3️⃣ Planner disabled → run all candidates
    if (!usePlan) {
      appLogger.debug('Planner disabled → run all candidates');
      return {
        mode: 'multi_step',
        chat: uniqueTools.length === 0 && uniqueKnowledge.length === 0 && uniqueHandler.length === 0,
        tasks: [
          ...uniqueHandler.map((h, index) => ({
            id: `${index + 1}`,
            resource: 'handler' as const,
            key: h.slug,
            depends_on: []
          })),
          ...uniqueTools.map((t, index) => ({
            id: `${uniqueHandler.length + index + 1}`,
            resource: 'tool' as const,
            key: t.slug,
            depends_on: []
          })),
          ...uniqueKnowledge.map((k, index) => ({
            id: `${uniqueHandler.length + uniqueTools.length + index + 1}`,
            resource: 'knowledge' as const,
            key: k.slug,
            depends_on: []
          }))
        ]
      };
    };
    
    // ==========================================================
    // CALL LLM PLANNER (MULTI CANDIDATE)
    // ==========================================================
    appLogger.debug('Multiple candidates → calling planner');

    const plan = await withTimeout(
      toolPlannerService.plan({
        userText: input.text,
        candidates: {
          handlers: uniqueHandler.map(h => h.slug),
          tools: uniqueTools.map(t => t.slug),
          knowledge: uniqueKnowledge.map(k => k.slug),
          handlerDetails: uniqueHandler,
          toolsDetails: uniqueTools,
          knowledgeDetails: uniqueKnowledge
        },
        recentUsage,
        language: input.language
      }),
      PLANNER_TIMEOUT,
      'toolPlannerService.plan'
    );

    appLogger.debug('Planner returned plan', {
      plan
    });

    return plan;
  }

  // ============================================================
  // STAGE 3 — PARAM EXTRACTION
  // ============================================================
  private async extractParamsForTools(
    text: string,
    toolSlugs: string[]
  ): Promise<Record<string, unknown>> {
    if (!toolSlugs.length) return {};

    return await paramCacheService.getOrExtract(
      text,
      toolSlugs,
      async (text, params) => {
        return await paramExtractorService.extractAll(text, params);
      }
    );
  }

  // ============================================================
  // STAGE 0.5 — TEXT PRE-PROCESSING / QUERY DECOMPOSITION
  // ============================================================
  private async preprocessTextWithDecomposition(
    text: string,
    agentId?: string
  ): Promise<{
    text: string;
    hasMultipleIntents: boolean;
    subQueries: string[];
    connectors: string[];
    reason: string;
    confidence: number;
    signals: {
      temporalHints: string[];
      temporalDetails: any;
      actions: string[];
      formats: string[];
      asksForFile: boolean;
      asksForRealtimeData: boolean;
    };
  }> {
    try {
      const decomposition = queryDecompositionService.decompose(text);

      return {
        text: decomposition.normalizedQuery || decomposition.originalQuery,
        hasMultipleIntents: decomposition.hasMultipleIntents,
        subQueries: decomposition.subQueries,
        connectors: decomposition.connectors,
        reason: decomposition.reason,
        confidence: decomposition.confidence,
        signals: {
          temporalHints: decomposition.signals.temporalHints,
          temporalDetails: decomposition.signals.temporalDetails,
          actions: decomposition.signals.actionHints,
          formats: decomposition.signals.formatHints,
          asksForFile: decomposition.signals.asksForFile,
          asksForRealtimeData: decomposition.signals.asksForRealtimeData
        }
      };

    } catch (error) {
      appLogger.error('Query decomposition failed', {
        error: error instanceof Error ? error.message : error,
        textLength: text.length
      });

      // Fallback to original text
      return {
        text,
        hasMultipleIntents: false,
        subQueries: [text],
        connectors: [],
        reason: 'fallback_original',
        confidence: 0,
        signals: {
          temporalHints: [],
          temporalDetails: [],
          actions: [],
          formats: [],
          asksForFile: false,
          asksForRealtimeData: false
        }
      };
    }
  }

  // ============================================================
  // MULTI-INTENT QUERY PROCESSING
  // ============================================================
  private async processMultiIntentQueries(
    subQueries: string[],
    intents: Intent[],
    agent: Agent | null,
    maxIntents: number = MAX_INTENTS_PER_QUERY
  ): Promise<IntentMatch[]> {
    const allMatches: IntentMatch[] = [];
    const processedIntents = new Set<string>();

    // Process each sub-query
    for (const query of subQueries) {
      try {
        
        // Embed sub-query
          const embedding = await withTimeout(
            this.embedQuery(query, agent?.id),
            5000,
            `embedQuery:${query.substring(0, 30)}`
          );

        // Find intent matches for this sub-query
        const matches = await vectorService.findIntent(
          embedding,
          intents,
          agent as Agent,
          3  // Get top 3 matches per sub-query
        );

        appLogger.debug('Sub-query matches', {
          query,
          matchCount: matches.length
        });

        // Add unique matches (avoid duplicates)
        for (const match of matches) {
          const intentId = match.intent.id;
          
          if (!processedIntents.has(intentId)) {
            processedIntents.add(intentId);
            allMatches.push(match);
          }
        }

        // Stop if we have enough intents
        if (allMatches.length >= maxIntents) {
          break;
        }

      } catch (error) {
        appLogger.warn('Failed to process sub-query', {
          query,
          error: error instanceof Error ? error.message : error
        });
        // Continue with next sub-query
      }
    }

    // Sort all matches by score
    allMatches.sort((a, b) => b.score - a.score);

    // Return top matches up to maxIntents
    const result = allMatches.slice(0, maxIntents);

    appLogger.info('Multi-intent processing completed', {
      totalSubQueries: subQueries.length,
      totalMatches: allMatches.length,
      returnedMatches: result.length
    });

    return result;
  }

  // ============================================================
  // STAGE 4 — EXECUTE SAFEPLAN HARUS BISA PARALEL DAN DEPENDING CHAIN
  // ============================================================

  // ============================================================
  // HELPER: APPLY SIGNAL BOOST TO INTENT MATCHES
  // ============================================================
  /**
   * Boost intent match scores based on detected signals
   * - Format hints (excel, csv) boost xls_generator intent
   * - Action hints (cek, buat, export) boost relevant intents
   * - asksForFile boosts file-related intents
   */
  private applySignalBoost(
    matches: IntentMatch[],
    signals: {
      actions: string[]
      formats: string[]
      asksForFile: boolean
    }
  ): IntentMatch[] {
    const BOOST_MULTIPLIER = 1.15; // 15% boost
    const MAX_SCORE = 1.0;

    return matches.map(match => {
      let boostFactor = 1.0;
      const appliedBoosts: string[] = [];

      const intentSlug = match.intent.slug.toLowerCase();

      // Format-based boosts
      if (signals.formats.includes('xlsx') || signals.formats.includes('csv')) {
        if (intentSlug.includes('xls') || intentSlug.includes('excel') || intentSlug.includes('export')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push(`format:${signals.formats.join(',')}`);
        }
      }

      // File-related boosts
      if (signals.asksForFile) {
        if (intentSlug.includes('xls') || intentSlug.includes('export') || intentSlug.includes('download')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push('asksForFile');
        }
      }

      // Action-based boosts
      if (signals.actions.includes('buat') || signals.actions.includes('generate')) {
        if (intentSlug.includes('xls') || intentSlug.includes('generator') || intentSlug.includes('export')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push('action:generate');
        }
      }

      // Apply boost and cap at 1.0
      const boostedScore = Math.min(match.score * boostFactor, MAX_SCORE);

      if (appliedBoosts.length > 0) {
        appLogger.debug(`Intent score boosted: ${match.intent.slug}`, {
          originalScore: match.score,
          boostedScore,
          boostFactor,
          appliedBoosts
        });
      }

      return {
        ...match,
        score: boostedScore
      };
    }).sort((a, b) => b.score - a.score); // Re-sort by boosted score
  }

  // ============================================================
  // NEW: Execute tasks with dependency chain support
  // ============================================================
  private async executeTasksWithDependencies(
    tasks: Array<{
      id: string
      resource: "tool" | "handler" | "knowledge"
      key: string
      depends_on: string[]
    }>,
    input: PipelineInput,
    context: any,
    initialParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    const taskResults: Map<string, unknown> = new Map();
    const executedTasks = new Set<string>();
    const failedTasks = new Set<string>();

    appLogger.info('Starting chained task execution', {
      totalTasks: tasks.length,
      tasks: tasks.map(t => ({ id: t.id, resource: t.resource, key: t.key }))
    });

    // Topological sort untuk menentukan execution order
    const sortedTasks = this.topologicalSortTasks(tasks);

    appLogger.debug('Tasks sorted for execution', {
      order: sortedTasks.map(t => t.id)
    });

    // Execute tasks in order
    for (const task of sortedTasks) {
      try {
        // Wait for dependencies to complete
        if (task.depends_on.length > 0) {
          const missingDeps = task.depends_on.filter(depId => !executedTasks.has(depId));
          if (missingDeps.length > 0) {
            throw new Error(`Missing dependencies: ${missingDeps.join(', ')}`);
          }

          const failedDeps = task.depends_on.filter(depId => failedTasks.has(depId));
          if (failedDeps.length > 0) {
            results[task.key] = {
              error: `Skipped because dependencies failed: ${failedDeps.join(', ')}`,
              skipped: true
            };
            executedTasks.add(task.id);
            failedTasks.add(task.id);
            continue;
          }
        }

        // Gather results from dependencies
        const dependencyResults: Record<string, unknown> = {};
        for (const depId of task.depends_on) {
          const depResult = taskResults.get(depId);
          if (depResult !== undefined) {
            dependencyResults[depId] = depResult;
          }
        }

        // Merge dependency results with initial params
        const taskParams = {
          ...initialParams,
          ...dependencyResults
        };

        appLogger.debug(`Executing task ${task.id}`, {
          resource: task.resource,
          key: task.key,
          dependsOn: task.depends_on,
          hasDependencyResults: Object.keys(dependencyResults).length > 0
        });

        // Execute task based on resource type
        let taskResult: unknown;

        if (task.resource === 'tool') {
          taskResult = await this.executeToolTask(task, input, context, taskParams);
        } else if (task.resource === 'handler') {
          taskResult = await this.executeHandlerTask(task, input, context, taskParams);
        } else if (task.resource === 'knowledge') {
          taskResult = await this.executeKnowledgeTask(task, input, context, taskParams);
        } else {
          throw new Error(`Unknown resource type: ${task.resource}`);
        }

        // Store result
        taskResults.set(task.id, taskResult);
        results[task.key] = taskResult;
        executedTasks.add(task.id);

        // appLogger.info(`Task ${task.id} completed`, {
        //   key: task.key,
        //   hasResult: taskResult !== undefined
        // });

      } catch (error) {
        appLogger.error(`Task ${task.id} failed`, {
          error: error instanceof Error ? error.message : error,
          task
        });

        // Store error but continue with other tasks
        results[task.key] = {
          error: error instanceof Error ? error.message : 'Task execution failed'
        };
        executedTasks.add(task.id);
        failedTasks.add(task.id);
      }
    }

    appLogger.info('Chained task execution completed', {
      totalTasks: tasks.length,
      executedTasks: executedTasks.size,
      failedTasks: failedTasks.size,
      resultKeys: Object.keys(results)
    });

    return results;
  }

  // ============================================================
  // TOPOLOGICAL SORT FOR TASK DEPENDENCIES
  // ============================================================
  private topologicalSortTasks(
    tasks: Array<{
      id: string
      resource: "tool" | "handler" | "knowledge"
      key: string
      depends_on: string[]
    }>
  ): Array<{
    id: string
    resource: "tool" | "handler" | "knowledge"
    key: string
    depends_on: string[]
  }> {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: Array<typeof tasks[0]> = [];

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected in task graph at task ${taskId}`);
      }

      const task = taskMap.get(taskId);
      if (!task) {
        // appLogger.warn(`Task ${taskId} not found in task map`);
        return;
      }

      visiting.add(taskId);

      // Visit dependencies first
      for (const depId of task.depends_on) {
        visit(depId);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      result.push(task);
    };

    // Visit all tasks
    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  // ============================================================
  // INDIVIDUAL TASK EXECUTORS
  // ============================================================
  private async executeToolTask(
    task: { id: string; resource: "tool" | "handler" | "knowledge"; key: string; depends_on: string[] },
    input: PipelineInput,
    context: any,
    params: Record<string, unknown>
  ): Promise<unknown> {
    try {
      // Use circuit breaker for tool execution
      const allTools = await circuitBreaker.call(
        () => toolService.getToolsBySlugs([task.key])
      );

      if (allTools.length === 0) {
        throw new Error(`Tool not found: ${task.key}`);
      }

      const tool = allTools[0];
      const toolParams = toolService.getToolParams(tool);

      // Extract params for this tool
      const extractedParams = await paramExtractorService.extractAll(
        input.text,
        toolParams
      );

      // Merge with dependency results
      const mergedParams = paramHydratorService.hydrate(
        {
          ...params,
          ...extractedParams
        },
        input.attributes ?? {}
      );

      // Check for missing required params
      const missingParams = toolService.getMissingParamsFromTool(tool, mergedParams);
      if (missingParams.length > 0) {
        throw new Error(`Missing required parameters for tool ${task.key}: ${missingParams.join(', ')}`);
      }

      // Execute tool with circuit breaker
      const toolResults = await circuitBreaker.call(
        () => executionContext.run('tool', [tool], mergedParams, context)
      );
      
      return toolResults[task.key] || toolResults;
    } catch (error) {
      appLogger.error(`Tool execution failed: ${task.key}`, {
        error: error instanceof Error ? error.message : error,
        task: task.key
      });
      throw error;
    }
  }

  private async executeHandlerTask(
    task: { id: string; resource: "tool" | "handler" | "knowledge"; key: string; depends_on: string[] },
    input: PipelineInput,
    context: any,
    params: Record<string, unknown>
  ): Promise<unknown> {
    try {
      // Execute handler via execution context with circuit breaker
      const handlerResults = await circuitBreaker.call(
        () => executionContext.run('handler', [task.key], params, context)
      );
      return handlerResults[task.key] || handlerResults;
    } catch (error) {
      appLogger.error(`Handler execution failed: ${task.key}`, {
        error: error instanceof Error ? error.message : error,
        task: task.key
      });
      throw error;
    }
  }

  private async executeKnowledgeTask(
    task: { id: string; resource: "tool" | "handler" | "knowledge"; key: string; depends_on: string[] },
    input: PipelineInput,
    context: any,
    params: Record<string, unknown>
  ): Promise<unknown> {
    try {
      const allKnowledge = await circuitBreaker.call(
        () => knowledgeHelper.getKnowledgeBySlugs([task.key])
      );

      if (allKnowledge.length === 0) {
        throw new Error(`Knowledge not found: ${task.key}`);
      }

      // Execute knowledge via execution context
      const knowledgeResult = await executionContext.run('knowledge', allKnowledge, {}, context);
      return knowledgeResult;
    } catch (error) {
      appLogger.error(`Knowledge execution failed: ${task.key}`, {
        error: error instanceof Error ? error.message : error,
        task: task.key
      });
      throw error;
    }
  }

  // ============================================================
  // STAGE 4 — EXECUTE SAFE PLAN (PRODUCTION OPTIMIZED)
  // ============================================================
  private async executeSafePlan(
    input: PipelineInput,
    safePlan: PlannerOutput,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const results: Record<string, unknown> = {};
    const executionMetrics = {
      totalTasks: 0,
      executedTasks: 0,
      failedTasks: 0,
      skippedTasks: 0
    };

    const context = {
      user_id: input.user_id,
      app_name: input.app_name,
      text: input.text,
      language: input.language,
      chat_history: input.chat_history ?? [],
      attributes: input.attributes ?? {},
    };

    try {
      // ============================================================
      // VALIDATE PLAN
      // ============================================================
      if (!safePlan || !safePlan.tasks || safePlan.tasks.length === 0) {
        if (safePlan.chat) {
          // appLogger.debug('Plan is chat-only, no execution needed');
          return {};
        }
        throw new Error('Invalid plan: no tasks provided');
      }

      executionMetrics.totalTasks = safePlan.tasks.length;

      appLogger.info('Executing safe plan', {
        mode: safePlan.mode,
        totalTasks: safePlan.tasks.length,
        hasDependencies: safePlan.tasks.some(t => t.depends_on.length > 0)
      });

      // ============================================================
      // MULTI-STEP MODE: Execute with dependencies
      // ============================================================
      if (safePlan.mode === 'multi_step') {
        const executionResult = await this.executeTasksWithDependencies(
          safePlan.tasks,
          input,
          context,
          params || {}
        );

        // const duration = Date.now() - startTime;
        // appLogger.info('Multi-step execution completed', {
        //   durationMs: duration,
        //   avgTaskTime: duration / safePlan.tasks.length
        // });

        return executionResult;
      }

      // ============================================================
      // SINGLE-STEP MODE: Execute independent tasks in parallel
      // ============================================================
      // appLogger.debug('Executing single-step plan (parallel execution)');

      // Group tasks by resource type for batch execution
      const toolTasks = safePlan.tasks.filter(t => t.resource === 'tool');
      const handlerTasks = safePlan.tasks.filter(t => t.resource === 'handler');
      const knowledgeTasks = safePlan.tasks.filter(t => t.resource === 'knowledge');

      // Execute tools in parallel (no dependencies)
      if (toolTasks.length > 0) {
        const toolResults = await this.executeToolTasksParallel(
          toolTasks,
          input,
          context,
          params || {}
        );
        Object.assign(results, toolResults);
        executionMetrics.executedTasks += toolTasks.length;
      }

      // Execute handlers in parallel (no dependencies)
      if (handlerTasks.length > 0) {
        const handlerResults = await this.executeHandlerTasksParallel(
          handlerTasks,
          input,
          context,
          params || {}
        );
        Object.assign(results, handlerResults);
        executionMetrics.executedTasks += handlerTasks.length;
      }

      // Execute knowledge tasks in parallel (no dependencies)
      if (knowledgeTasks.length > 0) {
        const knowledgeResults = await this.executeKnowledgeTasksParallel(
          knowledgeTasks,
          input,
          context
        );
        Object.assign(results, knowledgeResults);
        executionMetrics.executedTasks += knowledgeTasks.length;
      }

      // const duration = Date.now() - startTime;
      // appLogger.info('Single-step execution completed', {
      //   durationMs: duration,
      //   ...executionMetrics,
      //   avgTaskTime: duration / (executionMetrics.executedTasks || 1)
      // });

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      appLogger.error('Safe plan execution failed', {
        error: error instanceof Error ? error.message : error,
        durationMs: duration,
        ...executionMetrics
      });
      throw error;
    }
  }

  // ============================================================
  // PARALLEL TOOL EXECUTION (OPTIMIZED)
  // ============================================================
  private async executeToolTasksParallel(
    tasks: Array<{ id: string; resource: string; key: string; depends_on: string[] }>,
    input: PipelineInput,
    context: any,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    // Extract params for all tools at once (batch optimization)
    const toolSlugs = tasks.map(t => t.key);
    const extractedParams = await this.extractParamsForTools(input.text, toolSlugs);
    const mergedParams = paramHydratorService.hydrate(
      {
        ...params,
        ...extractedParams
      },
      context.attributes
    );

    // Validate all tools exist
    const allTools = await toolService.getToolsBySlugs(toolSlugs);
    const toolMap = new Map(allTools.map(t => [t.slug, t]));

    // Check for missing params across all tools
    const missingParamsByTool = await toolService.getMissingParamsForTools(allTools, mergedParams);
    const toolsWithMissingParams = new Set(missingParamsByTool.map(({ tool }) => tool.slug));
    if (missingParamsByTool.length > 0) {
      // appLogger.warn('Missing parameters for tools', {
      //   missing: missingParamsByTool.map(m => ({ tool: m.tool.slug, missing: m.missing }))
      // });
      // Store errors but continue execution
      missingParamsByTool.forEach(({ tool, missing }) => {
        results[tool.slug] = {
          error: 'Missing parameters',
          missing,
          message: 'Please provide required parameters'
        };
      });
    }

    // Execute tools in parallel
    const toolExecutions = tasks.map(async (task) => {
      try {
        const tool = toolMap.get(task.key);
        if (!tool) {
          throw new Error(`Tool not found: ${task.key}`);
        }

        if (toolsWithMissingParams.has(task.key)) {
          return {
            key: task.key,
            result: results[task.key],
            success: false
          };
        }

        const toolResults = await executionContext.run('tool', [tool], mergedParams, context);
        return { key: task.key, result: toolResults[task.key] || toolResults, success: true };
      } catch (error) {
        appLogger.error(`Tool execution failed: ${task.key}`, {
          error: error instanceof Error ? error.message : error
        });
        return { 
          key: task.key, 
          result: { error: error instanceof Error ? error.message : 'Execution failed' },
          success: false 
        };
      }
    });

    const toolResults = await Promise.all(toolExecutions);
    toolResults.forEach(({ key, result }) => {
      results[key] = result;
    });

    return results;
  }

  // ============================================================
  // PARALLEL HANDLER EXECUTION (OPTIMIZED)
  // ============================================================
  private async executeHandlerTasksParallel(
    tasks: Array<{ id: string; resource: string; key: string; depends_on: string[] }>,
    input: PipelineInput,
    context: any,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    const handlerExecutions = tasks.map(async (task) => {
      try {
        const handlerResults = await executionContext.run('handler', [task.key], params, context);
        return { key: task.key, result: handlerResults[task.key] || handlerResults, success: true };
      } catch (error) {
        appLogger.error(`Handler execution failed: ${task.key}`, {
          error: error instanceof Error ? error.message : error
        });
        return { 
          key: task.key, 
          result: { error: error instanceof Error ? error.message : 'Execution failed' },
          success: false 
        };
      }
    });

    const handlerResults = await Promise.all(handlerExecutions);
    handlerResults.forEach(({ key, result }) => {
      results[key] = result;
    });

    return results;
  }

  // ============================================================
  // PARALLEL KNOWLEDGE EXECUTION (OPTIMIZED)
  // ============================================================
  private async executeKnowledgeTasksParallel(
    tasks: Array<{ id: string; resource: string; key: string; depends_on: string[] }>,
    input: PipelineInput,
    context: any
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    const knowledgeSlugs = tasks.map(t => t.key);

    // Batch fetch all knowledge
    const allKnowledge = await knowledgeHelper.getKnowledgeBySlugs(knowledgeSlugs);
    const knowledgeMap = new Map(allKnowledge.map(k => [k.slug, k]));

    const knowledgeExecutions = tasks.map(async (task) => {
      try {
        const knowledge = knowledgeMap.get(task.key);
        if (!knowledge) {
          throw new Error(`Knowledge not found: ${task.key}`);
        }

        const knowledgeResult = await executionContext.run('knowledge', [knowledge], {}, context);
        return { key: task.key, result: knowledgeResult, success: true };
      } catch (error) {
        appLogger.error(`Knowledge execution failed: ${task.key}`, {
          error: error instanceof Error ? error.message : error
        });
        return { 
          key: task.key, 
          result: { error: error instanceof Error ? error.message : 'Execution failed' },
          success: false 
        };
      }
    });

    const knowledgeResults = await Promise.all(knowledgeExecutions);
    knowledgeResults.forEach(({ key, result }) => {
      results[key] = result;
    });

    return results;
  }

  // ============================================================
  // STAGE 5 — NATURALIZATION OR PURE CHAT
  // ============================================================
  private async naturalize(
    input: PipelineInput,
    apiResult: unknown,
    agent: Agent
  ): Promise<string> {
    return await naturalizationService.naturalize(
      agent,
      apiResult,
      input.text,
      input.attributes?.name as string,
      input.language ?? 'Indonesia'
    );
  }

  private async handlePureChat(
    agent: Agent,
    input: PipelineInput,
    startTotal: number
  ): Promise<PipelineResult> {
    // appLogger.debug('Pure Chat Mode Activated', {
    //   userId: input.user_id
    // });

    try {
      const aiResponse = await withTimeout(
        generalChatService.handle(
         input,
          agent
        ),
        DEFAULT_TIMEOUT,
        'generalChatService.handle'
      );

      // Simpan episodic memory juga untuk chat biasa
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: aiResponse
      });

      await episodicMemoryService.summarize(
        agent,
        "general_chat",
        input.user_id,
        input.app_name,
        messages
      );

      return PipelineFormatter.buildEarly(
        {
          intent: 'general_chat',
          score: 1,
          message: aiResponse
        },
        startTotal
      );

    } catch (err) {
      appLogger.error('Pure chat handling failed', {
        error: err instanceof Error ? err.message : err
      });

      // Fallback error response
      return PipelineFormatter.buildEarly(
        {
          intent: 'error',
          score: 0,
          message: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.'
        },
        startTotal
      );
    }
  }

  // ============================================================
  // UTILS — HANDLE MISSING PARAMETERS PER TOOL
  // ============================================================
  private async handleMissingParametersForTools(
    agent: Agent,
    input: PipelineInput,
    intents: Intent[],
    missingToolsParams: ToolMissingParams[],
    params: Record<string, unknown>,
    start: number,
    originalPlan: PlannerOutput
  ): Promise<PipelineResult> {
    const intentSlugs = intents.map(i => i.slug);

    // Simpan originalPlan dengan lengkap (termasuk knowledge)
    await conversationStateService.set(input.user_id, input.app_name, {
      intentSlugs,
      missingToolsParams: missingToolsParams.map(item => ({
        toolSlug: item.tool.slug,
        toolName: item.tool.name,
        missing: item.missing
      })),
      collectedParams: params,
      lastUserMessage: input.text,
      maxRetry: 3,
      isMultiIntent: intents.length > 1,
      originalPlan: {
        mode: originalPlan.mode || 'single_step',
        chat: originalPlan.chat ?? false,
        tasks: originalPlan.tasks || [],
      }
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
      ? intents.map(i => i.name).join(', ')
      : intents[0]?.name || 'unknown';

    return PipelineFormatter.buildEarly(
      {
        intent: intentDisplayName,
        score: 1,
        message: question
      },
      start
    );
  }

  // ============================================================
  // UTILS — GET AGENT
  // ============================================================
  private async getAgentBySlug(slug: string): Promise<Agent | null> {
    try {
      return await agentRepository.findBySlug(slug);
    } catch (err) {
      appLogger.error('Failed to fetch agent', {
        slug,
        error: err instanceof Error ? err.message : err
      });
      return null;
    }
  }

  // ============================================================
  // METRICS & MONITORING
  // ============================================================
  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }

  private updateAverageDuration(durationMs: number) {
    const totalRuns = this.metrics.successfulRuns + this.metrics.failedRuns;
    if (totalRuns === 0) {
      this.metrics.averageDuration = durationMs;
    } else {
      this.metrics.averageDuration =
        (this.metrics.averageDuration * (totalRuns - 1) + durationMs) /
        totalRuns;
    }
  }
}

export const pipelineService = new PipelineService();
