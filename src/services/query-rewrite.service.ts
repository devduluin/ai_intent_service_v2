import { openAiService } from './openAi.service'
import { Agent } from '../types/agent.types'
import { PipelineInput } from '../types'
import { config } from '../config'
import { formatDateHumanID } from '../utils/dateHumanID'
import { trimChatHistory } from '../utils/trim-chat';

class QueryRewriteService {

  async rewriteWithMemory(
    agent: Agent,
    memoryContext: string | null,
    input: PipelineInput
  ): Promise<string> {

    // kalau message sudah panjang → skip rewrite
    if (input.text.length > 20) return input.text

    const trimmedHistory = trimChatHistory(input.chat_history, {
        maxMessages: 2,
        maxLength: 200,
    });

    const today = formatDateHumanID();

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    const prompt = `
Role: Query Rewrite.

Riwayat Context:
${trimmedHistory?.map(h => `${h.role}: ${h.content}`).join('\n')}

Summary Context:
${memoryContext} 

User message terbaru:
"${input.text}"

Tugas:
Jika perecakapan masih relevan → Sesuaikan message menjadi pertanyaan yang berdiri sendiri.
Jika Tidak relevan → kembalikan message asli.
Maksimal 1 kalimat hasil rewrite.

Referensi waktu sekarang:
Hari ini: ${today}
`

    try {
      console.log('[QueryRewrite] prompt:', prompt)
      const rewritten = await openAiService.chat(provider, llmModel, prompt)
      console.log('[QueryRewrite] rewritten:', rewritten.trim())
      // let enrichedUserQuery = (memoryContext || '') + " Pesan terbaru: "+ rewritten.trim();
      let enrichedUserQuery = " Pengguna Bertanya: "+ rewritten.trim();

      return enrichedUserQuery
    } catch (err) {
      console.error('[QueryRewrite] failed', err)
      return input.text
    }
  }
}

export const queryRewriteService = new QueryRewriteService()