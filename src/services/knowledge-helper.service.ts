// services/knowledge-helper.service.ts
import { knowledgeRepository } from '../repositories/knowledge.repository'
import type { Knowledge } from '../types'

class KnowledgeHelper {

  // =========================================================
  // GET KNOWLEDGE BY SLUGS
  // =========================================================
  async getKnowledgeBySlugs(slugs: string[]): Promise<Knowledge[]> {
    if (!slugs.length) return []
    return await knowledgeRepository.findBySlugs(slugs)
  }

  // =========================================================
  // GET SINGLE KNOWLEDGE BY SLUG
  // =========================================================
  async getKnowledgeBySlug(slug: string): Promise<Knowledge | null> {
    if (!slug) return null
    return await knowledgeRepository.findBySlug(slug)
  }

  // =========================================================
  // GROUP KNOWLEDGE BY TYPE
  // =========================================================
  async getKnowledgeByType(
    type: any
  ): Promise<Knowledge[]> {
    return await knowledgeRepository.findByType(type)
  }

  // =========================================================
  // GET KNOWLEDGE CONTENT (RAW TEXT FOR LLM CONTEXT)
  // =========================================================
  getKnowledgeContent(knowledge: Knowledge): string {
    const title = knowledge.title || ''
    const description = knowledge.description || ''
    const content = knowledge.content || ''

    return [
      `TITLE: ${title}`,
      description ? `DESCRIPTION: ${description}` : null,
      `CONTENT: ${content}`
    ]
      .filter(Boolean)
      .join('\n')
  }

  // =========================================================
  // GET MULTIPLE KNOWLEDGE CONTEXT (FOR RAG)
  // =========================================================
  getKnowledgeContexts(knowledgeList: Knowledge[]): string {
    return knowledgeList
      .map((k, index) => {
        return `
[KNOWLEDGE ${index + 1}]
${this.getKnowledgeContent(k)}
        `.trim()
      })
      .join('\n\n')
  }

  // =========================================================
  // LIST ALL SLUGS (DEBUG / OBSERVABILITY)
  // =========================================================
  async listSlugs(): Promise<string[]> {
    return await knowledgeRepository.listSlugs()
  }
}

export const knowledgeHelper = new KnowledgeHelper()