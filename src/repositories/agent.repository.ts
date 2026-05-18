// repositories/agent.repository.ts
import { Op } from 'sequelize'
import {
  AgentModel,
  llmModel as LlmModel
} from '../database/models'
import type { 
  AgentCreateInput, 
  AgentUpdateInput, 
  AgentFilters,
  Agent
} from '../types/agent.types'

export class AgentRepository {
  
  /**
   * Create new agent
   */
  async create(data: AgentCreateInput): Promise<Agent> {
    const agent = await AgentModel.create({
      name: data.name,
      slug: data.slug,
      systemPrompt: data.systemPrompt,
      customPrompt: data.customPrompt,
      modelId: data.modelId,
      temperature: data.temperature || 0.7,
      maxTokens: data.maxTokens,
      memoryEnabled: data.memoryEnabled,
      description: data.description || null,
      isActive: data.isActive ?? true,
      metadata: data.metadata || null,
    })
    
    return this.toResponse(agent)
  }
  
  /**
   * Find agent by ID
   */
  async findById(id: string): Promise<Agent | null> {
    const agent = await AgentModel.findByPk(id, {
      include: [
        {
          model: LlmModel,
          as: 'llmModel',
          required: false,
        },
      ],
    })

    return agent ? this.toResponse(agent) : null
  }
  
  /**
   * Find agent by slug
   */
  async findBySlug(slug: string): Promise<Agent | null> {
    const agent = await AgentModel.findOne({
      where: { slug },
      include: [
        {
          model: LlmModel,
          as: 'llmModel',
          required: false,
        },
      ],
    })

    return agent ? this.toResponse(agent) : null
  }
  
  /**
   * Find all agents with filters
   */
  async findAll(filters?: AgentFilters): Promise<Agent[]> {
    const where: any = {}

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive
    }

    if (filters?.search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${filters.search}%` } },
        { slug: { [Op.iLike]: `%${filters.search}%` } },
        { description: { [Op.iLike]: `%${filters.search}%` } },
      ]
    }

    const agents = await AgentModel.findAll({
      where,
      include: [
        {
          model: LlmModel,
          as: 'llmModel',
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      ...(filters?.limit && { limit: filters.limit }),
      ...(filters?.offset && { offset: filters.offset }),
    })

    return agents.map((agent) => this.toResponse(agent))
  }
  
  /**
   * Update agent
   */
  async update(id: string, data: AgentUpdateInput): Promise<Agent | null> {
    const agent = await AgentModel.findByPk(id)
    
    if (!agent) {
      return null
    }
    
    await agent.update({
      name: data.name ?? agent.name,
      slug: data.slug ?? agent.slug,
      description: data.description !== undefined ? data.description : agent.description,
      isActive: data.isActive !== undefined ? data.isActive : agent.isActive,
      metadata: data.metadata !== undefined ? data.metadata : agent.metadata,
    })
    
    return this.toResponse(agent)
  }
  
  /**
   * Delete agent (soft delete by setting isActive=false)
   */
  async softDelete(id: string): Promise<boolean> {
    const agent = await AgentModel.findByPk(id)
    
    if (!agent) {
      return false
    }
    
    await agent.update({ isActive: false })
    return true
  }
  
  /**
   * Hard delete agent (permanent)
   */
  async hardDelete(id: string): Promise<boolean> {
    const deleted = await AgentModel.destroy({
      where: { id }
    })
    
    return deleted > 0
  }
  
  /**
   * Get agent with all related data (intents, etc)
   */
  async findWithRelations(id: string): Promise<any | null> {
    const agent = await AgentModel.findByPk(id, {
      include: [
        {
          association: 'intents',
          where: { isActive: true },
          required: false,
        }
      ]
    })
    
    return agent
  }
  
  /**
   * Check if slug exists
   */
  async isSlugExists(slug: string, excludeId?: string): Promise<boolean> {
    const where: any = { slug }
    
    if (excludeId) {
      where.id = { [Op.ne]: excludeId }
    }
    
    const count = await AgentModel.count({ where })
    return count > 0
  }
  
  /**
   * Convert model to response DTO
   */
  private toResponse(agent: AgentModel): Agent {
    return {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      isActive: agent.isActive,

      systemPrompt: agent.systemPrompt ?? null,
      customPrompt: agent.customPrompt ?? null,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      memoryEnabled: agent.memoryEnabled,

      metadata: agent.metadata,

      // 🧠 NEW FIELDS (LLM RELATION)
      modelId: agent.modelId,
      llmModel: agent.llmModel
        ? {
            id: agent.llmModel.id,
            name: agent.llmModel.name,
            provider: agent.llmModel.provider,
            modelCode: agent.llmModel.modelCode,
            isActive: agent.llmModel.isActive
          }
        : null,

      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }
  }
}

export const agentRepository = new AgentRepository()