import { openAiService } from './openAi.service'

class QueryRewriteService {

  async rewriteWithMemory(
    memoryContext: string,
    userMessage: string
  ): Promise<string> {

    // kalau message sudah panjang → skip rewrite
    if (userMessage.length > 25) return userMessage

    const prompt = `
Kamu adalah AI yang mengubah pertanyaan lanjutan menjadi pertanyaan lengkap.

Context percakapan sebelumnya:
${memoryContext}

User message terbaru:
"${userMessage}"

Tugas:
Ubah menjadi pertanyaan lengkap yang berdiri sendiri.
Jika sudah jelas → kembalikan apa adanya.
Jawab hanya kalimat hasil rewrite.
`

    try {
      const rewritten = await openAiService.chat(prompt)
      console.log('[QueryRewrite] rewritten:', rewritten.trim())
      return rewritten.trim()
    } catch (err) {
      console.error('[QueryRewrite] failed', err)
      return userMessage
    }
  }
}

export const queryRewriteService = new QueryRewriteService()