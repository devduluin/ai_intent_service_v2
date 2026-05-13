import KnowledgeSourceModel from '../database/models/Knowledge-source.model'

export type KnowledgeSource = {
  id: string
  knowledgeId: string
  type: 'url' | 'pdf' | 'docx' | 'text'
  rawText?: string | null
  url?: string | null
  createdAt?: Date
}

class KnowledgeSourceRepository {

  private map(model: KnowledgeSourceModel): KnowledgeSource {
    return {
      id: model.id,
      knowledgeId: model.knowledgeId,
      type: model.type,
      rawText: model.rawText,
      url: model.url,
      createdAt: model.createdAt
    }
  }

  // =========================================================
  // CREATE SOURCE
  // =========================================================
  async create(data: {
    knowledgeId: string
    type: 'url' | 'pdf' | 'docx' | 'text'
    rawText?: string
    url?: string
  }): Promise<KnowledgeSource> {

    const source = await KnowledgeSourceModel.create({
      knowledgeId: data.knowledgeId,
      type: data.type,
      rawText: data.rawText ?? null,
      url: data.url ?? null
    })

    return this.map(source)
  }

  // =========================================================
  // FIND BY KNOWLEDGE
  // =========================================================
  async findByKnowledgeId(knowledgeId: string): Promise<KnowledgeSource[]> {
    const rows = await KnowledgeSourceModel.findAll({
      where: { knowledgeId },
      order: [['createdAt', 'DESC']]
    })

    return rows.map(row => this.map(row))
  }

  // =========================================================
  // FIND BY ID (worker needs this)
  // =========================================================
  async findById(id: string): Promise<KnowledgeSource | null> {
    const row = await KnowledgeSourceModel.findByPk(id)
    if (!row) return null
    return this.map(row)
  }
}

export const knowledgeSourceRepository = new KnowledgeSourceRepository()