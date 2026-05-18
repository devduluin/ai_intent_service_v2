import { PipelineInput, Tool } from "../../types";
import { ExecutionStrategy } from '../../types/execution.types';
import { toolService } from '../../services/tools.service';
import { toolExecutorService } from '../../services/toolExecutor.service';

export class ToolExecutionStrategy implements ExecutionStrategy {

  async execute(
    tools: Tool[],
    params: Record<string, unknown>,
    context: PipelineInput
  ): Promise<Record<string, unknown>> {

    const toolPromises = tools.map(async (tool) => {
      try {
        // Filter params specific to this tool
        const toolParams = toolService.getToolParams(tool)
        const toolParamNames = new Set(toolParams.map(p => p.name))
        
        const filteredParams: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (toolParamNames.has(key) && value !== undefined && value !== null) {
            filteredParams[key] = value
          }
        }
        
        // Execute tool using execution context
        // const result = await executionContext.run("tool", tool, filteredParams, context)
        const result = await toolExecutorService.execute(tool, params);
        
        return { slug: tool.slug, status: 'fulfilled' as const, value: result }
      } catch (error) {
        console.error(`[ExecuteToolsWithContext] Failed tool ${tool.slug}:`, error)
        return { slug: tool.slug, status: 'rejected' as const, reason: error }
      }
    })
    
    const settledTools = await Promise.all(toolPromises)
    
    const results: Record<string, unknown> = {}
    for (const res of settledTools) {
      if (res.status === 'fulfilled') {
        results[res.slug] = res.value.data
      } else {
        results[res.slug] = { error: String(res.reason) }
      }
    }
    
    return results
  }
}