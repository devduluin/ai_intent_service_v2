import { FastifyReply } from 'fastify'
import { pipelineService } from '../services/pipeline.service'
import type { IntentRequest, IntentResponse } from '../types'

class IntentController {
  async handleIntent(
    body: IntentRequest,
    reply: FastifyReply
  ): Promise<IntentResponse> {
    try {
      const result = await pipelineService.run(body)
      
      return reply.send({
        success: true,
        response: result.naturalResponse,
        intent: result.intent,
        confidence: Math.round(result.score * 100) / 100,
        metadata: result.metadata,
      })
    } catch (err: any) {
      // error khusus pipeline (business error)
      if (err.stage === 'match') {
        return reply.status(422).send({
          success: false,
          response: 'Maaf, saya tidak mengerti permintaan Anda.',
        })
      }

      // selain itu lempar ke global error handler
      throw err
    }
  }
}

export const intentController = new IntentController()