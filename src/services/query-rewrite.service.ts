import { openAiService } from './openAi.service'
import { Agent } from '../types/agent.types'
import { config } from '../config'
import { formatDateHumanID } from '../utils/dateHumanID'
class QueryRewriteService {

  async rewriteWithMemory(
    agent: Agent,
    memoryContext: string,
    userMessage: string
  ): Promise<string> {

    // kalau message sudah panjang → skip rewrite
    if (userMessage.length > 15) return userMessage

    const today = formatDateHumanID();

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    const prompt = `
Kamu adalah AI yang mengubah pertanyaan lanjutan menjadi pertanyaan lengkap.

Context percakapan sebelumnya:
${memoryContext}

User message terbaru:
"${userMessage}"

Tugas:
Ubah menjadi pertanyaan lengkap yang berdiri sendiri.
Jika sudah jelas → kembalikan apa adanya.
Jawab hanya 1 kalimat hasil rewrite.

Referensi waktu sekarang:
Hari ini: ${today}
`

    try {
      const rewritten = await openAiService.chat(provider, llmModel, prompt)
      console.log('[QueryRewrite] rewritten:', rewritten.trim())
      return rewritten.trim()
    } catch (err) {
      console.error('[QueryRewrite] failed', err)
      return userMessage
    }
  }
}

export const queryRewriteService = new QueryRewriteService()