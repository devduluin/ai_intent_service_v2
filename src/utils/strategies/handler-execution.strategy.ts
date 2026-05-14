// strategies/handler-execution.strategy.ts
import { PipelineInput, Tool } from "../../types";
import { ExecutionStrategy } from '../../types/execution.types';
import { intentRegistry } from '../../services/intent-registry.service';

export class HandlerExecutionStrategy implements ExecutionStrategy {
  async execute(
      handlers: any[],
      params: Record<string, any>,
      context: PipelineInput
    ): Promise<Record<string, unknown>> {
      console.log(`[ExecuteHandlersWithContext] Executing ${handlers.length} handler(s)`)
      console.log(`[ExecuteHandlersWithContext] handler(s)`, handlers)
  
      const handlerPromises = handlers.map(async (handler) => {
        try {
          // const result = await executionContext.run("handler", {handlerKey: handler}, {}, context)
          const handlerAction = intentRegistry.getHandler(handler);
          const result = await handlerAction(params, context);
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
}
