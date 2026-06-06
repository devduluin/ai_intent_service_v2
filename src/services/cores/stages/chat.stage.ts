import { generalChatService } from '../../generalChat.service';
import { episodicMemoryService } from '../../episodic-memory.service';
import { workingMemoryService } from '../../workingMemory.service';
import { userProfileService } from '../../user-profile.service';
import { WorkingMemoryUpdater } from '../memory/working-memory-updater';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import { toolResultCache } from '../../memories/toolResultCache.service';
import type { PipelineInput, PipelineResult } from '../../../types';
import type { Agent } from '../../../types/agent.types';
import type { ContextCache } from './types/context-cache';

const DEFAULT_TIMEOUT = 15000;

// ============================================================
// ChatStage
// ============================================================

/**
 * ChatStage - Handles pure chat conversations
 * 
 * Responsibilities:
 * - Call generalChatService for AI response
 * - Update episodic memory with conversation
 * - Update working memory to clear workflow context
 * - Return formatted PipelineResult
 */
export class ChatStage {
  private workingMemoryUpdater: WorkingMemoryUpdater;

  constructor() {
    this.workingMemoryUpdater = new WorkingMemoryUpdater();
  }

  /**
   * Execute pure chat flow
   *
   * @param input - Pipeline input with user query
   * @param agent - Agent context for LLM
   * @param startTotal - Start time for metrics
   * @param options - Optional context cache from previous execution
   * @returns PipelineResult with chat response
   */
  async execute(
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    options?: { contextCache?: ContextCache }
  ): Promise<PipelineResult> {
    try {
      // 1. Fetch cached tool results for context
      const sessionKey = `${input.user_id}:${input.app_name}`;
      const cachedData = await toolResultCache.get(sessionKey, undefined, { skipRedis: false });

      // ✅ PHASE 1: Fetch recent episodic memories for long-term context
      const recentContext = await episodicMemoryService.getRecentContext(
        input.user_id,
        input.app_name,
        3  // limit
      );


      // ✅ PHASE 2: Fetch working memory for current context
      const workingMemory = await workingMemoryService.get(input.user_id, input.app_name);


      // Build enhanced context with cached tool results AND episodic memories AND working memory
      const enhancedContextCache: ContextCache = {
        ...options?.contextCache,
        previousToolResults: (cachedData?.result as Record<string, unknown>) || options?.contextCache?.previousToolResults,
        cachedToolSlug: cachedData?.toolSlug,
        episodicMemories: recentContext ? [{  // ✅ ADD EPISODIC MEMORIES
          summary: recentContext,
          content: recentContext
        }] : undefined,
        workingMemory: workingMemory ? {  // ✅ ADD WORKING MEMORY
          activeIntent: workingMemory.activeIntent || undefined,
          activeEntities: workingMemory.activeEntities,
          activeTool: workingMemory.activeTool,
          continuationHints: workingMemory.continuationHints
        } : undefined,
        hasCachedContext: !!cachedData?.result || !!recentContext || !!workingMemory?.activeIntent
      };

      // 2. Get AI response from general chat service (with enhanced context + user profile)
      const userProfileContext = await userProfileService.getContext(input.user_id, input.app_name).catch(() => null);
      const aiResponse = await withTimeout(
        generalChatService.handle(input, agent, enhancedContextCache, undefined, userProfileContext ?? undefined),
        DEFAULT_TIMEOUT,
        'generalChatService.handle'
      );

      // 4. Update working memory (clear workflow context)
      await this.workingMemoryUpdater.update(
        input.user_id,
        input.app_name,
        {
          type: 'chat',
          chatResponse: aiResponse,
          activeIntent: 'general_chat'
        }
      );

      // 5. Return formatted result
      return PipelineFormatter.buildEarly(
        {
          intent: 'general_chat',
          score: 1,
          message: aiResponse
        },
        startTotal
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
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
}
