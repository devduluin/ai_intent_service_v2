// services/knowledge.service.ts
import { knowledgeRepository } from '../repositories/knowledge.repository'
import type { Knowledge } from '../types'

type CreateKnowledgeDTO = {
  slug: string
  title: string
  description?: string
  type?: 'faq' | 'article' | 'policy'
}

type UpdateKnowledgeDTO = {
  title?: string
  description?: string
  type?: 'faq' | 'article' | 'policy'
  isActive?: boolean
}

class KnowledgeService {

  // =========================================================
  // CREATE KNOWLEDGE (DOCUMENT CONTAINER)
  // =========================================================
  async create(dto: CreateKnowledgeDTO): Promise<Knowledge> {
    // cek slug duplicate
    const existing = await knowledgeRepository.findBySlug(dto.slug)
    if (existing) {
      throw new Error('Knowledge slug already exists')
    }

    const created = await knowledgeRepository.create({
      slug: dto.slug,
      title: dto.title,
      description: dto.description ?? '',
      type: dto.type ?? 'article'
    })

    return created
  }

  // =========================================================
  // LIST KNOWLEDGE (ADMIN)
  // =========================================================
  async list(): Promise<Knowledge[]> {
    return knowledgeRepository.findAllActive()
  }

  // =========================================================
  // GET DETAIL BY ID
  // =========================================================
  async detail(id: string): Promise<Knowledge> {
    const knowledge = await knowledgeRepository.findById(id)
    if (!knowledge) {
      throw new Error('Knowledge not found')
    }

    return knowledge
  }

  // =========================================================
  // UPDATE METADATA
  // =========================================================
  async update(id: string, dto: UpdateKnowledgeDTO): Promise<void> {
    const existing = await knowledgeRepository.findById(id)
    if (!existing) {
      throw new Error('Knowledge not found')
    }

    await knowledgeRepository.update(id, dto)
  }

  // =========================================================
  // SOFT DELETE / DEACTIVATE
  // =========================================================
  async deactivate(id: string): Promise<void> {
    const existing = await knowledgeRepository.findById(id)
    if (!existing) {
      throw new Error('Knowledge not found')
    }

    await knowledgeRepository.update(id, { isActive: false })
  }
}

export const knowledgeService = new KnowledgeService()