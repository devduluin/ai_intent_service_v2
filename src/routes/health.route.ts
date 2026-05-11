import type { FastifyInstance } from 'fastify'
import { ollamaService } from '../services/ollama.service'
import { vectorService } from '../services/vector.service'
import { intentRegistry } from '../services/intent-registry.service'
import type { HealthResponse } from '../types'

// ============================================================
// Health & Admin Routes
// ============================================================

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /health — cek status semua service
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        description: 'Health check semua service',
        tags: ['System'],
      },
    },
    async (_request, reply) => {
      const [ollamaOk, vectorOk] = await Promise.all([
        ollamaService.isHealthy(),
        vectorService.isHealthy(),
      ])

      const status = ollamaOk && vectorOk ? 'ok' : ollamaOk || vectorOk ? 'degraded' : 'error'

      return reply.status(status === 'error' ? 503 : 200).send({
        status,
        services: {
          ollama: ollamaOk,
          vectorDb: vectorOk,
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      })
    }
  )

  // GET /intents — list semua intent yang terdaftar
  fastify.get(
    '/intents',
    {
      schema: {
        description: 'List semua intent yang terdaftar',
        tags: ['System'],
      },
    },
    async (_request, reply) => {
      return reply.send({
        intents: intentRegistry.listIntents(),
        total: intentRegistry.getAll().length,
      })
    }
  )
}
