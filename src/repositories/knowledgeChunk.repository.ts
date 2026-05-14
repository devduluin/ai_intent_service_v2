import { Op } from 'sequelize'
import { KnowledgeChunkModel } from '../database/models'

/**
 * Domain type (dipakai service layer)
 */
export interface KnowledgeChunk {
  id: string
  knowledgeId: string
  sourceId: string
  content: string
  tokenCount: number
  metadata?: Record<string, any> | null
}

/**
 * Repository:
 * PostgreSQL = source of truth
 * ChromaDB   = vector index
 */
class KnowledgeChunkRepository {

  // =========================================================
  // MAPPER → DB MODEL → DOMAIN OBJECT
  // =========================================================
  private mapChunk(model: KnowledgeChunkModel): KnowledgeChunk {
    return {
      id: model.id,
      knowledgeId: model.knowledgeId,
      sourceId: model.sourceId,
      content: model.content,
      tokenCount: model.tokenCount,
      metadata: model.metadata
    }
  }

  // =========================================================
  // CREATE CHUNKS (INGESTION PIPELINE)
  // dipakai setelah:
  // 1. Crawl / upload document
  // 2. Split text → chunks
  // 3. Simpan metadata chunk ke Postgres
  // =========================================================
  async bulkCreate(
    chunks: Omit<KnowledgeChunk, 'id'>[]
  ): Promise<KnowledgeChunk[]> {

    if (!chunks.length) return []

    const created = await KnowledgeChunkModel.bulkCreate(chunks)

    return created.map(chunk => this.mapChunk(chunk))
  }

  // =========================================================
  // GET CHUNKS BY IDS
  // dipakai setelah query ChromaDB (vector search)
  // menjaga ranking dari similarity search
  // =========================================================
  async findByIds(ids: string[]): Promise<KnowledgeChunk[]> {
    if (!ids.length) return []

    const rows = await KnowledgeChunkModel.findAll({
      where: {
        id: { [Op.in]: ids }
      }
    })

    const mapped = rows.map(r => this.mapChunk(r))
    const mapById = new Map(mapped.map(c => [c.id, c]))

    // preserve order dari vector similarity ranking
    return ids
      .map(id => mapById.get(id))
      .filter(Boolean) as KnowledgeChunk[]
  }

  // =========================================================
  // GET CHUNK IDS BY KNOWLEDGE IDS
  // PENTING untuk scope vector search by intent
  // flow:
  // intent → knowledgeIds → chunkIds → chroma filter
  // =========================================================
  async findChunkIdsByKnowledgeIds(
    knowledgeIds: string[]
  ): Promise<string[]> {

    if (!knowledgeIds.length) return []

    const rows = await KnowledgeChunkModel.findAll({
      attributes: ['id'],
      where: {
        knowledgeId: { [Op.in]: knowledgeIds }
      }
    })

    return rows.map(row => row.id)
  }

  // =========================================================
  // GET ALL CHUNKS BY KNOWLEDGE IDS (DEBUG / ADMIN)
  // =========================================================
  async findByKnowledgeIds(
    knowledgeIds: string[]
  ): Promise<KnowledgeChunk[]> {

    if (!knowledgeIds.length) return []

    const rows = await KnowledgeChunkModel.findAll({
      where: {
        knowledgeId: { [Op.in]: knowledgeIds }
      },
      order: [['createdAt', 'ASC']]
    })

    return rows.map(r => this.mapChunk(r))
  }

  // =========================================================
  // COUNT CHUNKS BY KNOWLEDGE (OBSERVABILITY)
  // =========================================================
  async countByKnowledge(knowledgeId: string): Promise<number> {
    return KnowledgeChunkModel.count({
      where: { knowledgeId }
    })
  }

  // =========================================================
  // DELETE CHUNKS BY SOURCE (RE-INGESTION)
  // dipakai saat:
  // - recrawl web
  // - reupload PDF
  // =========================================================
  async deleteBySource(sourceId: string): Promise<void> {
    await KnowledgeChunkModel.destroy({
      where: { sourceId }
    })
  }

  // =========================================================
  // DELETE CHUNKS BY KNOWLEDGE
  // dipakai saat knowledge dihapus
  // =========================================================
  async deleteByKnowledge(knowledgeId: string): Promise<void> {
    await KnowledgeChunkModel.destroy({
      where: { knowledgeId }
    })
  }

  // =========================================================
  // DELETE MANY BY IDS (SYNC DENGAN CHROMA)
  // =========================================================
  async deleteByIds(ids: string[]): Promise<void> {
    if (!ids.length) return

    await KnowledgeChunkModel.destroy({
      where: {
        id: { [Op.in]: ids }
      }
    })
  }

  // =========================================================
  // LIST ALL IDS (MAINTENANCE / MIGRATION)
  // =========================================================
  async listAllIds(): Promise<string[]> {
    const rows = await KnowledgeChunkModel.findAll({
      attributes: ['id']
    })

    return rows.map(r => r.id)
  }

  // =========================================================
  // DEBUG: GET ALL CHUNKS
  // =========================================================
  async findAll(): Promise<KnowledgeChunk[]> {
    const rows = await KnowledgeChunkModel.findAll({
      order: [['createdAt', 'ASC']]
    })

    return rows.map(r => this.mapChunk(r))
  }
}

export const knowledgeChunkRepository = new KnowledgeChunkRepository()