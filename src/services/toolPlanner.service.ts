// import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PlannerInput, PlannerOutput, Intent } from '../types'
import { estimateTokens, TokenEstimator } from '../utils/token-estimator.utils'

class ToolPlannerService {

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const prompt = this.buildPrompt(input)
    // console.log("[Planner] Prompt :", prompt)
   
    const raw = await openAiService.generateJson(prompt) 

    try {
      return this.safeParse(raw)
    } catch (err) {
      console.warn("[Planner] Failed parsing JSON, fallback to chat")
      return { handlers: [], tools: [], knowledge: [], chat: true }
    }
  }

  // ===============================
  // BUILD PROMPT WITH DETAILED INFO
  // ===============================
  private buildPrompt(input: PlannerInput): string {
    
    // Build detailed tools info
    const toolsDetails = this.buildToolsDetails(input.candidates.toolsDetails || [])
    const knowledgeDetails = this.buildKnowledgeDetails(input.candidates.knowledgeDetails || [])
    const recentUsage = this.buildRecentUsageHints(input.recentUsage)

    return `
ROLE: AI Planner.

Tujuan:
Tentukan resource untuk menjawab user.

Resource yang tersedia:
1. Tools → aksi/data realtime
2. Knowledge → informasi statis/informasi
3. Chat → obrolan biasa


MULTI-QUESTION:
Jika user menanyakan beberapa hal → pilih SEMUA tools relevan.

TOOLS :
${toolsDetails}

KNOWLEDGES :
${knowledgeDetails}

HINT RIWAYAT:
${recentUsage}

Gunakan riwayat ini sebagai PREFERENSI tetap pilih resource yang PALING RELEVAN dengan pesan user., 

PESAN USER :
"${input.userText}"

ATURAN PEMILIHAN :
1. Hanya boleh pilih dari daftar tools/knowledge.
2. Jika tools/knowledge cukup untuk menjawab → chat = false
3. Jika bisa dijawab dengan kombinasi tools + knowledge
4. Jika diluar cakupan tools/knowledge → chat = true

CONTOH OUTPUT :
Output: {"tools": ["tool_1", "tool_2"], "knowledge": ["knowledege_1", "knowledge_2"], "chat": false}
`
  }

  private buildToolsDetails(tools: any[]): string {
    if (!tools.length) return "Tidak ada tools tersedia."
    
    return tools.map(tool => {
      return `
   Tool: ${tool.slug}
   Deskripsi: ${tool.description || 'Tidak ada deskripsi'}
      `.trim()
    }).join('\n\n')
  }

  private buildKnowledgeDetails(knowledge: any[]): string {
    if (!knowledge.length) return "Tidak ada knowledge tersedia."
    
    return knowledge.map(k => {
      return `
   Knowledge: ${k.slug}
   Deskripsi: ${k.description || 'Tidak ada deskripsi'}
      `.trim()
    }).join('\n\n')
  }

  private buildRecentUsageHints(recent?: PlannerOutput): string {
    if (!recent) return "Belum ada riwayat penggunaan tools."

    const parts: string[] = []

    if (recent.tools?.length)
      parts.push(`User SERING memakai tools: ${recent.tools.join(', ')}`)

    if (recent.knowledge?.length)
      parts.push(`User SERING mengakses knowledge: ${recent.knowledge.join(', ')}`)

    if (recent.chat)
      parts.push(`User SERING melakukan percakapan umum (chat)`)

    if (parts.length === 0)
      return "Belum ada riwayat penggunaan tools."

    return parts.join('\n')
  }

  // ===============================
  // SAFE JSON PARSING
  // ===============================
  private safeParse(raw: string): PlannerOutput {
    // Remove markdown if present
    let clean = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    
    // Extract JSON object
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error('No JSON object found')
    }
    
    const parsed = JSON.parse(match[0])
    
    // Validate structure
    if (!Array.isArray(parsed.tools)) parsed.tools = []
    if (!Array.isArray(parsed.knowledge)) parsed.knowledge = []
    if (typeof parsed.chat !== 'boolean') parsed.chat = false
    
    return parsed as PlannerOutput
  }
}

export const toolPlannerService = new ToolPlannerService()