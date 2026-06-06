import { Op } from 'sequelize'
import {
  ToolModel,
  ToolParameterModel,
} from '../database/models'

import type { Tool } from '../types'

class ToolRepository {

  // =========================================================
  // BASE INCLUDE (REUSABLE)
  // =========================================================
  private baseInclude = [
    {
      model: ToolParameterModel,
      as: 'parameters',
      required: false
    }
  ]

  // =========================================================
  // MAPPER → DB MODEL → DOMAIN OBJECT
  // =========================================================
  private mapTool(tool: any): Tool {
    return {
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      url: tool.url,
      method: tool.method,
      isActive: tool.isActive,
      parameters: (tool.parameters || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        isRequired: p.isRequired,
        description: p.description,
        defaultValue: p.defaultValue,
        extractPrompt: p.extractPrompt,
        label: p.label,
        config: p.config,
        order: p.order,
        isHidden: p.isHidden,
      }))
    }
  }

  // =========================================================
  // FIND ALL ACTIVE TOOLS
  // =========================================================
  async findAllActive(): Promise<Tool[]> {
    const tools = await ToolModel.findAll({
      where: { isActive: true },
      include: this.baseInclude,
      order: [['createdAt', 'ASC']]
    })

    return tools.map(t => this.mapTool(t))
  }

  // =========================================================
  // FIND BY SLUG (SINGLE)
  // =========================================================
  async findBySlug(slug: string): Promise<Tool | null> {
    const tool = await ToolModel.findOne({
      where: { slug, isActive: true },
      include: this.baseInclude
    })

    if (!tool) return null

    return this.mapTool(tool)
  }

  // =========================================================
  // 🔥 FIND BY MULTIPLE SLUGS (CORE FUNCTION)
  // =========================================================
  async findBySlugs(slugs: string[]): Promise<Tool[]> {
    if (!slugs.length) return []

    const tools = await ToolModel.findAll({
      where: {
        slug: { [Op.in]: slugs },
        isActive: true
      },
      include: this.baseInclude
    })

    // 🔥 IMPORTANT: preserve planner order
    const mapped = tools.map(t => this.mapTool(t))
    const mapBySlug = new Map(mapped.map(t => [t.slug, t]))

    return slugs
      .map(slug => mapBySlug.get(slug))
      .filter(Boolean) as Tool[]
  }

  // =========================================================
  // FIND TOOLS BY INTENT ID (OPTIONAL - ADMIN / DEBUG)
  // =========================================================
  async findByIntentId(intentId: string): Promise<Tool[]> {
    const tools = await ToolModel.findAll({
      include: [
        ...this.baseInclude,
        {
          association: 'intents',
          where: { id: intentId },
          through: { attributes: [] }
        }
      ]
    })

    return tools.map(t => this.mapTool(t))
  }

  // =========================================================
  // DEBUG / OBSERVABILITY
  // =========================================================
  async listSlugs(): Promise<string[]> {
    const tools = await ToolModel.findAll({
      attributes: ['slug'],
      where: { isActive: true }
    })

    return tools.map(t => t.slug)
  }
}

export const toolRepository = new ToolRepository()