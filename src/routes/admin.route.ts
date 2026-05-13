import { FastifyInstance } from 'fastify'
import { adminController } from '../controllers/admin.controller'

export async function adminRoutes(fastify: FastifyInstance) {
  // Intents
  fastify.get('/intents', adminController.getIntents)
  fastify.post('/intents', adminController.createIntent)

  // Tools
  fastify.get('/tools', adminController.getTools)
  fastify.post('/tools', adminController.createTool)

  // Knowledge
  fastify.get('/knowledges', adminController.getKnowledges)
  fastify.post('/knowledges', adminController.createKnowledge)

  // Health Checker
  fastify.get('/tools/health', adminController.checkToolHealth)
}

