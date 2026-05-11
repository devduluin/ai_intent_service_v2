// repositories/agent.repository.ts
import { Op } from 'sequelize'
import {
  AgentModel,
} from '../database/models'
import type { 
  CreateAgentDTO, 
  UpdateAgentDTO, 
  AgentFilters,
  AgentResponse 
} from '../types/agent.types'

export class AgentRepository {
  
  /**
   * Create new agent
   */
  async create(data: CreateAgentDTO): Promise<AgentResponse> {
    const agent = await AgentModel.create({
      name: data.name,
      slug: data.slug,
      description: data.description || null,
      isActive: data.isActive ?? true,
      metadata: data.metadata || null,
    })
    
    return this.toResponse(agent)
  }
  
  /**
   * Find agent by ID
   */
  async findById(id: string): Promise<AgentResponse | null> {
    const agent = await AgentModel.findByPk(id)
    return agent ? this.toResponse(agent) : null
  }
  
  /**
   * Find agent by slug
   */
  async findBySlug(slug: string): Promise<AgentResponse | null> {
    const agent = await AgentModel.findOne({
      where: { slug }
    })
    return agent ? this.toResponse(agent) : null
  }
  
  /**
   * Find all agents with filters
   */
  async findAll(filters?: AgentFilters): Promise<AgentResponse[]> {
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
      order: [['createdAt', 'DESC']],
      ...(filters?.limit && { limit: filters.limit }),
      ...(filters?.offset && { offset: filters.offset }),
    })
    
    return agents.map(agent => this.toResponse(agent))
  }
  
  /**
   * Update agent
   */
  async update(id: string, data: UpdateAgentDTO): Promise<AgentResponse | null> {
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
  private toResponse(agent: AgentModel): AgentResponse {
    return {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      isActive: agent.isActive,
      metadata: agent.metadata,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }
  }
}

export const agentRepository = new AgentRepository()