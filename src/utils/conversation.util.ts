import { PipelineInput, ChatMessage } from "../types"

export class ConversationUtil {

  /**
   * Build final messages array untuk dikirim ke LLM
   * - Tidak mutate context
   * - Merge system prompt
   * - Merge episodic memory (optional)
   * - Merge chat history
   * - Tambahkan latest user message
   */
  static buildMessages(
    context: PipelineInput,
    options?: {
      systemPrompt?: string
      memoryContext?: string
    }
  ): ChatMessage[] {

    const messages: ChatMessage[] = []

    // ============================================================
    // 1. System prompt (optional)
    // ============================================================
    if (options?.systemPrompt) {
      messages.push({
        role: 'system',
        content: options.systemPrompt
      })
    }

    // ============================================================
    // 2. Episodic memory (optional)
    // ============================================================
    if (options?.memoryContext) {
      messages.push({
        role: 'system',
        content: `Conversation memory:\n${options.memoryContext}`
      })
    }

    // ============================================================
    // 3. Previous chat history
    // ============================================================
    if (context.chat_history?.length) {
      messages.push(...context.chat_history)
    }

    // ============================================================
    // 4. Latest user message
    // ============================================================
    messages.push({
      role: 'user',
      content: context.text
    })

    return messages
  }

}