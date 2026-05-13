import { FastifyReply, FastifyRequest } from 'fastify'
import { adminService } from '../services/admin.service'

class AdminController {
  // Intents
  async getIntents(req: FastifyRequest, reply: FastifyReply) {
    const intents = await adminService.getAllIntents()
    return reply.send({ success: true, data: intents })
  }

  async createIntent(req: FastifyRequest, reply: FastifyReply) {
    const intent = await adminService.createIntent(req.body)
    return reply.send({ success: true, data: intent })
  }

  // Tools
  async getTools(req: FastifyRequest, reply: FastifyReply) {
    const tools = await adminService.getAllTools()
    return reply.send({ success: true, data: tools })
  }

  async createTool(req: FastifyRequest, reply: FastifyReply) {
    const tool = await adminService.createTool(req.body)
    return reply.send({ success: true, data: tool })
  }

  // Knowledge
  async getKnowledges(req: FastifyRequest, reply: FastifyReply) {
    const knowledges = await adminService.getAllKnowledges()
    return reply.send({ success: true, data: knowledges })
  }

  async createKnowledge(req: FastifyRequest, reply: FastifyReply) {
    const knowledge = await adminService.createKnowledge(req.body)
    return reply.send({ success: true, data: knowledge })
  }
  // Health Checker
  async checkToolHealth(req: FastifyRequest, reply: FastifyReply) {
    const { healthCheckerService } = await import('../services/health-checker.service')
    const results = await healthCheckerService.checkAllTools()
    return reply.send({ success: true, data: results })
  }
}

export const adminController = new AdminController()
