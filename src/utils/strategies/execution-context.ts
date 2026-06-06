// strategies/execution-context.ts
import { ToolExecutionStrategy } from './tool-execution.strategy';
import { SkillExecutionStrategy } from './skill-execution.strategy';
import { KnowledgeExecutionStrategy } from './knowledge-execution.strategy';
import { ExecutionStrategy } from '../../types/execution.types';
import { LlmExecutionStrategy } from './llm-execution.strategy';
import { PipelineInput } from '../../types'

export class ExecutionContext {
  private strategies: Record<string, ExecutionStrategy> = {
    tool: new ToolExecutionStrategy(),
    skill: new SkillExecutionStrategy(),
    knowledge: new KnowledgeExecutionStrategy(),
    llm: new LlmExecutionStrategy(),
  };

  async run(type: string, attributes: any, params: Record<string, any>, context?: PipelineInput, data?: unknown) {
    const strategy = this.strategies[type];
    if (!strategy) throw new Error(`Unknown executionType: ${type}`);
    return await strategy.execute(attributes, params, context, data);
  }

}

export const executionContext = new ExecutionContext();
