// strategies/knowledge-execution.strategy.ts
import { PipelineInput, Knowledge } from '../../types'
import { ExecutionStrategy } from '../../types/execution.types'
import { ollamaService } from '../../services/ollama.service'
import { knowledgeVectorService } from '../../services/knowledgeVector.service'

// import { generalChatService } from '../../services/generalChat.service'
// interface KnowledgeContext {
//   title?: string
//   content: string
//   type?: string
// }

export class KnowledgeExecutionStrategy implements ExecutionStrategy {
  // async execute(knowledge: any, params: Record<string, any>, context: PipelineInput) {

  //   // =========================================================
  //   // FIX: support BOTH single object & array
  //   // =========================================================
  //   const knowledgeList = Array.isArray(knowledge)
  //     ? knowledge
  //     : [knowledge]

  //   if (knowledgeList.length === 0) {
  //     throw new Error('No knowledge mapping found')
  //   }

  //   // =========================================================
  //   // FIX: correct mapping
  //   // =========================================================
  //   const formatted = knowledgeList.map((k: KnowledgeContext) => ({
  //     title: k.title,
  //     content: k.content,
  //     type: k.type
  //   }))

  //   return await generalChatService.handle(
  //     context,
  //     formatted,
  //     0.4,
  //     256
  //   )
  // }

  async execute(
    knowledges: Knowledge[],
    params: Record<string, any>,
    context: PipelineInput
  ): Promise<Record<string, unknown>> {

    console.log(
      `[ExecuteKnowledgesWithContext] Executing ${knowledges.length} knowledge(s)`
    )

    if (!knowledges.length) return {}

    // 1️⃣ Embed user query once
    const queryEmbedding = await ollamaService.embed(context.text)

    const knowledgePromises = knowledges.map(async (knowledge) => {
      console.log(
        `[ExecuteKnowledgesWithContext] Vector search for: ${knowledge.slug}`
      )

      try {
        // 2️⃣ Scoped vector search (planner-approved)
        const searchResult =
          await knowledgeVectorService.searchKnowledgeChunks({
            embedding: queryEmbedding,
            knowledgeIds: [knowledge.id],
            topK: 5,
          })

        // 3️⃣ fallback if not ingested yet
        if (!searchResult.length) {
          console.warn(
            `[ExecuteKnowledgesWithContext] No chunks → fallback raw: ${knowledge.slug}`
          )

          return {
            slug: knowledge.slug,
            status: 'fulfilled' as const,
            value: {
              type: 'knowledge',
              source: knowledge.slug,
              context: knowledge.content,
              chunksFound: 0,
            },
          }
        }

        // 4️⃣ Build RAG context
        const ragContext = searchResult
          .map(chunk => {
            const score = chunk.score.toFixed(3)
            return `[score:${score}] ${chunk.content}`
          })
          .join('\n\n---\n\n')

        return {
          slug: knowledge.slug,
          status: 'fulfilled' as const,
          value: {
            type: 'knowledge',
            source: knowledge.slug,
            context: ragContext,
            chunksFound: searchResult.length,
          },
        }

      } catch (error) {
        console.error(
          `[ExecuteKnowledgesWithContext] Failed knowledge ${knowledge.slug}:`,
          error
        )

        return {
          slug: knowledge.slug,
          status: 'rejected' as const,
          reason: error,
        }
      }
    })

    const settled = await Promise.all(knowledgePromises)

    const results: Record<string, unknown> = {}

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        results[res.slug] = res.value
      } else {
        results[res.slug] = { error: String(res.reason) }
      }
    }

    return results
  }
}