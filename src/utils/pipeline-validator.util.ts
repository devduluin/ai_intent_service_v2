// utils/pipeline-validator.util.ts
import type { Agent, ToolParam } from '../types'

export class PipelineValidator {
  static validateAgent(agent: Agent | null, slug: string) {
    if (!agent) throw new Error(`Agent '${slug}' tidak ditemukan`);
    if (!agent.isActive) throw new Error(`Agent '${agent.name}' sedang tidak aktif`);
  }

  /**
   * Get missing parameters from a list of tool parameters
   * @param toolParams - Array of tool parameters to check
   * @param collectedParams - Already collected parameter values
   * @returns Array of missing required parameter names
   */
  static getMissingParamsFromTools(
    toolParams: ToolParam[],
    collectedParams: Record<string, any>
  ): string[] {
    if (!toolParams || toolParams.length === 0) return [];
    
    return toolParams
      .filter(p => p.isRequired && !collectedParams[p.name])
      .map(p => p.name);
  }

  /**
   * Check if user is answering a parameter question or starting a new query
   */
  static isUserAnsweringParameter(text: string): boolean {
    const t = text.toLowerCase().trim()
    
    // Very short messages are likely answers
    if (t.length <= 20) return true
    
    // Pure numbers are likely answers
    if (/^\d+$/.test(t)) return true
    
    // Simple yes/no answers
    if (/^(ya|tidak|gak|nggak|iya|yes|no)$/i.test(t)) return true
    
    // Single word answers (likely a city, name, etc.)
    if (t.split(' ').length === 1 && t.length < 30) return true
    
    // Check if this looks like a new question
    const questionIndicators = ['apa', 'bagaimana', 'kenapa', 'siapa', 'tolong', 'bisa', 'help', 'what', 'how', 'why', 'who', 'please', 'can you']
    if (questionIndicators.some(q => t.startsWith(q))) return false
    
    // Default: assume it's an answer
    return true
  }

  /**
   * Validate if a value matches the expected parameter type
   */
  static validateParamValue(param: ToolParam, value: unknown): boolean {
    if (value === undefined || value === null) return false
    
    switch (param.type) {
      case 'string':
        return typeof value === 'string' && value.trim().length > 0
        
      case 'number':
        const num = Number(value)
        return !isNaN(num)
        
      case 'boolean':
        return typeof value === 'boolean' || 
               ['true', 'false', '1', '0', 'yes', 'no'].includes(String(value).toLowerCase())
        
      default:
        return true
    }
  }

  /**
   * Validate that all required parameters for a list of tools are present
   */
  static validateRequiredParamsForTools(
    tools: Array<{ parameters?: ToolParam[] }>,
    collectedParams: Record<string, any>
  ): { isValid: boolean; missingParams: string[] } {
    const allParams: ToolParam[] = []
    
    for (const tool of tools) {
      if (tool.parameters && Array.isArray(tool.parameters)) {
        allParams.push(...tool.parameters)
      }
    }
    
    const missing = this.getMissingParamsFromTools(allParams, collectedParams)
    
    return {
      isValid: missing.length === 0,
      missingParams: missing
    }
  }
}