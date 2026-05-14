// services/knowledgeIngestion.service.ts
import { v4 as uuid } from 'uuid'
import { knowledgeRepository } from '../repositories/knowledge.repository'
import { knowledgeChunkRepository } from '../repositories/knowledgeChunk.repository'
import { knowledgeVectorService } from './knowledgeVector.service'
import { textExtractorService } from './knowledges/textExtractor.service'
import { textChunkerService } from './knowledges/textChunker.service'
import { KnowledgeSourceModel } from '../database/models'

class KnowledgeIngestionService {

  // =========================================================
  // ENTRY POINT WORKER
  // =========================================================
  async ingestSource(sourceId: string, agentId?: string): Promise<void> {
    console.log('[INGEST] start source:', sourceId)

    const source = await KnowledgeSourceModel.findByPk(sourceId)
    if (!source) throw new Error('Source not found')

    const knowledge = await knowledgeRepository.findById(source.knowledgeId)
    if (!knowledge) throw new Error('Knowledge not found')

    try {
      await this.markKnowledgeProcessing(knowledge.id)

      // 1️⃣ extract text
      const rawText = await this.extractSourceText(source)

      console.log(`[INGEST] raw extracted text:`, rawText)

      // 2️⃣ chunk text
      const chunks = textChunkerService.split(rawText)

      console.log(`[INGEST] ${chunks.length} chunks created`)

      // 3️⃣ delete old chunks (re-ingestion safe)
      await knowledgeChunkRepository.deleteBySource(sourceId)
      await knowledgeVectorService.deleteByKnowledge(knowledge.id)

      // 4️⃣ save chunks → Postgres
      const savedChunks = await knowledgeChunkRepository.bulkCreate(
        chunks.map(chunk => ({
          id: uuid(),
          knowledgeId: knowledge.id,
          sourceId: sourceId,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          metadata: {},
        }))
      )

      // 5️⃣ index chunks → Chroma ⭐
      await knowledgeVectorService.indexChunks(
        savedChunks.map(c => ({
          id: c.id,
          content: c.content,
          agentId: agentId ?? "",
          knowledgeId: knowledge.id,
          sourceId: sourceId,
        }))
      )

      // 6️⃣ mark ready
      await this.markKnowledgeReady(knowledge.id)

      console.log('[INGEST] DONE')
    } catch (err) {
      console.error('[INGEST] FAILED', err)
      await this.markKnowledgeFailed(knowledge.id)
      throw err
    }
  }

  // =========================================================
  // TEXT EXTRACTION ROUTER
  // =========================================================
    private async extractSourceText(source: any): Promise<string> {
    switch (source.type) {
        case 'text':
        return textExtractorService.fromText(source.rawText)

        case 'url':
        return textExtractorService.fromWeb(source.url)

        case 'pdf':
        return textExtractorService.fromPDF(source.url)

        case 'docx':
        return textExtractorService.fromDocx(source.url)

        default:
        throw new Error(`Unsupported source type: ${source.type}`)
    }
    }

  // =========================================================
  // STATUS MANAGEMENT
  // =========================================================
  private async markKnowledgeProcessing(id: string) {
    await knowledgeRepository.updateStatus(id, 'processing')
  }

  private async markKnowledgeReady(id: string) {
    await knowledgeRepository.updateStatus(id, 'completed')
  }

  private async markKnowledgeFailed(id: string) {
    await knowledgeRepository.updateStatus(id, 'failed')
  }
}

export const knowledgeIngestionService = new KnowledgeIngestionService()