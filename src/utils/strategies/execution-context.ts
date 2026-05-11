// strategies/execution-context.ts
import { ToolExecutionStrategy } from './tool-execution.strategy';
import { HandlerExecutionStrategy } from './handler-execution.strategy';
import { KnowledgeExecutionStrategy } from './knowledge-execution.strategy';
import { ExecutionStrategy } from '../../types/execution.types';
import { LlmExecutionStrategy } from './llm-execution.strategy';
import { PipelineInput } from '../../types'

export class ExecutionContext {
  private strategies: Record<string, ExecutionStrategy> = {
    tool: new ToolExecutionStrategy(),
    handler: new HandlerExecutionStrategy(),
    knowledge: new KnowledgeExecutionStrategy(),
    llm: new LlmExecutionStrategy(),
  };

  async run(type: string, attributes: any, params: Record<string, any>, context?: PipelineInput) {
    const strategy = this.strategies[type];
    if (!strategy) throw new Error(`Unknown executionType: ${type}`);
    return await strategy.execute(attributes, params, context);
  }

}

export const executionContext = new ExecutionContext();