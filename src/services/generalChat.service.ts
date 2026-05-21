import { ollamaService, ChatMessage } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PipelineInput } from '../types'
import { Agent } from '../types/agent.types'
import { config } from '../config'
import { trimChatHistory } from '../utils/trim-chat'
// ============================================================
// TYPES
// ============================================================

interface KnowledgeContext {
  title?: string
  content: string
  type?: string
}

// ============================================================
// GENERAL CHAT SERVICE (RAG + HISTORY + MODEFILE SAFE)
// ============================================================

class GeneralChatService {

  async handle(
    input: PipelineInput,
    agent: Agent,
    context?: KnowledgeContext | KnowledgeContext[],
    numPredict: number = 256
  ): Promise<string> {

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'

    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    const temperature = agent.llmModel?.temperature || config.default?.temperature

    const systemPrompt = agent.systemPrompt || config.default?.systemPrompt

    try {
      const messages = this.buildMessages(input, systemPrompt)
      console.log('[GeneralChat] Messages:', messages)

      if (provider === 'qwen') {
        return await openAiService.chatMessage(messages, 
          llmModel,
          {
            temperature: temperature,
            num_predict: numPredict,
          }
        )
      } else {
        return await ollamaService.chatMessage(messages, 
          config.ollama.llmModel,
          {
            temperature: temperature,
            num_predict: numPredict,
          }
        )
      }

    } catch (err) {
      console.error('[GeneralChat] Error:', err)
      return "Maaf, saya sedang mengalami kendala teknis. Ada yang bisa saya bantu?"
    }
  }

  // =========================================================
  // 🔥 MESSAGE BUILDER (CORE)
  // =========================================================
  private buildMessages(
    input: PipelineInput,
    systemPrompt?: string
  ): ChatMessage[] {

    const messages: ChatMessage[] = []

    // 1 KNOWLEDGE RAG → SYSTEM (GROUND TRUTH)
    const knowledge = this.formatKnowledgeContext(systemPrompt)
    if (knowledge) {
      messages.push({
        role: 'system',
        content: knowledge,
      })
    }

    // 2 CHAT HISTORY (role asli)
    const trimmedHistory = trimChatHistory(input.chat_history, {
      maxMessages: 2,
      maxLength: 200
    })

    if (trimmedHistory?.length) {
      trimmedHistory.forEach((h: any) => {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content,
        })
      })
    }

    // 4️⃣ USER MESSAGE TERBARU
    messages.push({
      role: 'user',
      content: input.text,
    })

    return messages
  }


  // =========================================================
  // KNOWLEDGE CONTEXT → SYSTEM MESSAGE
  // =========================================================
  private formatKnowledgeContext(
    systemPrompt?: string
  ): string {

     if (systemPrompt) return systemPrompt;

    // const items = Array.isArray(context) ? context : [context]
    // if (!items.length) return ''

    return `
KAMU ADALAH CITRA, AI ASSISTANT DARI DULUIN BERBASIS KNOWLEDGE INTERNAL.

ATURAN PRIORITAS (WAJIB DIIKUTI):
1. Gunakan KNOWLEDGE INTERNAL sebagai sumber kebenaran utama.
2. Jika CHAT HISTORY bertentangan dengan KNOWLEDGE → ABAIKAN CHAT HISTORY.
3. Jika KNOWLEDGE tidak relevan → baru gunakan pengetahuan umum.
4. DILARANG menebak jika informasi tidak tersedia.
5. Jika informasi tidak ada → katakan tidak tahu.

**Tentang Duluin**
- Perusahaan teknologi di Bandung, Indonesia
- Produk: Workin (HRMS), Duluin Gajian (Payroll), Satu Creative
- Fokus pada solusi digital untuk bisnis UKM dan korporat

1 **Workin (HRMS)**
- Mengelola absensi & kehadiran online, manajemen cuti & izin, klaim reimbursement.
- Face recognition untuk offline mode.
- Checkpoint & persetujuan berlapis.
- Dokumen manajemen, shift & lembur.
- Tombol darurat tarik gaji harian.
- Atur shift & pengumuman mobile, berita internal.

`.trim()
  }
}

export const generalChatService = new GeneralChatService()