import { ollamaService, ChatMessage } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PipelineInput } from '../types'
import { config } from '../config'

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
    context?: KnowledgeContext | KnowledgeContext[],
    temperature: number = 0.6,
    numPredict: number = 512
  ): Promise<string> {

    try {
      const messages = this.buildMessages(input, context, input.app_name)
      console.log('[GeneralChat] Messages:', messages)
      // Pilih service berdasarkan config.default.provider
      const provider = config.default?.provider || 'ollama'

      let response: string
      if (provider === 'openai') {
        response = await openAiService.chatMessage(messages, 
          config.alibaba?.naturalModel || config.alibaba?.llmModel,
          {
            temperature: temperature,
            num_predict: numPredict,
          }
        )
      } else {
        response = await ollamaService.chatMessage(messages, 
          config.ollama.naturalModel,
          {
            temperature: temperature,
            num_predict: numPredict,
          }
        )
      }

      return this.postProcessResponse(response, input)

    } catch (err) {
      console.error('[GeneralChat] Error:', err)
      return "Maaf, saya sedang mengalami kendala teknis. Ada yang bisa saya bantu?"
    }
  }

  private postProcessResponse(text: string, input: PipelineInput): string {
    if (input.app_name !== 'hris_company') return text
    const dashboardUrl = input.attributes?.company_dashboard_base_url as string
      || process.env.COMPANY_DASHBOARD_URL
      || ''
    if (!dashboardUrl) return text
    let result = text
    // Handle LLM yang prepend protocol: https://{{base_url}}/...
    result = result.replace(/https?:\/\/\{\{base_url\}\}/gi, dashboardUrl)
    // Handle standalone placeholder: {{base_url}}/...
    result = result.replace(/\{\{base_url\}\}/gi, dashboardUrl)
    result = result.replace(/\{\{BASE_URL\}\}/g, dashboardUrl)
    return result
  }

  // =========================================================
  // 🔥 MESSAGE BUILDER (CORE)
  // =========================================================
  private buildMessages(
    input: PipelineInput,
    context?: KnowledgeContext | KnowledgeContext[],
    agentSlug?: string
  ): ChatMessage[] {

    const messages: ChatMessage[] = []

    // 1 KNOWLEDGE RAG → SYSTEM (GROUND TRUTH)
    const knowledge = this.formatKnowledgeContext(context, agentSlug)
    if (knowledge) {
      messages.push({
        role: 'system',
        content: knowledge,
      })
    }

    // 2 ASSISTANT ANCHOR (VERY IMPORTANT)
    messages.push({
      role: 'assistant',
      content: 'Baik, saya siap membantu.',
    })

    // 3 CHAT HISTORY (role asli)
    if (input.chat_history?.length) {
      input.chat_history.forEach((h: any) => {
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
    context?: KnowledgeContext | KnowledgeContext[],
    agentSlug?: string
  ): string {

    // Jika agent adalah hris_company → strict hanya dari knowledge
    if (agentSlug === 'hris_company') {
      return `
KAMU ADALAH ASISTEN DASHBOARD ADMIN WORKIN.

ATURAN WAJIB:
1. HANYA gunakan KNOWLEDGE INTERNAL yang diberikan di bawah ini sebagai sumber jawaban.
2. JANGAN gunakan pengetahuan umum tentang Duluin, Workin, atau produk lainnya.
3. Jika KNOWLEDGE tidak berisi jawaban → katakan "Maaf, saya tidak memiliki informasi tentang itu."
4. DILARANG menebak atau menambahkan informasi di luar KNOWLEDGE.
5. Jawab dengan bahasa yang jelas, singkat, dan langsung pada poinnya.
6. Jika KNOWLEDGE mengandung LINK/URL → WAJIB sertakan URL tersebut PERSIS seperti di data (jangan diubah, dipotong, atau ditambahi).
`.trim()
    }

    return `
KAMU ADALAH CITRA, AI ASSISTANT DARI DULUIN BERBASIS KNOWLEDGE INTERNAL.

ATURAN PRIORITAS (WAJIB DIIKUTI):
1. Gunakan KNOWLEDGE INTERNAL sebagai sumber kebenaran utama.
2. Jika KNOWLEDGE tersedia → WAJIB digunakan dalam jawaban.
3. Jika CHAT HISTORY bertentangan dengan KNOWLEDGE → ABAIKAN CHAT HISTORY.
4. Jika KNOWLEDGE tidak relevan → baru gunakan pengetahuan umum.
5. DILARANG menebak jika informasi tidak tersedia.
6. Jika informasi tidak ada → katakan tidak tahu.

**Tentang Duluin**
- Perusahaan teknologi di Bandung, Indonesia
- Produk: Workin (HRMS), Duluin Gajian (Payroll), Satu Creative
- Fokus pada solusi digital untuk bisnis UKM dan korporat

1 **Workin (HRMS)**
- Mengelola absensi & kehadiran online, manajemen cuti & izin.
- Face recognition untuk offline mode.
- Checkpoint & persetujuan berlapis.
- Dokumen manajemen, shift & lembur.
- Tombol darurat tarik gaji harian.
- Atur shift & pengumuman mobile, berita internal.
- Dashboard HR user-friendly, bisa dikustomisasi sesuai kebutuhan usaha.
- Payroll terintegrasi dengan **Duluin Gajian**.

2 **Duluin Gajian (EWA / Payroll)**
- Layanan gaji harian fleksibel, tarik saldo kapan saja.
- Proses pembayaran aman & cepat.
- Integrasi penuh dengan Workin.
- Memberikan info gaji, slip, dan tunjangan dengan nada profesional.
- Tidak memberikan saran hukum atau medis.

3 **Satu Creative**
- Divisi creative & branding: desain grafis, konten digital, copywriting, branding, strategi kreatif.
- Juga menyediakan pengembangan aplikasi: mobile apps, website company profile, landing page, dan sistem digital lainnya.
`.trim()
  }
}

export const generalChatService = new GeneralChatService()