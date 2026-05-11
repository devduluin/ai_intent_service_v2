import { Op } from 'sequelize'
import { KnowledgeModel } from '../database/models'
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
  // MAPPER → DB MODEL → DOMAIN OBJECT
  // =========================================================
  private mapKnowledge(knowledge: KnowledgeModel): Knowledge {
    return {
      id: knowledge.id,
      slug: knowledge.slug,
      title: knowledge.title,
      description: knowledge.description || '',
      content: knowledge.content,
      type: knowledge.type,
      isActive: knowledge.isActive
    }
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
      where: {
        slug,
        isActive: true
      }
    })

    if (!data) return null

    return this.mapKnowledge(data)
  }

  // =========================================================
  // FIND BY MULTIPLE SLUGS (ORDER PRESERVED)
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
  // FIND BY TYPE (FAQ / ARTICLE / POLICY)
  // =========================================================
  async findByType(type: 'faq' | 'article' | 'policy'): Promise<Knowledge[]> {
    const data = await KnowledgeModel.findAll({
      where: {
        type,
        isActive: true
      },
      order: [['createdAt', 'ASC']]
    })

    return data.map(item => this.mapKnowledge(item))
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