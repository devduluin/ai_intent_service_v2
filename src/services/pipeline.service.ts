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

import { embeddingCache } from './embedding-cache.service'
import { paramHydratorService } from './param-hydrator.service'
import { toolPlannerService } from './toolPlanner.service'
import { knowledgeHelper } from '../services/knowledge-helper.service'
import { toolService } from '../services/tools.service'

import { config } from '../config'
import type { PipelineInput, PipelineResult, ToolMissingParams, PlannerOutput, Intent, Tool, ToolParam, Knowledge, PendingIntentState } from '../types'
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

    // ============================================================
    // deteksi intent & matching
    // ============================================================
    try {
      const intents = intentRegistry.getAll({
        agentId: agent?.id
      })

      const queryEmbedding = await this.embedQuery(input.text, agent?.id)
      
      const plannerOutput = await this.matchIntent(queryEmbedding, intents, agent, input)

      console.log("[Planner Raw]:", plannerOutput)
      //hasil : [Planner Raw]: { handler: [ 'greeting' ], tools: [], knowledge: [], chat: false }

      //handle untuk intent handler
      // if (plannerOutput.handlers && plannerOutput.handlers.length > 0) {
      //   console.log("[Planner Handler]:", plannerOutput.handlers)
      //    const result = await executionContext.run("handler", {handlerKey: plannerOutput.handlers[0]}, {}, input)
      //    console.log("[Planner Handler Result]:", result)
      //    // hasil :[Planner Handler Result]: { success: true, message: 'Hello! user_1!' }
      // }

      const safePlan: PlannerOutput = {
        handlers: plannerOutput.handlers,
        tools: plannerOutput.tools,
        knowledge: plannerOutput.knowledge,
        chat: plannerOutput.chat && plannerOutput.tools.length === 0 && plannerOutput.knowledge.length === 0
      }

      // Evaluasi planner output
      if (safePlan.chat === true) {
        const aiResponse = await generalChatService.handle(input);
        return PipelineFormatter.buildEarly({
          intent: 'general_chat',
          score: 1,
          message: aiResponse
        }, startTotal);
      }
      
      // ============================================================
      // PARAM EXTRACTION LANGSUNG DARI SAFEPLAN.TOOLS
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
      // EKSEKUSI INTENTS (pakai selectedIntents untuk handler)
      // ============================================================
      const apiResults = await this.executeSafePlan(input, safePlan, safeParams)

      // console.log('[Pipeline] API Results:', apiResults)
     
      const naturalResponse = await this.naturalize(input, apiResults)

      const intentLabel = [
        ...safePlan.tools,
        ...safePlan.knowledge
      ].join(',')

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
    const originalPlan = pending.originalPlan || { tools: [], knowledge: [], chat: false };
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
  private async matchIntent(
    embedding: number[], 
    intents: Intent[], 
    agent: AgentResponse | null, 
    input: PipelineInput,
    usePlan: boolean = true
  ): Promise<PlannerOutput> {

    const matches = await vectorService.findIntent(
      embedding, 
      intents, 
      agent as AgentResponse
    )

    console.log('[Pipeline] Intent matches:', matches);
    // ----------------------------------------------------------
    // NO MATCH → PURE CHAT
    // ----------------------------------------------------------
    if (!matches || matches.length === 0) {
      return { handlers: [], tools: [], knowledge: [], chat: true }
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
    const handlerForPrompt = handlerIntents.flatMap(intent => {
        return {
          slug: intent.handlerKey,
          name: intent.name,
          description: intent.description,
          intentSlug: intent.slug,
          intentName: intent.name
        }
    })

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
        handlers: [String(uniqueHandler[0].slug)],
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
        handlers: uniqueHandler.map(h => h.slug ?? ''),
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
    // CASE 1: Pure Chat
    // ============================================================
    if (safePlan.chat === true && safePlan.tools.length === 0 && safePlan.knowledge.length === 0) {
      console.log(`[ExecuteSafePlan] Pure chat mode - using LLM strategy`)
      
      try {
        const result = await executionContext.run(
          "llm",
          {},
          {},
          context

        )
        results.chat = result
      } catch (error) {
        console.error(`[ExecuteSafePlan] Failed chat:`, error)
        results.chat = { error: String(error) }
      }
      
      return results
    }
    
    // ============================================================
    // CASE 2: Execute Tools from safePlan (with param extraction)
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
        const toolResults = await this.executeToolsWithContext(allTools, safeParams, context)
        
        // Return single value if only one tool
        if (allTools.length === 1) {
          results.tools = toolResults[allTools[0].slug]
        } else {
          results.tools = toolResults
        }
      }
    }
    
    // ============================================================
    // CASE 3: Execute Knowledge from safePlan (NO param extraction needed)
    // ============================================================
    if (safePlan.knowledge.length > 0) {
      // results.llmModel = config.ollama.naturalModel

      console.log(`[ExecuteSafePlan] Executing knowledge:`, safePlan.knowledge)
      const allKnowledge = await knowledgeHelper.getKnowledgeBySlugs(safePlan.knowledge)

      try {
        // Use knowledge strategy via execution context
        const knowledgeResult = await this.executeKnowledgesWithContext(allKnowledge, context)
        
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
    // CASE 4: Execute Handler from safePlan (NO param extraction needed)
    // ============================================================
    if (safePlan.handlers && safePlan.handlers.length > 0) {
      try {
        // Use handler strategy via execution context
        const handlerResult = await this.executeHandlerWithContext(safePlan.handlers, context)
        
        // console.log('[ExecuteSafePlan] Handler result:', handlerResult)
        // Return single value if only one handler
        if (safePlan.handlers.length === 1) {
          results.handler = handlerResult
        } else {
          results.handler = handlerResult
        }
      } catch (error) {
        console.error(`[ExecuteSafePlan] Failed handler execution:`, error)
        results.handler = { error: String(error) }
      }
    }
    console.log(`[ExecuteSafePlan] Results:`, results)
    return results
  }

  // ============================================================
  // HELPER: Execute tools using execution context
  // ============================================================
  private async executeToolsWithContext(
    tools: Tool[],
    params: Record<string, unknown>,
    context: any
  ): Promise<Record<string, unknown>> {

    const toolPromises = tools.map(async (tool) => {
      try {
        // Filter params specific to this tool
        const toolParams = toolService.getToolParams(tool)
        const toolParamNames = new Set(toolParams.map(p => p.name))
        
        const filteredParams: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (toolParamNames.has(key) && value !== undefined && value !== null) {
            filteredParams[key] = value
          }
        }
        
        // Execute tool using execution context
        const result = await executionContext.run("tool", tool, filteredParams, context)
        
        return { slug: tool.slug, status: 'fulfilled' as const, value: result }
      } catch (error) {
        console.error(`[ExecuteToolsWithContext] Failed tool ${tool.slug}:`, error)
        return { slug: tool.slug, status: 'rejected' as const, reason: error }
      }
    })
    
    const settledTools = await Promise.all(toolPromises)
    
    const results: Record<string, unknown> = {}
    for (const res of settledTools) {
      if (res.status === 'fulfilled') {
        results[res.slug] = res.value
      } else {
        results[res.slug] = { error: String(res.reason) }
      }
    }
    
    return results
  }

  // ============================================================
  // HELPER: Execute knowledge using execution context (RAG-safe)
  // ============================================================
  private async executeKnowledgesWithContext(
    knowledges: Knowledge[],
    context: any
  ): Promise<Record<string, unknown>> {
    console.log(`[ExecuteKnowledgesWithContext] Executing ${knowledges.length} knowledge(s)`)

    const knowledgePromises = knowledges.map(async (knowledge) => {
      try {
        const result = knowledge.content

        return {
          slug: knowledge.slug,
          status: 'fulfilled' as const,
          value: result,
        }

      } catch (error) {
        console.error(
          `[ExecuteKnowledgesWithContext] Failed knowledge ${knowledge.slug}:`,
          error
        )

        return {
          slug: knowledge.slug,
          status: 'rejected' as const,
          reason: error,
        }
      }
    })

    // =========================================================
    // SAME AS TOOL: Promise.all + settle normalization
    // =========================================================
    const settled = await Promise.all(knowledgePromises)

    const results: Record<string, unknown> = {}

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        results[res.slug] = res.value
      } else {
        results[res.slug] = {
          error: String(res.reason),
        }
      }
    }

    return results
  }

  // ============================================================
  // HELPER: Execute handler using execution context (RAG-safe)
  // ============================================================
  private async executeHandlerWithContext(
    handlers: any[],
    context: any
  ): Promise<Record<string, unknown>> {
    console.log(`[ExecuteHandlersWithContext] Executing ${handlers.length} knowledge(s)`)

    const handlerPromises = handlers.map(async (handler) => {
      try {
        const result = await executionContext.run("handler", {handlerKey: handler}, {}, context)
        return {
          slug: handler,
          status: 'fulfilled' as const,
          value: result,
        }

      } catch (error) {
        console.error(
          `[ExecuteHandlersWithContext] Failed knowledge ${handler.slug}:`,
          error
        )

        return {
          slug: handler,
          status: 'rejected' as const,
          reason: error,
        }
      }
    })

    // =========================================================
    // SAME AS TOOL: Promise.all + settle normalization
    // =========================================================
    const settled = await Promise.all(handlerPromises)

    const results: Record<string, unknown> = {}

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        results[res.slug] = res.value
      } else {
        results[res.slug] = {
          error: String(res.reason),
        }
      }
    }

    return results
  }

  // ============================================================
  // STAGE 5 — NATURALIZATION
  // ============================================================
  private async naturalize(input: PipelineInput, apiResult: unknown) {
    return await naturalizationService.naturalize(
      apiResult,
      input.text,
      input.attributes?.name as string,
      input.language ?? 'Indonesia'
    )
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