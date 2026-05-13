import { FastifyInstance } from 'fastify'
import { intentRoutes } from './intent.route'

export async function registerRoutes(fastify: FastifyInstance) {
  // health check biar gampang test
  fastify.get('/health', async () => {
    return { status: 'ok' }
  })

  // Chat / Intent pipeline
  await fastify.register(intentRoutes, { prefix: '/intent' })

  // Admin routes for Dashboard
  const { adminRoutes } = await import('./admin.route')
  await fastify.register(adminRoutes, { prefix: '/admin' })
}