import { FastifyReply } from 'fastify'
import { knowledgeSourceService } from '../services/knowledgeSource.service'
import { bodyKnowledgeSource } from '../types/index'
class KnowledgeSourceController {

  // =========================================================
  // CREATE SOURCE + QUEUE INGESTION
  // =========================================================
  async create(body: bodyKnowledgeSource, reply: FastifyReply) {
    try {
      const data = await knowledgeSourceService.createSource({
        knowledgeId: body.knowledgeId,
        type: body.type,
        content: body.content ?? '',
        url: body.url ?? ''
      })

      return reply.send({
        success: true,
        message: 'Source created & ingestion queued',
        data
      })

    } catch (err: any) {
      if (err.message === 'Knowledge not found') {
        return reply.status(404).send({
          success: false,
          message: err.message
        })
      }

      throw err
    }
  }

  // =========================================================
  // LIST SOURCES
  // =========================================================
  async list(params: any, reply: FastifyReply) {
    try {
      const data = await knowledgeSourceService.listSources(params.knowledgeId)

      return reply.send({
        success: true,
        data
      })

    } catch (err: any) {
      if (err.message === 'Knowledge not found') {
        return reply.status(404).send({
          success: false,
          message: err.message
        })
      }

      throw err
    }
  }
}

export const knowledgeSourceController = new KnowledgeSourceController()