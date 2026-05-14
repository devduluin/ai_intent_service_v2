import { FastifyReply } from 'fastify'
import { knowledgeService } from '../services/knowledge.service'

class KnowledgeController {

  // =========================================================
  // CREATE KNOWLEDGE
  // POST /knowledge
  // =========================================================
  async create(body: any, reply: FastifyReply) {
    try {
      const data = await knowledgeService.create({
        slug: body.slug,
        title: body.title,
        description: body.description,
        type: body.type,
      })

      return reply.send({
        success: true,
        data
      })

    } catch (err: any) {
      if (err.message === 'Knowledge slug already exists') {
        return reply.status(409).send({
          success: false,
          message: err.message
        })
      }

      throw err
    }
  }

  // =========================================================
  // LIST KNOWLEDGE
  // GET /knowledge
  // =========================================================
  async list(_: any, reply: FastifyReply) {
    const data = await knowledgeService.list()

    return reply.send({
      success: true,
      data
    })
  }

  // =========================================================
  // GET DETAIL
  // GET /knowledge/:id
  // =========================================================
  async detail(params: any, reply: FastifyReply) {
    try {
      const data = await knowledgeService.detail(params.id)

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

  // =========================================================
  // UPDATE METADATA
  // PUT /knowledge/:id
  // =========================================================
  async update(params: any, body: any, reply: FastifyReply) {
    try {
      await knowledgeService.update(params.id, {
        title: body.title,
        description: body.description,
        type: body.type,
        isActive: body.isActive
      })

      return reply.send({
        success: true,
        message: 'Knowledge updated'
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
  // DELETE (SOFT DELETE)
  // DELETE /knowledge/:id
  // =========================================================
  async delete(params: any, reply: FastifyReply) {
    try {
      await knowledgeService.deactivate(params.id)

      return reply.send({
        success: true,
        message: 'Knowledge deleted'
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

export const knowledgeController = new KnowledgeController()