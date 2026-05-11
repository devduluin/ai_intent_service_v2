import { FastifyInstance } from 'fastify'
import { intentRoutes } from './intent.route'

export async function registerRoutes(fastify: FastifyInstance) {
  // health check biar gampang test
  fastify.get('/health', async () => {
    return { status: 'ok' }
  })

  // Chat / Intent pipeline
  await fastify.register(intentRoutes, { prefix: '/intent' })

  // future:
  // await fastify.register(intentCrudRoutes, { prefix: '/admin/intents' })
}