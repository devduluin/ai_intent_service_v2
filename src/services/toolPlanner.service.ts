import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PlannerInput, PlannerOutput, Intent } from '../types'

class ToolPlannerService {

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const prompt = this.buildPrompt(input)
    console.log("[Planner] Prompt :", prompt)
    const start = Date.now()
    const raw = await openAiService.generateJson(prompt)
    const duration = Date.now() - start
    console.log(`[Planner] response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    try {
      return this.safeParse(raw)
    } catch (err) {
      console.warn("[Planner] Failed parsing JSON, fallback to chat")
      return { tools: [], knowledge: [], chat: true }
    }
  }

  // ===============================
  // BUILD PROMPT WITH DETAILED INFO
  // ===============================
  private buildPrompt(input: PlannerInput): string {
    
    // Build detailed tools info
    const toolsDetails = this.buildToolsDetails(input.candidates.toolsDetails || [])
    const knowledgeDetails = this.buildKnowledgeDetails(input.candidates.knowledgeDetails || [])
    
    return `
Kamu adalah AI PLANNER profesional.

Tugasmu:
Menentukan resource apa saja yang dibutuhkan untuk menjawab user.

Resource yang tersedia:
1. Tools → untuk aksi/data realtime
2. Knowledge → untuk informasi statis/kebijakan
3. Chat → untuk obrolan biasa


PENTING: MULTI-TOOLS
Jika user menanyakan BEBERAPA hal sekaligus
JANGAN hanya pilih 1 tools jika user meminta multiple hal!

DETAIL TOOLS YANG TERSEDIA :
${toolsDetails}


DETAIL KNOWLEDGE YANG TERSEDIA :
${knowledgeDetails}


PESAN USER :
"${input.userText}"

ATURAN PEMILIHAN :
1. Hanya boleh memilih tools dan knowledge dari daftar di atas
2. Jika tools/knowledge cukup untuk menjawab → chat = false
3. Jika bisa dijawab dengan kombinasi tools + knowledge → pilih SEMUA
4. Jika user menanyakan sesuatu di LUAR cakupan tools/knowledge → chat = true

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