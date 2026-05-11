// types/execution.types.ts
import type { Intent, ToolParam, Tool } from '../types'
export interface ExecutionStrategy {
  execute(intent: any, params: Record<string, any>, context?: any): Promise<any>;
}