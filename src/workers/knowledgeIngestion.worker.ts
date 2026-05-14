import { rabbitmqService } from '../services/rabbitmq.service'
import { knowledgeIngestionService } from '../services/knowledgeIngestion.service'
import { QUEUE_KNOWLEDGE_INGEST } from '../types/queue'

class KnowledgeIngestionWorker {

  async start() {
    const channel = await rabbitmqService.getChannel()

    await channel.assertQueue(QUEUE_KNOWLEDGE_INGEST, {
      durable: true,
    })

    // Worker QoS → process 1 job at a time
    channel.prefetch(1)

    console.log('[Worker] Knowledge Ingestion Worker started 🚀')

    channel.consume(QUEUE_KNOWLEDGE_INGEST, async (msg: any) => {
      if (!msg) return

      const content = msg.content.toString()
      console.log('[Worker] received job:', content)

      try {
        const payload = JSON.parse(content)

        await this.handleJob(payload)

        channel.ack(msg)
        console.log('[Worker] job completed ✅')

      } catch (err) {
        console.error('[Worker] job failed ❌', err)

        // requeue = false → avoid infinite loop
        channel.nack(msg, false, false)
      }

    }, { noAck: false })
  }

  private async handleJob(payload: { sourceId: string }) {
    if (!payload.sourceId) {
      throw new Error('sourceId missing in job payload')
    }

    await knowledgeIngestionService.ingestSource(payload.sourceId)
  }
}

export const knowledgeIngestionWorker = new KnowledgeIngestionWorker()