import { FastifyInstance } from 'fastify'
import { knowledgeController } from '../controllers/knowledge.controller'
import { knowledgeSourceController } from '../controllers/knowledgeSource.controller'
import { bodyKnowledgeSource } from '../types/index'

export async function adminKnowledgeRoutes(app: FastifyInstance) {

  // Knowledge
  app.post('/', (req, reply) =>
    knowledgeController.create(req.body, reply))

  app.get('/', (req, reply) =>
    knowledgeController.list(req, reply))

  app.get('/:id', (req, reply) =>
    knowledgeController.detail(req.params, reply))

  // Knowledge Sources
  app.post('/knowledge-source', (req, reply) =>
    knowledgeSourceController.create(req.body as bodyKnowledgeSource, reply))

  app.get('/knowledge-source/:knowledgeId', (req, reply) =>
    knowledgeSourceController.list(req.params, reply))
}