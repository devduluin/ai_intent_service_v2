import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { config } from './config'
import { swaggerPlugin } from './plugins/swagger.plugin'

import { registerRoutes } from './routes'

// ============================================================
// App Factory
// ============================================================

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.server.env === 'production' ? 'info' : 'debug',
      transport:
        config.server.env !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  })

  // ----------------------------------------------------------
  // Security Plugins
  // ----------------------------------------------------------
  await fastify.register(helmet, { contentSecurityPolicy: false })
  await fastify.register(cors, { origin: true })
  await fastify.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      success: false,
      response: 'Terlalu banyak request. Coba lagi dalam 1 menit.',
    }),
  })

  // ----------------------------------------------------------
  // Swagger (dev only)
  // ----------------------------------------------------------
  if (config.server.env !== 'production') {
    await fastify.register(swaggerPlugin)
  }

  // ----------------------------------------------------------
  // Routes
  // ----------------------------------------------------------

  await fastify.register(registerRoutes, { prefix: '/api/v1' })

  // ----------------------------------------------------------
  // Global Error Handler
  // ----------------------------------------------------------
  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error)
    reply.status(error.statusCode ?? 500).send({
      success: false,
      response: error.message ?? 'Internal Server Error',
    })
  })

  return fastify
}
