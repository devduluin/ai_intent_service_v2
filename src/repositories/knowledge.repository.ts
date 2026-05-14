import { Op } from 'sequelize'
import { KnowledgeModel } from '../database/models'
import IntentKnowledgeMappingModel from '../database/models/Intent-knowledge-mapping.model'
import KnowledgeSourceModel from '../database/models/Knowledge-source.model'

import type { Knowledge } from '../types'

class KnowledgeRepository {

  // =========================================================
  // BASE QUERY CONFIG
  // =========================================================
  private baseQuery = {
    where: { isActive: true },
    order: [['createdAt', 'ASC']] as any
  }

  // =========================================================
  // MAPPER → DB → DOMAIN
  // =========================================================
  private mapKnowledge(model: KnowledgeModel): Knowledge {
    return {
      id: model.id,
      slug: model.slug,
      title: model.title,
      description: model.description || '',
      content: model.content  || '',
      type: model.type,
      isActive: model.isActive,
      ingestionStatus: model.ingestionStatus
    }
  }

  // =========================================================
  // WORKER ENTRY POINT
  // =========================================================
  async findById(id: string): Promise<Knowledge | null> {
    const data = await KnowledgeModel.findByPk(id)
    if (!data) return null
    return this.mapKnowledge(data)
  }

  // =========================================================
  // INGESTION STATUS UPDATE
  // =========================================================
  async updateStatus(
    id: string,
    status: 'idle' | 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    await KnowledgeModel.update(
      { ingestionStatus: status },
      { where: { id } }
    )
  }

  // Optional sugar helpers
  async setProcessing(id: string) {
    return this.updateStatus(id, 'processing')
  }

  async setComplete(id: string) {
    return this.updateStatus(id, 'completed')
  }

  async setFailed(id: string) {
    return this.updateStatus(id, 'failed')
  }

  // =========================================================
  // FIND ALL ACTIVE KNOWLEDGE
  // =========================================================
  async findAllActive(): Promise<Knowledge[]> {
    const data = await KnowledgeModel.findAll(this.baseQuery)
    return data.map(item => this.mapKnowledge(item))
  }

  // =========================================================
  // FIND BY SLUG
  // =========================================================
  async findBySlug(slug: string): Promise<Knowledge | null> {
    const data = await KnowledgeModel.findOne({
      where: { slug, isActive: true }
    })

    if (!data) return null
    return this.mapKnowledge(data)
  }

  // =========================================================
  // LEGACY FALLBACK (NO VECTOR RESULT)
  // =========================================================
  async findBySlugs(slugs: string[]): Promise<Knowledge[]> {
    if (!slugs.length) return []

    const data = await KnowledgeModel.findAll({
      where: {
        slug: { [Op.in]: slugs },
        isActive: true
      }
    })

    const mapped = data.map(item => this.mapKnowledge(item))
    const mapBySlug = new Map(mapped.map(k => [k.slug, k]))

    return slugs
      .map(slug => mapBySlug.get(slug))
      .filter(Boolean) as Knowledge[]
  }

  // =========================================================
  // FIND BY TYPE
  // =========================================================
  async findByType(type: 'faq' | 'article' | 'policy'): Promise<Knowledge[]> {
    const data = await KnowledgeModel.findAll({
      where: { type, isActive: true },
      order: [['createdAt', 'ASC']]
    })

    return data.map(item => this.mapKnowledge(item))
  }

  // =========================================================
  // RUNTIME ENTRY POINT (CHAT PIPELINE)
  // =========================================================
  async findKnowledgeIdsByIntent(intentId: string): Promise<string[]> {
    const mappings = await IntentKnowledgeMappingModel.findAll({
      where: { intentId },
      attributes: ['knowledgeId']
    })

    return mappings.map(m => m.knowledgeId)
  }

  // =========================================================
  // ADMIN / INGESTION VIEW
  // =========================================================
  async findWithSources(slug: string) {
    return KnowledgeModel.findOne({
      where: { slug, isActive: true },
      include: [
        {
          model: KnowledgeSourceModel,
          as: 'sources'
        }
      ]
    })
  }

  // =========================================================
  // CREATE KNOWLEDGE (ADMIN)
  // =========================================================
  async create(data: {
    slug: string
    title: string
    description: string
    type: 'faq' | 'article' | 'policy'
  }): Promise<Knowledge> {

    const created = await KnowledgeModel.create({
      slug: data.slug,
      title: data.title,
      description: data.description,
      type: data.type,
      isActive: true,
      ingestionStatus: 'idle',
      lastIngestedAt: new Date()
    })

    return this.mapKnowledge(created)
  }

  // =========================================================
  // UPDATE METADATA
  // =========================================================
  async update(
    id: string,
    data: Partial<{
      title: string
      description: string
      type: 'faq' | 'article' | 'policy'
      isActive: boolean
    }>
  ): Promise<void> {
    await KnowledgeModel.update(data, { where: { id } })
  }

  // =========================================================
  // DEBUG / OBSERVABILITY
  // =========================================================
  async listSlugs(): Promise<string[]> {
    const data = await KnowledgeModel.findAll({
      attributes: ['slug'],
      where: { isActive: true }
    })

    return data.map(item => item.slug)
  }
}

export const knowledgeRepository = new KnowledgeRepository()