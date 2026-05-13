import { knowledgeSourceRepository } from '../repositories/knowledgeSource.repository'
import { knowledgeRepository } from '../repositories/knowledge.repository'
import { rabbitmqService } from './rabbitmq.service'
import { QUEUE_KNOWLEDGE_INGEST } from '../types/queue'

class KnowledgeSourceService {

  // =========================================================
  // CREATE SOURCE + TRIGGER INGESTION JOB
  // =========================================================
  async createSource(dto: {
    knowledgeId: string
    type: 'url' | 'pdf' | 'docx' | 'text'
    content?: string
    url?: string
  }) {

    // 1️⃣ pastikan knowledge ada
    const knowledge = await knowledgeRepository.findById(dto.knowledgeId)
    if (!knowledge) {
      throw new Error('Knowledge not found')
    }

    // 2️⃣ create source
    const source = await knowledgeSourceRepository.create({
      knowledgeId: dto.knowledgeId,
      type: dto.type,
      rawText: dto.content,
      url: dto.url
    })

    // 3️⃣ update ingestion status → processing
    await knowledgeRepository.setProcessing(dto.knowledgeId)

    // 4️⃣ publish job ke RabbitMQ
    const channel = await rabbitmqService.getChannel()
    await channel.assertQueue(QUEUE_KNOWLEDGE_INGEST, { durable: true })

    channel.sendToQueue(
      QUEUE_KNOWLEDGE_INGEST,
      Buffer.from(JSON.stringify({
        sourceId: source.id
      })),
      { persistent: true }
    )

    return source
  }

  // =========================================================
  // LIST SOURCES BY KNOWLEDGE
  // =========================================================
  async listSources(knowledgeId: string) {
    const knowledge = await knowledgeRepository.findById(knowledgeId)
    if (!knowledge) {
      throw new Error('Knowledge not found')
    }

    return knowledgeSourceRepository.findByKnowledgeId(knowledgeId)
  }
}

export const knowledgeSourceService = new KnowledgeSourceService()