import { ollamaService } from './ollama.service'

import { vectorService } from './vector.service'
import { intentRegistry } from './intent-registry.service'
import { paramExtractorService } from './paramExtractor.service'
import { clarificationService } from './clarification.service'
import { conversationStateService } from './conversationState.service'
import { generalChatService } from './generalChat.service'
import { paramCacheService } from './param-cache.service';
import { naturalizationService } from './naturalization.service'

import { agentRepository } from '../repositories/agent.repository'
import { toolRepository } from '../repositories/tool.repository'

import { PipelineValidator } from '../utils/pipeline-validator.util'
import { PipelineFormatter } from '../utils/pipeline-formatter.util'
import { circuitBreaker } from '../utils/circuit-breaker.util'
import { ConversationUtil } from '../utils/conversation.util'

import { embeddingCache } from './embedding-cache.service'
import { paramHydratorService } from './param-hydrator.service'
import { toolPlannerService } from './toolPlanner.service'
import { knowledgeHelper } from '../services/knowledge-helper.service'
import { toolService } from '../services/tools.service'
import { episodicMemoryService } from '../services/episodic-memory.service'
import { queryRewriteService } from '../services/query-rewrite.service'
import { confidenceDecisionService } from '../services/confidence-decision.service'

import { config } from '../config'
import type { PipelineInput, PipelineResult, ToolMissingParams, PlannerOutput, Intent, IntentMatch, ToolParam, PendingIntentState } from '../types'
import { AgentResponse } from '../types/agent.types'
import { executionContext } from '../utils/strategies/execution-context'

class PipelineService {

  // ============================================================
  // PUBLIC ENTRYPOINT
  // ============================================================
  async run(input: PipelineInput): Promise<PipelineResult> {
    const startTotal = Date.now()

    // ============================================================
    // Get agent by slug from input.app_name
    // ============================================================
    const agent = await this.getAgentBySlug(input.app_name)
  
    try {
      PipelineValidator.validateAgent(agent, input.app_name)
    } catch (err: any) {
      return PipelineFormatter.buildEarly({
        intent: 'error',
        score: 0,
        message: err.message
      }, startTotal)
    }

    // ============================================================
    // Cek apakah ada conversation state yang pending (slot filling)
    // ============================================================
    const pending = conversationStateService.get(input.user_id, input.app_name)

    // Clear state jika user mengirim pesan "cancel"
    if (input.text.toLowerCase() === 'cancel' || input.text.toLowerCase() === 'batal') {
      conversationStateService.clear(input.user_id, input.app_name)
      return PipelineFormatter.buildEarly({
        intent: 'cancel',
        score: 1,
        message: 'Oke, permintaan sebelumnya sudah saya batalkan. Ada lagi yang bisa saya bantu?'
      }, startTotal)
    }

    // console.log(`[DEBUG] Initial State Check for ${input.user_id}:`, pending ? `Found intents: ${pending.intentSlugs}` : "Empty");
    
    if (pending) {
      return await this.resumePendingIntent(input, pending, agent, startTotal)
    }

    
    try {
      const intents = intentRegistry.getAll({
        agentId: agent?.id
      })
      
      // Embed query dan cari intent
      const intentQuery = input.text
      const queryEmbedding = await this.embedQuery(intentQuery, agent?.id)
      
      const vectorHints = await vectorService.findIntent(
        queryEmbedding,
        intents,
        agent as AgentResponse
      )

      // ============================================================
      // GET EPISODIC MEMORY
      // ============================================================

      const memoryContext = await episodicMemoryService.getRecentContext(
        input.user_id,
        input.app_name
      )

      const recentTools = await episodicMemoryService.getToolUsageHints(
        input.user_id,
        input.app_name
      )

      console.log('[Memory] Recent tools:', recentTools)

      let enrichedUserQuery = memoryContext + input.text

      const rewrittenQuery = await queryRewriteService.rewriteWithMemory(
        memoryContext,
        input.text
      )

      enrichedUserQuery = memoryContext + rewrittenQuery

      console.log('[User enrichedUserQuery]:', enrichedUserQuery)

      // ============================================================
      // PLANNER INTENT
      // ============================================================
      const plannerOutput = await this.plannerIntent(recentTools, vectorHints,
        {
          ...input,
          text: enrichedUserQuery
        }, true)

      console.log("[Planner Raw]:", plannerOutput)

      // ============================================
      //  CONFIDENCE DECISION ENGINE
      // ============================================
      const decision = confidenceDecisionService.evaluate(
        plannerOutput,
        input.text
      )

      plannerOutput.confidence = decision.confidence

      console.log('[Confidence]', decision)

      // LOW CONFIDENCE → (STOP TOOL FLOW)
      if (decision.action === 'chat') {
        return await this.handlePureChat(
          input,
          memoryContext,
          startTotal
        )
      }

      // ============================================
      // VALIDATE SAFE PLAN
      // ============================================
      const safePlan: PlannerOutput = {
        handlers: plannerOutput.handlers,
        tools: plannerOutput.tools,
        knowledge: plannerOutput.knowledge,
        chat: plannerOutput.chat && plannerOutput.tools.length === 0 && plannerOutput.knowledge.length === 0
      }

      if (safePlan.chat === true) {
        return await this.handlePureChat(
          input,
          memoryContext,
          startTotal
        )
      }
      
      // ============================================================
      // PARAM EXTRACTION FOR SAFEPLAN.TOOLS
      // ============================================================
      let safeParams: Record<string, unknown> = {};
      
      if (safePlan.tools.length > 0) {
        // Extract params ONLY for tools
        const extractedParams = await this.extractParamsForTools(
          input.text, 
          safePlan.tools
        )
        
        // Hydrate dengan user attributes
        safeParams = paramHydratorService.hydrate(
          extractedParams,
          input.attributes
        )
        
        // CEK MISSING PARAMS
        const allTools = await toolService.getToolsBySlugs(safePlan.tools)
        // console.log('[DEBUG] Tool details:', allTools.map(t => ({
        //   slug: t.slug,
        //   parameters: t.parameters?.map(p => ({
        //     name: p.name,
        //     isRequired: p.isRequired,
        //     defaultValue: p.defaultValue
        //   }))
        // })))
        const missingToolsParams = await toolService.getMissingParamsForTools(allTools, safeParams)
        
        // console.log('[Pipeline] Missing params per tool:', missingToolsParams.map(m => ({
        //   tool: m.tool.slug,
        //   missing: m.missing
        // })))
        
        // Jika ada missing params, handle slot filling
        if (missingToolsParams.length > 0) {
          // Cari intents yang memiliki tools ini untuk konteks slot filling
          const relevantIntents = intents.filter(intent => 
            intent.tools?.some(t => safePlan.tools.includes(t.tool?.slug))
          )
          
          return this.handleMissingParametersForTools(
            input,
            relevantIntents.length > 0 ? relevantIntents : intents,
            missingToolsParams,
            safeParams,
            startTotal,
            safePlan
          )
        }
      }

      // ============================================================
      // EKSEKUSI INTENTS (HANDLERS, TOOLS, KNOWLEDGE)
      // ============================================================
      const apiResults = await this.executeSafePlan(input, safePlan, safeParams)

      console.log('[Pipeline] API Results:', apiResults)

      // ============================================================
      // NATURALIZE RESPONSE
      // ============================================================
      const naturalResponse = await this.naturalize(
        {
          ...input,
          text: enrichedUserQuery
        }, apiResults)
      
      const intentLabel = [
        ...(safePlan.handlers || []),
        ...(safePlan.tools || []),
        ...(safePlan.knowledge || [])
      ].join(',');

      // ============================================================
      // STORE EPISODIC MEMORY
      // ============================================================
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext:naturalResponse
      })

      const summary = await episodicMemoryService.summarize(
        input.user_id,
        input.app_name,
        messages,
        safePlan
      )

      console.log('[Pipeline] Summary:', summary)

      // ============================================================
      // RETURN RESULT
      // ============================================================
      return PipelineFormatter.buildSuccessMulti(
        intentLabel,
        1,
        apiResults,
        naturalResponse,
        startTotal
      )

    } catch (err) {
      throw PipelineFormatter.buildError('unknown', 'Pipeline gagal total', err)
    }
  }

  // ============================================================
  // STAGE 0 — RESUME CONVERSATION (slot filling)
  // ============================================================
  private async resumePendingIntent(
    input: PipelineInput,
    pending: PendingIntentState,
    agent: AgentResponse | null, 
    startTotal: number,
  ): Promise<PipelineResult> {
    console.log(`[Resuming] Found pending state:`, pending);

    // ============================================================
    // 1. RESOLVE INTENTS dari slugs
    // ============================================================
    const intentSlugs: string[] = pending.intentSlugs || [];
    const intents = intentRegistry.getBySlugs(intentSlugs, agent?.id);
    
    if (!intents.length) {
      console.error('[Resuming] No intents found for slugs:', intentSlugs);
      conversationStateService.clear(input.user_id, input.app_name);
      
      const aiResponse = await generalChatService.handle(input);
      return PipelineFormatter.buildEarly({
        intent: 'general_chat',
        score: 0,
        message: aiResponse
      }, startTotal);
    }

    // ============================================================
    // 2. GET MISSING TOOLS PARAMS FROM STATE
    // ============================================================
    const missingToolsParams: Array<{ toolSlug: string; missing: string[] }> = 
      pending.missingToolsParams || []

    const allMissingParamNames = missingToolsParams.flatMap(m => m.missing)
    const uniqueMissingNames = [...new Set(allMissingParamNames)]

    // ============================================================
    // 3. Ambil parameter definitions dari tools yang missing
    // ============================================================
    const relevantParams: ToolParam[] = []
    const seenParams = new Set<string>()

    for (const missingTool of missingToolsParams) {
      const tool = await toolRepository.findBySlug(missingTool.toolSlug)
      if (tool) {
        const toolParams = toolService.getToolParams(tool)
        for (const param of toolParams) {
          if (uniqueMissingNames.includes(param.name) && !seenParams.has(param.name)) {
            seenParams.add(param.name)
            relevantParams.push(param)
          }
        }
      }
    }
    
    console.log('[Resuming] Relevant params for extraction:', relevantParams.map(p => p.name))

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

    console.log('[Resuming] Merged params:', mergedParams);

    // ============================================================
    // 5. RE-CHECK missing params untuk semua tools
    // ============================================================
    const toolSlugsFromState = [...new Set(missingToolsParams.map(m => m.toolSlug))]
    const allTools = await toolService.getToolsBySlugs(toolSlugsFromState)
    const stillMissing = await toolService.getMissingParamsForTools(allTools, mergedParams)

    console.log('[Resuming] Still missing:', stillMissing.map(m => ({
      tool: m.tool.slug,
      missing: m.missing
    })));

    // ✅ IMPORTANT: Gunakan originalPlan yang lengkap (tools + knowledge)
    const originalPlan = pending.originalPlan || { handlers: [], tools: [], knowledge: [], chat: false };
    console.log('[Resuming] Original plan:', originalPlan);

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
          const aiResponse = await generalChatService.handle(input);
          return PipelineFormatter.buildEarly({
            intent: 'general_chat',
            score: 0,
            message: aiResponse
          }, startTotal);
        }
      }
      
      // Lanjutkan slot filling
      return this.handleMissingParametersForTools(
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
    
    console.log(`[Resuming] All params complete. Executing with plan:`, originalPlan);

    const lastUserMessage = pending.lastUserMessage || input.text;
    console.log('[Resuming] Original question:', lastUserMessage);
    
    // Execute dengan originalPlan yang lengkap (tools + knowledge)
    const apiResults = await this.executeSafePlan(input, originalPlan, mergedParams);

    const naturalizeInput: PipelineInput = {
      ...input,
      text: lastUserMessage  // ← Gunakan pertanyaan asli, bukan "jakarta"
    };
    
    const naturalResponse = await this.naturalize(naturalizeInput, apiResults)
    
    // Return response yang menggabungkan kedua hasil
    return PipelineFormatter.buildSuccessMulti(
      originalPlan.tools.concat(originalPlan.knowledge).join(','),
      1,
      apiResults,
      naturalResponse,
      startTotal
    );
  }

  // ============================================================
  // STAGE 1 — EMBEDDING
  // ============================================================
  private async embedQuery(text: string, agentId?: string): Promise<number[]> {
    try {
      const normalizedText = text.toLowerCase().trim()
      
      if (!config.cache.enableEmbeddingCache) {
        return await circuitBreaker.call(() => ollamaService.embed(normalizedText))
      }
      
      const embedding = await embeddingCache.getOrCompute(
        normalizedText,
        async () => await circuitBreaker.call(() => ollamaService.embed(normalizedText)),
        agentId,
        config.cache.embeddingTTL
      )
      
      return embedding
    } catch (err) {
      throw PipelineFormatter.buildError('embed', 'Gagal generate embedding', err)
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

    // console.log('[Pipeline] Intent matches:', matches);
    const hasMatches = matches && matches.length > 0
    const hasRecentUsage =
      recentUsage &&
      (
        recentUsage.handlers?.length ||
        recentUsage.tools?.length ||
        recentUsage.knowledge?.length
      )

    // ==========================================================
    //  EARLY EXIT — PURE CHAT (NO MATCH + NO MEMORY)
    // ==========================================================
    if (!hasMatches && !hasRecentUsage) {
      console.log('[IntentMatch] No matches & no memory → PURE CHAT')
      return {
        handlers: [],
        tools: [],
        knowledge: [],
        chat: true
      }
    }

    const handlerIntents = matches
      .filter(m => m.intent.executionType === 'handler')
      .map(m => m.intent)

    const toolIntents = matches
      .filter(m => m.intent.tools && m.intent.tools.length > 0)
      .map(m => m.intent)

    const knowledgeIntents = matches
      .filter(m => m.intent.knowledge && m.intent.knowledge.length > 0)
      .map(m => m.intent)

     // ----------------------------------------------------------
    // BUILD HANDLER CANDIDATES
    // ----------------------------------------------------------
    const handlerForPrompt = handlerIntents

    // ----------------------------------------------------------
    // BUILD TOOL CANDIDATES
    // ----------------------------------------------------------
    const toolsForPrompt = toolIntents.flatMap(intent => {
      return (intent.tools || []).map((t: any) => {
        const toolData = t.tool || t
        return {
          slug: toolData.slug,
          name: toolData.name,
          description: toolData.description,
          intentSlug: intent.slug,
          intentName: intent.name
        }
      })
    })

    // ----------------------------------------------------------
    // BUILD KNOWLEDGE CANDIDATES
    // ----------------------------------------------------------
    const knowledgeForPrompt = knowledgeIntents.flatMap(intent => {
      return (intent.knowledge || []).map((k: any) => {
        const knowledgeData = k.knowledge || k
        return {
          slug: knowledgeData.slug,
          name: knowledgeData.title || knowledgeData.slug,
          description:
            knowledgeData.description ||
            knowledgeData.title ||
            knowledgeData.slug,
          intentSlug: intent.slug,
          intentName: intent.name
        }
      })
    })

    const uniqueHandler = [
      ...new Map(handlerForPrompt.map(h => [h.slug, h])).values()
    ]

    const uniqueTools = [
      ...new Map(toolsForPrompt.map(t => [t.slug, t])).values()
    ]

    const uniqueKnowledge = [
      ...new Map(knowledgeForPrompt.map(k => [k.slug, k])).values()
    ]

    console.log('[IntentMatch] Candidates:', {
      tools: uniqueTools.map(t => t.slug),
      knowledge: uniqueKnowledge.map(k => k.slug)
    })

    // ==========================================================
    // FAST PATH (SKIP PLANNER)
    // ==========================================================
    // 0️ ONLY ONE HANDLER → DIRECT EXECUTION
    if (uniqueHandler.length === 1) {
      console.log('[IntentMatch] Single handler detected → skip planner')
      return {
        handlers: [uniqueHandler[0].slug],
        tools: [],
        knowledge: [],
        chat: false
      }
    }

    // 1️ ONLY ONE TOOL → DIRECT EXECUTION
    if (uniqueTools.length === 1 && uniqueKnowledge.length === 0) {
      console.log('[IntentMatch] Single tool detected → skip planner')
      return {
        handlers: [],
        tools: [uniqueTools[0].slug],
        knowledge: [],
        chat: false
      }
    }

    // 2️ ONLY ONE KNOWLEDGE → DIRECT EXECUTION
    if (uniqueKnowledge.length === 1 && uniqueTools.length === 0) {
      console.log('[IntentMatch] Single knowledge detected → skip planner')
      return {
        handlers: [],
        tools: [],
        knowledge: [uniqueKnowledge[0].slug],
        chat: false
      }
    }

    // 3️ Planner disabled → run all candidates
    if (!usePlan) {
      console.log('[IntentMatch] Planner disabled → run all candidates')
      return {
        handlers: uniqueHandler.map(h => h.slug),
        tools: uniqueTools.map(t => t.slug),
        knowledge: uniqueKnowledge.map(k => k.slug),
        chat: uniqueTools.length === 0 && uniqueKnowledge.length === 0
      }
    }

    // ==========================================================
    //  CALL LLM PLANNER (MULTI CANDIDATE)
    // ==========================================================
    console.log('[IntentMatch] Multiple candidates → calling planner')

    const plan = await toolPlannerService.plan({
      userText: input.text,
      candidates: {
        tools: uniqueTools.map(t => t.slug),
        knowledge: uniqueKnowledge.map(k => k.slug),
        toolsDetails: uniqueTools,
        knowledgeDetails: uniqueKnowledge
      },
      recentUsage,
      language: input.language
    })

    return plan
  }

  // ============================================================
  // STAGE 3 — PARAM EXTRACTION
  // ============================================================
  private async extractParamsForTools(
    text: string, 
    toolSlugs: string[]
  ): Promise<Record<string, unknown>> {
    if (!toolSlugs.length) return {};
    
    // Use the dedicated param cache service
    return await paramCacheService.getOrExtract(
      text,
      toolSlugs,
      async (text, params) => {
        // This lambda is only called on cache miss
        return await paramExtractorService.extractAll(text, params);
      }
    );
  }

  // ============================================================
  // STAGE 4 — EXECUTE SAFEPLAN (WITH INTERNAL PARAM EXTRACTION)
  // ============================================================
  private async executeSafePlan(
    input: PipelineInput,
    safePlan: PlannerOutput,
    params?: Record<string, unknown> // params jadi optional
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {}
    
    // Prepare context for execution strategies
    const context = {
      user_id: input.user_id,
      app_name: input.app_name,
      text: input.text,
      language: input.language,
      chat_history: input.chat_history ?? [],
      attributes: input.attributes,
    }

    
    // ============================================================
    // CASE 1: Execute Tools from safePlan (with param extraction)
    // ============================================================
    if (safePlan.tools.length > 0) {
      // Extract params ONLY for tools
      const extractedParams = await this.extractParamsForTools(
        input.text, 
        safePlan.tools
      )
      
      // Hydrate with user attributes
      const safeParams = paramHydratorService.hydrate(
        extractedParams,
        input.attributes
      )
      
      // console.log('[ExecuteSafePlan] Extracted params for tools:', safeParams)
      
      // Check missing params
      const allTools = await toolService.getToolsBySlugs(safePlan.tools)
      const missingToolsParams = await toolService.getMissingParamsForTools(allTools, safeParams)
      
      // console.log('[ExecuteSafePlan] Missing params per tool:', missingToolsParams.map(m => ({
      //   tool: m.tool.slug,
      //   missing: m.missing
      // })))
      
      // If missing params, throw or handle (but we're inside execute, so we'll return error)
      if (missingToolsParams.length > 0) {
        console.warn('[ExecuteSafePlan] Missing params detected, but this should be handled before executeSafePlan')
        results.tools = { 
          error: 'Missing parameters', 
          missing: missingToolsParams,
          message: 'Please provide required parameters'
        }
      } else {
        // Execute tools with extracted params
        // const toolResults = await this.executeToolsWithContext(allTools, safeParams, context)
        const toolResults = await executionContext.run("tool", allTools, safeParams, context)
        
        // Return single value if only one tool
        if (allTools.length === 1) {
          results.tools = toolResults[allTools[0].slug]
        } else {
          results.tools = toolResults
        }
      }
    }
    
    // ============================================================
    // CASE 2: Execute Knowledge from safePlan (NO param extraction needed)
    // ============================================================
    if (safePlan.knowledge.length > 0) {
      // results.llmModel = config.ollama.naturalModel

      console.log(`[ExecuteSafePlan] Executing knowledge:`, safePlan.knowledge)
      const allKnowledge = await knowledgeHelper.getKnowledgeBySlugs(safePlan.knowledge)

      try {
        // Use knowledge strategy via execution context
        // const knowledgeResult = await this.executeKnowledgesWithContext(allKnowledge, context)
        const knowledgeResult = await executionContext.run("knowledge", allKnowledge, {}, context)
        
        // console.log('[ExecuteSafePlan] Knowledge result:', knowledgeResult)
        // Return single value if only one knowledge
        if (safePlan.knowledge.length === 1) {
          results.knowledge = knowledgeResult
        } else {
          results.knowledge = knowledgeResult
        }
      } catch (error) {
        console.error(`[ExecuteSafePlan] Failed knowledge execution:`, error)
        results.knowledge = { error: String(error) }
      }
    }

    // ============================================================
    // CASE 3: Execute Handler from safePlan (NO param extraction needed)
    // ============================================================
    if (safePlan.handlers && safePlan.handlers.length > 0) {
      try {
        // Use handler strategy via execution context
        // const handlerResult = await this.executeHandlerWithContext(safePlan.handlers, context)
        const handlerResult = await executionContext.run("handler", safePlan.handlers, {}, context)
        
        // console.log('[ExecuteSafePlan] Handler result:', handlerResult)
        // Return single value if only one handler
        if (safePlan.handlers.length === 1) {
          results.handlers = handlerResult
        } else {
          results.handlers = handlerResult
        }
      } catch (error) {
        console.error(`[ExecuteSafePlan] Failed handler execution:`, error)
        results.handlers = { error: String(error) }
      }
    }
    console.log(`[ExecuteSafePlan] Results:`, results)
    return results as PipelineResult
  }

  // ============================================================
  // STAGE 5 — NATURALIZATION OR PURE CHAT
  // ============================================================
  private async naturalize(input: PipelineInput, apiResult: unknown) {
    return await naturalizationService.naturalize(
      apiResult,
      input.text,
      input.attributes?.name as string,
      input.language ?? 'Indonesia',
      undefined,
      input.app_name
    )
  }

  private async handlePureChat(
    input: PipelineInput,
    memoryContext: string,
    startTotal: number
  ): Promise<PipelineResult> {

    console.log('[Pipeline] Pure Chat Mode Activated')

    const aiResponse = await generalChatService.handle({
      ...input,
      text: memoryContext + input.text
    })

    // Simpan episodic memory juga untuk chat biasa
    const messages = ConversationUtil.buildMessages(input, {
      memoryContext: aiResponse
    })

    await episodicMemoryService.summarize(
      input.user_id,
      input.app_name,
      messages,
      {
        handlers: [],
        tools: [],
        knowledge: [],
        chat: true
      }
    )

    return PipelineFormatter.buildEarly({
      intent: 'general_chat',
      score: 1,
      message: aiResponse
    }, startTotal)
  }

  // ============================================================
  // UTILS — HANDLE MISSING PARAMETERS PER TOOL (UNIFIED)
  // ============================================================
  private async handleMissingParametersForTools(
    input: PipelineInput,
    intents: Intent[],
    missingToolsParams: ToolMissingParams[],
    params: Record<string, unknown>,
    start: number,
    originalPlan: PlannerOutput 
  ): Promise<PipelineResult> {

    const intentSlugs = intents.map(i => i.slug)
    
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
        handlers: originalPlan.handlers,
        tools: originalPlan.tools,      // ← tools tetap
        knowledge: originalPlan.knowledge,  // ← knowledge juga disimpan!
        chat: originalPlan.chat 
      }
    })
    
    console.log(`[SlotFilling] Missing tools/params:`, missingToolsParams.map(m => ({
      tool: m.tool.slug,
      missing: m.missing
    })))

    const question = await clarificationService.askForMultipleParametersFromTools(
      input,
      missingToolsParams,
      input.language ?? 'Indonesia'
    )

    const intentDisplayName = intents.length > 1
      ? intents.map(i => i.name).join(', ')
      : intents[0].name

    return PipelineFormatter.buildEarly(
      {
        intent: intentDisplayName,
        score: 1,
        message: question
      },
      start
    )
  }

    
  // ============================================================
  // UTILS — GET AGENT
  // ============================================================
  private async getAgentBySlug(slug: string): Promise<AgentResponse | null> {
    try {
      return await agentRepository.findBySlug(slug)
    } catch (err) {
      console.error('Failed to fetch agent:', err)
      return null
    }
  }

}

export const pipelineService = new PipelineService()