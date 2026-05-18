import {
  IntentModel,
  IntentExampleModel,
  IntentToolMappingModel,
  ToolModel,
  ToolParameterModel,
  IntentKnowledgeMappingModel,
  KnowledgeModel,
  AgentModel,
} from '../database/models'

import type {
  Intent,
  Tool,
  ToolParam,
  IntentToolMapping,
  IntentKnowledgeMapping,
} from '../types'

export class IntentRepository {

  // ============================================================
  // FIND ALL ACTIVE
  // ============================================================
  async findAllActive({ agentId = null }: { agentId?: string | null }): Promise<Intent[]> {
    const whereClause: any = { isActive: true }

    if (agentId !== null && agentId !== undefined) {
      whereClause.agentId = agentId
    }

    const rows = await IntentModel.findAll({
      where: whereClause,
      include: this.getFullInclude(),
      order: [['id', 'ASC']],
    })

    return rows.map((row) => this.toIntent(row))
  }

  // ============================================================
  // FIND BY SLUG
  // ============================================================
  async findBySlug(slug: string, agentId: string): Promise<Intent | null> {
    const row = await IntentModel.findOne({
      where: { slug, agentId, isActive: true },
      include: this.getFullInclude(),
    })

    return row ? this.toIntent(row) : null
  }

  // ============================================================
  // INCLUDE BUILDER
  // ============================================================
  private getFullInclude() {
    return [
      { model: AgentModel, as: 'agent' },
      { model: IntentExampleModel, as: 'examples' },

      // 🔥 TOOL MAPPING + TOOL + TOOL PARAMETERS
      {
        model: IntentToolMappingModel,
        as: 'toolMappings',
        include: [
          {
            model: ToolModel,
            as: 'tool',
            include: [
              {
                model: ToolParameterModel,
                as: 'parameters',
              },
            ],
          },
        ],
      },

      // 🔥 KNOWLEDGE
      {
        model: IntentKnowledgeMappingModel,
        as: 'knowledgeMappings',
        include: [{ model: KnowledgeModel, as: 'knowledge' }],
      },
    ]
  }

  // ============================================================
  // MAIN MAPPER
  // ============================================================
  private toIntent(row: any): Intent {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      agentId: row.agentId,

      executionType: row.executionType,
      handlerKey: row.executionType === 'handler' ? row.handlerKey : undefined,

      // ✔ FIX → string[]
      examples: (row.examples ?? []).map((e: any) => e.text),

      // ✔ TOOL MAPPINGS
      tools: this.mapToolMappings(row.toolMappings),

      // ✔ KNOWLEDGE MAPPINGS
      knowledge: this.mapKnowledgeMappings(row.knowledgeMappings),

      // ✔ AGENT
      agent: row.agent
        ? {
            id: row.agent.id,
            name: row.agent.name,
            slug: row.agent.slug,
            description: row.agent.description,

            systemPrompt: row.agent.systemPrompt ?? null,
            customPrompt: row.agent.customPrompt ?? null,

            llmModelId: row.agent.llmModelId ?? null,

            temperature: row.agent.temperature ?? 0.7,
            maxTokens: row.agent.maxTokens ?? null,
            memoryEnabled: row.agent.memoryEnabled ?? true,

            metadata: row.agent.metadata ?? null,

            isActive: row.agent.isActive,

            createdAt: row.agent.createdAt,
            updatedAt: row.agent.updatedAt,
          }
        : null,
    }
  }

  // ============================================================
  // TOOL MAPPINGS
  // ============================================================
  private mapToolMappings(rows: any[]): IntentToolMapping[] {
    if (!rows) return []

    return rows
      .sort((a, b) => a.priority - b.priority)
      .map((m) => ({
        id: m.id,
        priority: m.priority,
        isPrimary: m.isPrimary,

        tool: this.toTool(m.tool),

        // 🔥 PARAMS PINDAH KE SINI (IMPORTANT)
        parameters: this.mapToolParams(m.tool?.parameters),
      }))
  }

  // ============================================================
  // TOOL PARAMS
  // ============================================================
  private mapToolParams(rows: any[]): ToolParam[] {
    if (!rows) return []

    return rows.map((p) => ({
      name: p.name,
      type: p.type,
      isRequired: p.isRequired,
      description: p.description,
      defaultValue: p.defaultValue,
      required: p.isRequired,
      extractPrompt: p.extractPrompt ?? undefined,
    }))
  }

  // ============================================================
  // TOOL ENTITY
  // ============================================================
  private toTool(row: any): Tool {
    if (!row) return null as any

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      method: row.method,
      url: row.url,
      authType: row.authType,
      headers: row.headers,
      bodyTemplate: row.bodyTemplate,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  // ============================================================
  // KNOWLEDGE MAPPINGS
  // ============================================================
  private mapKnowledgeMappings(rows: any[]): IntentKnowledgeMapping[] {
    if (!rows) return []

    return rows
      .sort((a, b) => a.priority - b.priority)
      .map((m) => ({
        id: m.id,
        priority: m.priority,
        knowledge: {
          id: m.knowledge.id,
          title: m.knowledge.title,
          slug: m.knowledge.slug,
          description: m.knowledge.description, // ✔ FIX
          type: m.knowledge.type,
          content: m.knowledge.content,
          isActive: m.knowledge.isActive,
          ingestionStatus: m.knowledge.ingestionStatus,
          lastIngestedAt: m.knowledge.lastIngestedAt,
        },
      }))
  }
}

export const intentRepository = new IntentRepository()