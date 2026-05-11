import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { intentController } from '../controllers/intent.controller'
import type { IntentRequest, IntentResponse } from '../types'

const intentSchema = z.object({
  user_id: z.string().min(1),
  app_name: z.string().min(1),
  text: z.string().min(1).max(1000),
  language: z.string().optional(), // ← payload baru pipeline
  chat_history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .optional(),

  attributes: z.record(z.any()).optional(),
  
})

// EXAMPLE
// {
//   "user_id": "user_1",
//   "app_name": "hris",
//   "text": "jam berapa sekarang",
//   "chat_history": [
//     { "role": "user", "content": "halo namaku ardi" },
//     { "role": "assistant", "content": "halo, ada yang bisa dibantu?" }
//   ],
//   "attributes": {
//     "name": "Ardi Mahendra",
//     "params": {
//         "employee_id" :"c0c82cb7-97d6-45c2-a1b4-41b45ab6c169"
//     }
//   }
// }

export async function intentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: IntentRequest; Reply: IntentResponse }>(
    '/chat',
    async (request, reply) => {
      const parsed = intentSchema.safeParse(request.body)

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          response: 'Payload tidak valid',
        })
      }

      // lempar ke controller tanpa try/catch
      return intentController.handleIntent(parsed.data, reply)
    }
  )
}