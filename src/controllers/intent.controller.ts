import { FastifyReply, FastifyRequest } from 'fastify'
import { pipelineService } from '../services/pipeline.service'
import { intentRepository } from '../repositories/intent.repository'
import { agentRepository } from '../repositories/agent.repository'
import type { IntentRequest, IntentResponse } from '../types'
import { sanitizePublicMetadata } from '../utils/public-response.util'

class IntentController {
  async handleIntent(
    body: IntentRequest,
    reply: FastifyReply
  ): Promise<IntentResponse> {
    try {
      const result = await pipelineService.run(body)
      
      return reply.send({
        success: true,
        response: result.naturalResponse,
        intent: result.intent,
        confidence: Math.round(result.score * 100) / 100,
        metadata: sanitizePublicMetadata(result.metadata),
      })
    } catch (err: any) {
      // error khusus pipeline (business error)
      if (err.stage === 'match') {
        return reply.status(422).send({
          success: false,
          response: 'Maaf, saya tidak mengerti permintaan Anda.',
        })
      }

      // selain itu lempar ke global error handler
      throw err
    }
  }

  async listByKnowledgeAndFaq(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<any> {
    try {
      const { agent_slug, type } = request.query as { agent_slug?: string; type?: 'knowledge' | 'faq' | 'tools' }

      let agentId: string | undefined = undefined
      if (agent_slug) {
        const agent = await agentRepository.findBySlug(agent_slug)
        if (agent) {
          agentId = agent.id
        }
      }

      const activeIntents = await intentRepository.findAllActive({ agentId })

      // Filter list based on raw activeIntents relations if type is requested
      let filteredIntents = activeIntents

      if (type === 'faq') {
        filteredIntents = activeIntents.filter(intent => 
          (intent.knowledge ?? []).some(k => k.knowledge.type === 'faq')
        )
      } else if (type === 'knowledge') {
        filteredIntents = activeIntents.filter(intent => 
          (intent.knowledge ?? []).some(k => k.knowledge.type !== 'faq')
        )
      } else if (type === 'tools') {
        filteredIntents = activeIntents.filter(intent => 
          (intent.tools ?? []).length > 0
        )
      }

      // Ambil contoh kalimat pertama dari setiap intent aktif (atau nama intent sebagai fallback)
      const examples = filteredIntents
        .map(intent => intent.examples[0] || intent.name)
        .filter(Boolean)

      // Sort alphabetically A-Z
      const sortedExamples = examples.sort((a, b) => a.localeCompare(b))

      return reply.send({
        success: true,
        data: sortedExamples
      })

    } catch (err: any) {
      throw err
    }
  }
}

export const intentController = new IntentController()
