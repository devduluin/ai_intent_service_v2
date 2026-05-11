import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

export async function swaggerPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'AI Intent API',
        description: 'Nomic Embed + Intent Matching + API Dispatch + LLM Naturalization',
        version: '1.0.0',
      },
      tags: [
        { name: 'Chat', description: 'Endpoint utama untuk query natural language' },
        { name: 'System', description: 'Health check dan info sistem' },
      ],
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { deepLinking: false },
  })
}
