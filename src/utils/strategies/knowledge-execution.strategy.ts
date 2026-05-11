// strategies/knowledge-execution.strategy.ts
import { ExecutionStrategy } from '../../types/execution.types'
import { PipelineInput } from '../../types'
import { generalChatService } from '../../services/generalChat.service'
interface KnowledgeContext {
  title?: string
  content: string
  type?: string
}

export class KnowledgeExecutionStrategy implements ExecutionStrategy {
  async execute(knowledge: any, params: Record<string, any>, context: PipelineInput) {

    // =========================================================
    // FIX: support BOTH single object & array
    // =========================================================
    const knowledgeList = Array.isArray(knowledge)
      ? knowledge
      : [knowledge]

    if (knowledgeList.length === 0) {
      throw new Error('No knowledge mapping found')
    }

    // =========================================================
    // FIX: correct mapping
    // =========================================================
    const formatted = knowledgeList.map((k: KnowledgeContext) => ({
      title: k.title,
      content: k.content,
      type: k.type
    }))

    return await generalChatService.handle(
      context,
      formatted,
      0.4,
      256
    )
  }
}