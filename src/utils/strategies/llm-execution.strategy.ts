import { PipelineInput } from "../../types";
import { ExecutionStrategy } from '../../types/execution.types'
import { ollamaService } from '../../services/ollama.service'
import { ConversationUtil } from '../../utils/conversation.util'

export class LlmExecutionStrategy implements ExecutionStrategy {

  async execute(intent: any, params: Record<string, any>, context: PipelineInput) {

    const messages = ConversationUtil.buildMessages(context, {
      systemPrompt: intent?.systemPrompt
    })

    return await ollamaService.chatMessage(messages)
  }
}