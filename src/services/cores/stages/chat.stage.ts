import { generalChatService } from '../../generalChat.service';
import { episodicMemoryService } from '../../episodic-memory.service';
import { WorkingMemoryUpdater } from '../memory/working-memory-updater';
import { ConversationUtil } from '../../../utils/conversation.util';
import { PipelineFormatter } from '../../../utils/pipeline-formatter.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import type { PipelineInput, PipelineResult } from '../../../types';
import type { Agent } from '../../../types/agent.types';

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
   * @returns PipelineResult with chat response
   */
  async execute(
    input: PipelineInput,
    agent: Agent,
    startTotal: number
  ): Promise<PipelineResult> {
    try {
      // 1. Get AI response from general chat service
      const aiResponse = await withTimeout(
        generalChatService.handle(input, agent),
        DEFAULT_TIMEOUT,
        'generalChatService.handle'
      );

      // 2. Build messages for episodic memory
      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: aiResponse
      });

      // 3. Update episodic memory
      await episodicMemoryService.summarize(
        agent,
        'general_chat',
        input.user_id,
        input.app_name,
        messages
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
