import { ExecutionStrategy } from '../../types/execution.types';
import { toolExecutorService } from '../../services/toolExecutor.service';
import { Tool } from "../../types";

export class ToolExecutionStrategy implements ExecutionStrategy {
  async execute(tool: Tool, params: Record<string, any>) {
    console.log(`[ToolExecutionStrategy] Executing tool: ${tool.slug}`);
    const toolList = Array.isArray(tool)
      ? tool
      : [tool]

    if (toolList.length === 0) {
      throw new Error('No tool mapping found')
    }

    return await toolExecutorService.execute(tool, params);
  }
}