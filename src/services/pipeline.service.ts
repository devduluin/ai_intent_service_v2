import { ollamaService } from './ollama.service';
import { openAiService } from './openAi.service';

import { vectorService } from './vector.service';
import { intentRegistry } from './intent-registry.service';
import { paramExtractorService } from './paramExtractor.service';
import { clarificationService } from './clarification.service';
import { conversationStateService } from './conversationState.service';
import { generalChatService } from './generalChat.service';
import { paramCacheService } from './param-cache.service';
import { naturalizationService } from './naturalization.service';

import { agentRepository } from '../repositories/agent.repository';
import { toolRepository } from '../repositories/tool.repository';

import { PipelineValidator } from '../utils/pipeline-validator.util';
import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { circuitBreaker } from '../utils/circuit-breaker.util';
import { ConversationUtil } from '../utils/conversation.util';
import { vectorLogger, appLogger } from '../utils/logger.util';

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
  PlannerOutput,
  Intent,
  IntentMatch,
  PendingIntentState,
  ToolParam
} from '../types';
import { Agent } from '../types/agent.types';
import { executionContext } from '../utils/strategies/execution-context';

// ============================================================
// Constants & Configuration
// ============================================================

const DEFAULT_TIMEOUT = 15000; // 15 seconds for pipeline operations
const PLANNER_TIMEOUT = 20000; // 20 seconds for planner
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY = 500; // 0.5 second

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
// Utility Functions
// ============================================================

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
  maxRetries = MAX_RETRIES,
  baseDelay = BASE_RETRY_DELAY
): Promise<T> {
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (attempt > maxRetries) {
        break;
      }

      // Check if retryable
      const message = lastError.message.toLowerCase();
      const isRetryable =
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('503') ||
        message.includes('504');

      if (!isRetryable) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1) + Math.random() * 100,
        5000
      );

      appLogger.warn(`Retry attempt ${attempt}/${maxRetries} for ${operationName}`, {
        error: lastError.message,
        delayMs: delay
      });

      await sleep(delay);
    }
  }

  throw new Error(
    `${operationName} failed after ${attempt} attempts. Last error: ${lastError?.message}`
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result;
  } catch (error) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    throw error;
  }
}

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
        appLogger.warn('Agent validation failed', {
          appName: input.app_name,
          error: err.message
        });

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
        conversationStateService.clear(input.user_id, input.app_name);
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

      this.metrics.successfulRuns++;
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

      throw PipelineFormatter.buildError('unknown', 'Pipeline gagal total', err);
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

      // appLogger.debug('Retrieved intents', {
      //   intentCount: intents.length,
      //   agentId: agent?.id
      // });

      // Embed query dan cari intent
      const queryEmbedding = await withTimeout(
        this.embedQuery(input.text, agent?.id),
        DEFAULT_TIMEOUT,
        'embedQuery'
      );

      const vectorHints = await withTimeout(
        vectorService.findIntent(queryEmbedding, intents, agent as Agent),
        DEFAULT_TIMEOUT,
        'findIntent'
      );

      // appLogger.debug('Vector matching completed', {
      //   matchVector: vectorHints,
      //   topScore: vectorHints[0]?.score ?? 0
      // });
      

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
      //   recentToolsCount: Array.isArray(recentTools) ? recentTools.length : 0
      // });

      const rewrittenQuery = await queryRewriteService.rewriteWithMemory(
        agent as Agent,
        episodicMemory?.summary || null,
        input
      );

      const enrichedUserQuery = rewrittenQuery;

      appLogger.debug('Query enriched', {
        originalLength: input.text.length,
        enrichedQuery: enrichedUserQuery
      });

      // ============================================================
      // PLANNER INTENT
      // ============================================================
      const plannerOutput = await withTimeout(
        this.plannerIntent(recentTools, vectorHints, {
          ...input,
          text: enrichedUserQuery
        }, true),
        PLANNER_TIMEOUT,
        'plannerIntent'
      );

      appLogger.debug('Planner output', {
        handlers: plannerOutput.handlers?.length,
        tools: plannerOutput.tools?.length,
        knowledge: plannerOutput.knowledge?.length,
        chat: plannerOutput.chat
      });

      // ============================================
      // CONFIDENCE DECISION ENGINE
      // ============================================
      const decision = confidenceDecisionService.evaluate(
        plannerOutput,
        input.text
      );

      plannerOutput.confidence = decision.confidence;

      appLogger.debug('Confidence decision', {
        action: decision.action,
        confidence: decision.confidence
      });

      // LOW CONFIDENCE → CHAT
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
        handlers: plannerOutput.handlers || [],
        tools: plannerOutput.tools || [],
        knowledge: plannerOutput.knowledge || [],
        chat: plannerOutput.chat &&
               plannerOutput.tools.length === 0 &&
               plannerOutput.knowledge.length === 0
      };

      if (safePlan.chat === true) {
        this.metrics.fallbackToChatCount++;
        return await this.handlePureChat(
          agent as Agent,
          input,
          startTotal
        );
      }

      // ============================================================
      // PARAM EXTRACTION FOR SAFEPLAN.TOOLS
      // ============================================================
      let safeParams: Record<string, unknown> = {};

      if (safePlan.tools.length > 0) {
        const extractedParams = await this.extractParamsForTools(
          input.text,
          safePlan.tools
        );

        // Hydrate dengan user attributes
        safeParams = paramHydratorService.hydrate(
          extractedParams,
          input.attributes
        );

        // CEK MISSING PARAMS
        const allTools = await toolService.getToolsBySlugs(safePlan.tools);
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
            intent.tools?.some(t => safePlan.tools.includes(t.tool?.slug))
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
        this.executeSafePlan(input, safePlan, safeParams),
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
        ...(safePlan.handlers || []),
        ...(safePlan.tools || []),
        ...(safePlan.knowledge || [])
      ].join(',');

      // ============================================================
      // STORE EPISODIC MEMORY
      // ============================================================
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: naturalResponse
      });

      const summary = await episodicMemoryService.summarize(
        agent as Agent,
        (vectorHints[0]?.intent.slug as string || episodicMemory?.intent ||null),
        input.user_id,
        input.app_name,
        messages,
        safePlan
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

        conversationStateService.clear(input.user_id, input.app_name);

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

      appLogger.debug('Merged params', {
        paramCount: Object.keys(mergedParams).length
      });

      // ============================================================
      // 5. RE-CHECK missing params untuk semua tools
      // ============================================================
      const toolSlugsFromState = [...new Set(missingToolsParams.map(m => m.toolSlug))];
      const allTools = await toolService.getToolsBySlugs(toolSlugsFromState);
      const stillMissing = await toolService.getMissingParamsForTools(allTools, mergedParams);

      appLogger.debug('Still missing params', {
        missing: stillMissing.map(m => ({ tool: m.tool.slug, missing: m.missing }))
      });

      // IMPORTANT: Gunakan originalPlan yang lengkap (tools + knowledge)
      const originalPlan = pending.originalPlan || {
        handlers: [],
        tools: [],
        knowledge: [],
        chat: false
      };

      // ============================================================
      // 6. BRANCHING: Masih ada missing atau sudah lengkap?
      // ============================================================
      if (stillMissing.length > 0) {
        // Cek apakah user benar-benar menjawab parameter atau keluar flow
        const isAnsweringParam = PipelineValidator.isUserAnsweringParameter(input.text);

        if (!isAnsweringParam) {
          conversationStateService.incrementRetry(input.user_id, input.app_name);
          const state = conversationStateService.get(input.user_id, input.app_name);

          if (!state) {
            conversationStateService.clear(input.user_id, input.app_name);
            return await this.handlePureChat(
              agent as Agent,
              input,
              // null,
              startTotal
            );
          }
        }

        // Lanjutkan slot filling
        return this.handleMissingParametersForTools(
          agent as Agent,
          input,
          intents,
          stillMissing,
          mergedParams,
          startTotal,
          originalPlan
        );
      }

      // ============ SEMUA PARAMETER LENGKAP → EKSEKUSI ============
      conversationStateService.clear(input.user_id, input.app_name);

      appLogger.info('All params complete, executing', {
        plan: originalPlan
      });

      const lastUserMessage = pending.lastUserMessage || input.text;

      // Execute dengan originalPlan yang lengkap (tools + knowledge)
      const apiResults = await withTimeout(
        this.executeSafePlan(input, originalPlan, mergedParams),
        DEFAULT_TIMEOUT,
        'executeSafePlan-resume'
      );

      const naturalizeInput: PipelineInput = {
        ...input,
        text: lastUserMessage // ← Gunakan pertanyaan asli
      };

      const naturalResponse = await withTimeout(
        this.naturalize(naturalizeInput, apiResults, agent as Agent),
        DEFAULT_TIMEOUT,
        'naturalize-resume'
      );

      return PipelineFormatter.buildSuccessMulti(
        originalPlan.tools.concat(originalPlan.knowledge).join(','),
        1,
        apiResults,
        naturalResponse,
        startTotal
      );

    } catch (err) {
      appLogger.error('Resume pending intent failed', {
        error: err instanceof Error ? err.message : err
      });
      throw err;
    }
  }

  // ============================================================
  // STAGE 1 — EMBEDDING
  // ============================================================
  private async embedQuery(text: string, agentId?: string): Promise<number[]> {
    try {
      const normalizedText = text.toLowerCase().trim();

      if (!config.cache.enableEmbeddingCache) {
        return await circuitBreaker.call(() =>
          ollamaService.embed(normalizedText)
        );
      }

      const embedding = await embeddingCache.getOrCompute(
        normalizedText,
        async () => await circuitBreaker.call(() => ollamaService.embed(normalizedText)),
        agentId,
        config.cache.embeddingTTL
      );

      return embedding;
    } catch (err) {
      appLogger.error('Embedding generation failed', {
        error: err instanceof Error ? err.message : err
      });
      throw PipelineFormatter.buildError('embed', 'Gagal generate embedding', err);
    }
  }

  // ============================================================
  // STAGE 2 — INTENT MATCHING VECTOR AND PLANNER
  // ============================================================
  private async plannerIntent(
    recentUsage: PlannerOutput,
    matches: IntentMatch[],
    input: PipelineInput,
    usePlan: boolean = true
  ): Promise<PlannerOutput> {
    const hasMatches = matches && matches.length > 0;
    const hasRecentUsage =
      recentUsage &&
      (recentUsage.handlers?.length ||
       recentUsage.tools?.length ||
       recentUsage.knowledge?.length);

    // ==========================================================
    // EARLY EXIT — PURE CHAT (NO MATCH + NO MEMORY)
    // ==========================================================
    if (!hasMatches && !hasRecentUsage) {
      appLogger.debug('No matches & no memory → PURE CHAT');
      return {
        handlers: [],
        tools: [],
        knowledge: [],
        chat: true
      };
    }

    const handlerIntents = matches
      .filter(m => m.intent.executionType === 'handler')
      .map(m => m.intent);

    const toolIntents = matches
      .filter(m => m.intent.tools && m.intent.tools.length > 0)
      .map(m => m.intent);

    const knowledgeIntents = matches
      .filter(m => m.intent.knowledge && m.intent.knowledge.length > 0)
      .map(m => m.intent);

    // ----------------------------------------------------------
    // BUILD HANDLER CANDIDATES
    // ----------------------------------------------------------
    const handlerForPrompt = handlerIntents.flatMap(intent => ({
      slug: intent.handlerKey ?? '',
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

    // ==========================================================
    // FAST PATH (SKIP PLANNER)
    // ==========================================================
    // 0️⃣ ONLY ONE HANDLER → DIRECT EXECUTION
    if (uniqueHandler.length === 1) {
      appLogger.debug('Single handler detected → skip planner');
      return {
        handlers: [uniqueHandler[0].slug],
        tools: [],
        knowledge: [],
        chat: false
      };
    }

    // 1️⃣ ONLY ONE TOOL → DIRECT EXECUTION
    if (uniqueTools.length === 1 && uniqueKnowledge.length === 0) {
      appLogger.debug('Single tool detected → skip planner');
      return {
        handlers: [],
        tools: [uniqueTools[0].slug],
        knowledge: [],
        chat: false
      };
    }

    // 2️⃣ ONLY ONE KNOWLEDGE → DIRECT EXECUTION
    if (uniqueKnowledge.length === 1 && uniqueTools.length === 0) {
      appLogger.debug('Single knowledge detected → skip planner');
      return {
        handlers: [],
        tools: [],
        knowledge: [uniqueKnowledge[0].slug],
        chat: false
      };
    }

    // 3️⃣ Planner disabled → run all candidates
    if (!usePlan) {
      appLogger.debug('Planner disabled → run all candidates');
      return {
        handlers: uniqueHandler.map(h => h.slug),
        tools: uniqueTools.map(t => t.slug),
        knowledge: uniqueKnowledge.map(k => k.slug),
        chat: uniqueTools.length === 0 && uniqueKnowledge.length === 0
      };
    }

    // ==========================================================
    // CALL LLM PLANNER (MULTI CANDIDATE)
    // ==========================================================
    appLogger.debug('Multiple candidates → calling planner');

    const plan = await withTimeout(
      toolPlannerService.plan({
        userText: input.text,
        candidates: {
          tools: uniqueTools.map(t => t.slug),
          knowledge: uniqueKnowledge.map(k => k.slug),
          toolsDetails: uniqueTools,
          knowledgeDetails: uniqueKnowledge
        },
        recentUsage,
        language: input.language
      }),
      PLANNER_TIMEOUT,
      'toolPlannerService.plan'
    );

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
  // STAGE 4 — EXECUTE SAFEPLAN
  // ============================================================
  private async executeSafePlan(
    input: PipelineInput,
    safePlan: PlannerOutput,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    const context = {
      user_id: input.user_id,
      app_name: input.app_name,
      text: input.text,
      language: input.language,
      chat_history: input.chat_history ?? [],
      attributes: input.attributes,
    };

    // ============================================================
    // CASE 1: Execute Tools from safePlan
    // ============================================================
    if (safePlan.tools && safePlan.tools.length > 0) {
      const extractedParams = await this.extractParamsForTools(
        input.text,
        safePlan.tools
      );

      const safeParams = paramHydratorService.hydrate(
        extractedParams,
        input.attributes ?? {}
      );

      const allTools = await toolService.getToolsBySlugs(safePlan.tools);
      const missingToolsParams = await toolService.getMissingParamsForTools(
        allTools,
        safeParams
      );

      if (missingToolsParams.length > 0) {
        appLogger.warn('Missing params in executeSafePlan', {
          missing: missingToolsParams.map(m => ({ tool: m.tool.slug, missing: m.missing }))
        });

        results.tools = {
          error: 'Missing parameters',
          missing: missingToolsParams,
          message: 'Please provide required parameters'
        };
      } else {
        const toolResults = await executionContext.run(
          'tool',
          allTools,
          safeParams,
          context
        );

        if (allTools.length === 1) {
          results.tools = toolResults[allTools[0].slug];
        } else {
          results.tools = toolResults;
        }
      }
    }

    // ============================================================
    // CASE 2: Execute Knowledge from safePlan
    // ============================================================
    if (safePlan.knowledge && safePlan.knowledge.length > 0) {
      appLogger.debug('Executing knowledge', { slugs: safePlan.knowledge });

      const allKnowledge = await knowledgeHelper.getKnowledgeBySlugs(safePlan.knowledge);

      try {
        const knowledgeResult = await executionContext.run(
          'knowledge',
          allKnowledge,
          {},
          context
        );

        if (safePlan.knowledge.length === 1) {
          results.knowledge = knowledgeResult;
        } else {
          results.knowledge = knowledgeResult;
        }
      } catch (error) {
        appLogger.error('Knowledge execution failed', {
          error: error instanceof Error ? error.message : error
        });
        results.knowledge = { error: String(error) };
      }
    }

    // ============================================================
    // CASE 3: Execute Handler from safePlan
    // ============================================================
    if (safePlan.handlers && safePlan.handlers.length > 0) {
      try {
        const handlerResult = await executionContext.run(
          'handler',
          safePlan.handlers,
          {},
          context
        );

        if (safePlan.handlers.length === 1) {
          results.handlers = handlerResult;
        } else {
          results.handlers = handlerResult;
        }
      } catch (error) {
        appLogger.error('Handler execution failed', {
          error: error instanceof Error ? error.message : error
        });
        results.handlers = { error: String(error) };
      }
    }

    appLogger.debug('ExecuteSafePlan completed', { resultKeys: Object.keys(results) });
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
    // memoryContext: string | null,
    startTotal: number
  ): Promise<PipelineResult> {
    appLogger.debug('Pure Chat Mode Activated', {
      userId: input.user_id
    });

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
    conversationStateService.set(input.user_id, input.app_name, {
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
        handlers: originalPlan.handlers || [],
        tools: originalPlan.tools || [],
        knowledge: originalPlan.knowledge || [],
        chat: originalPlan.chat ?? false
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
