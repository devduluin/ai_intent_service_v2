import { rabbitmqService } from './rabbitmq.service'

const QUEUE = 'ai.knowledge.ingest'

class KnowledgeEventPublisher {

  async publishIngestion(sourceId: string) {
    const channel = await rabbitmqService.getChannel()

    await channel.assertQueue(QUEUE, { durable: true })

    const payload = JSON.stringify({ sourceId })

    channel.sendToQueue(
      QUEUE,
      Buffer.from(payload),
      { persistent: true } // survive restart
    )

    console.log('[Publisher] ingestion event sent:', sourceId)
  }
}

export const knowledgeEventPublisher = new KnowledgeEventPublisher()