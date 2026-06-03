// services/tool-helper.service.ts
import { toolRepository } from '../repositories/tool.repository'
import { PipelineValidator } from '../utils/pipeline-validator.util'
import type { Tool, ToolParam, ToolMissingParams, Intent } from '../types'

class ToolService {
  
  async getToolsBySlugs(slugs: string[]): Promise<Tool[]> {
    if (!slugs.length) return []
    return await toolRepository.findBySlugs(slugs)
  }

// services/tool-helper.service.ts
getToolParams(tool: Tool): ToolParam[] {
  if (tool.parameters && Array.isArray(tool.parameters) && tool.parameters.length > 0) {
    const mapped = tool.parameters.map(param => ({
      name: param.name,
      type: param.type || 'string',
      description: param.description || '',
      isRequired: param.isRequired ?? false,
      defaultValue: param.defaultValue,
      extractPrompt: param.extractPrompt || `Ambil nilai ${param.name} dari input user`,
      label: param.label,
      config: param.config,
      order: param.order ?? 0,
      isHidden: param.isHidden ?? false,
    }))
    console.log(`[ToolHelper] Mapped params:`, mapped.map(p => ({ name: p.name, isRequired: p.isRequired, defaultValue: p.defaultValue })))
    return mapped
  }
  console.log(`[ToolHelper] No parameters found for tool: ${tool.slug}`)
  return []
}

  async getAllParamsForIntent(intent: Intent): Promise<ToolParam[]> {
    if (!intent.tools || intent.tools.length === 0) {
      return []
    }
    
    const toolSlugs = intent.tools.map(t => t.tool.slug)
    const tools = await this.getToolsBySlugs(toolSlugs)
    
    const allParams: ToolParam[] = []
    const seen = new Set<string>()
    
    for (const tool of tools) {
      const toolParams = this.getToolParams(tool)
      for (const param of toolParams) {
        if (!seen.has(param.name)) {
          seen.add(param.name)
          allParams.push(param)
        }
      }
    }
    
    return allParams
  }

  async getMissingParamsForTools(
    tools: Tool[],
    params: Record<string, unknown>
  ): Promise<ToolMissingParams[]> {
    const result: ToolMissingParams[] = []
    for (const tool of tools) {
      const toolParams = this.getToolParams(tool)
      const missing = PipelineValidator.getMissingParamsFromTools(toolParams, params)
      if (missing.length > 0) {
        result.push({ tool, missing })
      }
    }
    return result
  }

  /**
   * Get missing params for a single tool
   */
  getMissingParamsFromTool(
    tool: Tool,
    params: Record<string, unknown>
  ): string[] {
    const toolParams = this.getToolParams(tool);
    return PipelineValidator.getMissingParamsFromTools(toolParams, params);
  }

  async getToolsForIntent(intent: Intent): Promise<Tool[]> {
    if (!intent.tools || intent.tools.length === 0) {
      return []
    }

    const toolSlugs = intent.tools.map(t => t.tool.slug)
    return await this.getToolsBySlugs(toolSlugs)
  }
}

export const toolService = new ToolService()
