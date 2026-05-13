// strategies/llm-execution.strategy.ts
import { ExecutionStrategy } from '../../types/execution.types'
import { ollamaService } from '../../services/ollama.service'

export class LlmExecutionStrategy implements ExecutionStrategy {
  async execute(intent: any, params: Record<string, any>, context: any) {
    return await ollamaService.naturalize(
      params,
      context.text,
      context.language ?? 'id'
    )
  }
}