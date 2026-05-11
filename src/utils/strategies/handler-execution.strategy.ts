// strategies/handler-execution.strategy.ts
import { ExecutionStrategy } from '../../types/execution.types';
import { intentRegistry } from '../../services/intent-registry.service';

export class HandlerExecutionStrategy implements ExecutionStrategy {
  async execute(intent: any, params: Record<string, any>, context: any) {
    if (!intent.handlerKey) throw new Error('handlerKey missing');
    const handler = intentRegistry.getHandler(intent.handlerKey);
    return await handler(params, context);
  }
}
