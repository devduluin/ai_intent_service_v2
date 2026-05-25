import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PlannerInput,  Intent } from '../types'
import type { PlannerOutput } from '../types/planner.types'

class ToolPlannerService {

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const prompt = this.buildPrompt(input)
    console.log("[Planner] Prompt :", prompt)
   
    const raw = await openAiService.generateJson(prompt) 

    console.log("[Planner] Raw output:", raw)

    try {
      return this.safeParse(raw, input)
    } catch (err) {
      console.warn("[Planner] Failed parsing JSON, fallback to chat")
      return {
        "mode": "single_step",
        "chat": true,
        "tasks": []
      }
    }
  }

  // ===============================
  // BUILD PROMPT WITH DETAILED INFO
  // ===============================
  private buildPrompt(input: PlannerInput): string {

    // Build detailed tools info
    const handlersDetails = this.buildHandlersDetails(input.candidates.handlerDetails || [])
    const toolsDetails = this.buildToolsDetails(input.candidates.toolsDetails || [])
    const knowledgeDetails = this.buildKnowledgeDetails(input.candidates.knowledgeDetails || [])
    const recentUsage = this.buildRecentUsageHints(input.recentUsage as PlannerOutput | undefined)

    // C-009 FIX: Add resource recommendation hint if available
    const resourceRecommendation = input.recommendedResource
      ? `

REKOMENDASI RESOURCE TYPE (dari confidence analysis):
- Resource yang direkomendasikan: ${input.recommendedResource.toUpperCase()}
- Gunakan ini sebagai REFERENSI untuk meningkatkan confidence pemilihan resource.
- Jika tidak relevan dengan user query, abaikan dan pilih resource yang paling tepat.`
      : ''

    return `
You are an AI Task Planner.

Goal:
Membuat TASK GRAPH untuk menjawab pertanyaan dengan available resources.

MODE:
single_step → cukup 1 resource (handler/tool/knowledge) untuk menjawab
multi_step → butuh kombinasi resource untuk menjawab

RESOURCE TYPE PRIORITY (WAJIB):
1. Tools → ambil data realtime / aksi sistem
2. Handlers → greeting, skill, generate file (jika diminta buat output berupa file)
3. Knowledge → informasi statis
4. Chat → fallback terakhir jika semua tidak cukup
${resourceRecommendation}

MULTI TASK DETECTION:
Jika user menanyakan beberapa hal → pilih SEMUA Resource yang relevan.
Setiap pertanyaan boleh memiliki Kombinasi Tool, Handler, Knowledge jika relevan.

DEPENDENCY RULE:
Jika sebuah handler membutuhkan data dari tool,
maka handler HARUS depends_on tool tersebut.

Jika beberapa handler membutuhkan data yang sama,
gunakan tool SATU KALI lalu jadikan dependency bersama.

Output harus berupa TASK GRAPH.

TASK ID RULE:
Gunakan id integer sesuai urutan eksekusi.

AVAILABLE RESOURCES:
Handlers :
${handlersDetails}

Tools :
${toolsDetails}

Knowledges :
${knowledgeDetails}

HINT RIWAYAT:
${recentUsage}

Gunakan riwayat sebagai PREFERENSI jika yakin RELEVAN dengan pesan user.,

PESAN USER :
"${input.userText}"

ATURAN PEMILIHAN :
1. Hanya boleh pilih dari daftar key resources.
2. Jika diluar cakupan resources → chat = true
3. Chat tidak boleh masuk dalam tasks, tapi set chat = true

CONTOH (single_step) :
Output: {
  "mode": "single_step",
  "chat": false,
  "tasks": [
    { "id": "1", "resource": "tool/handler/knowledge", "key": "key_1", "depends_on": [] }
  ]
}

CONTOH (multi_step) :
Output: {
  "mode": "multi_step",
  "chat": true | false,
  "tasks": [
    { "id": "1", "resource": "tool", "key": "key_1", "depends_on": [] },
    { "id": "2", "resource": "tool", "key": "key_2", "depends_on": ["1"] },
    { "id": "3", "resource": "handler", "key": "key_3", "depends_on": ["1"] },
    { "id": "4", "resource": "knowledge", "key": "key_4", "depends_on": [] },
  ]
}

jika tidak yakin dengan resource yang dipilih → chat = true
`
  }

  private buildHandlersDetails(handlers: Intent[]): string {
    if (!handlers.length) return "Tidak ada handlers tersedia."
    
    return handlers.map(handler => {
      return `
    key: ${handler.slug}
    deskripsi: ${handler.description || 'Tidak ada deskripsi'}
      `.trim()
    }).join('\n\n')
  }

  private buildToolsDetails(tools: any[]): string {
    if (!tools.length) return "Tidak ada tools tersedia."
    
    return tools.map(tool => {
      return `
   key: ${tool.slug}
   deskripsi: ${tool.description || 'Tidak ada deskripsi'}
      `.trim()
    }).join('\n\n')
  }

  private buildKnowledgeDetails(knowledge: any[]): string {
    if (!knowledge.length) return "Tidak ada knowledge tersedia."
    
    return knowledge.map(k => {
      return `
   key: ${k.slug}
   deskripsi: ${k.description || 'Tidak ada deskripsi'}
      `.trim()
    }).join('\n\n')
  }

  private buildRecentUsageHints(recent?: PlannerOutput): string {
    if (!recent) return "Belum ada riwayat penggunaan tools."

    const parts: string[] = []

    // NEW FORMAT: Extract from tasks array
    if (recent.tasks && recent.tasks.length > 0) {
      const handlers = recent.tasks
        .filter(t => t.resource === 'handler')
        .map(t => t.key)

      const tools = recent.tasks
        .filter(t => t.resource === 'tool')
        .map(t => t.key)

      const knowledge = recent.tasks
        .filter(t => t.resource === 'knowledge')
        .map(t => t.key)

      if (handlers.length)
        parts.push(`Handler keys: ${handlers.join(', ')}`)

      if (tools.length)
        parts.push(`Tool keys: ${tools.join(', ')}`)

      if (knowledge.length)
        parts.push(`Knowledge keys: ${knowledge.join(', ')}`)

      // Check for dependencies between tasks
      const hasDependencies = recent.tasks.some(t => t.depends_on.length > 0)
      if (hasDependencies) {
        parts.push(`User PERNAH menjalankan multi-step workflow dengan dependencies`)
      }
    } 
    // LEGACY FORMAT: Direct arrays (backward compatibility)
    else {
      const legacyRecent = recent as any
      
      if (legacyRecent.handlers && legacyRecent.handlers.length)
        parts.push(`Handler keys: ${legacyRecent.handlers.join(', ')}`)

      if (legacyRecent.tools && legacyRecent.tools.length)
        parts.push(`Tool keys: ${legacyRecent.tools.join(', ')}`)

      if (legacyRecent.knowledge && legacyRecent.knowledge.length)
        parts.push(`Knowledge keys: ${legacyRecent.knowledge.join(', ')}`)
    }

    if (recent.chat)
      parts.push(`User SERING melakukan percakapan umum (chat)`)

    if (parts.length === 0)
      return "Belum ada riwayat penggunaan tools."

    return parts.join('\n')
  }

  // ===============================
  // SAFE JSON PARSING
  // ===============================
  private safeParse(raw: string, input?: PlannerInput): PlannerOutput {

    const debugMeta = {
      repaired: false,
      removedInvalidTasks: 0,
      removedDependencies: 0,
      deduplicatedTasks: 0
    }

    // =============================
    // 1. STRIP MARKDOWN
    // =============================
    const clean = raw.replace(/```json|```/g, '').trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("Planner JSON not found")

    let parsed: any
    try {
      parsed = JSON.parse(match[0])
    } catch {
      throw new Error("Planner invalid JSON")
    }

    // =============================
    // 2. VALID RESOURCE KEYS (CRITICAL)
    // =============================
    const validHandlerKeys = new Set(input?.candidates.handlerDetails?.map(h => h.slug))
    const validToolKeys = new Set(input?.candidates.toolsDetails?.map(t => t.slug))
    const validKnowledgeKeys = new Set(input?.candidates.knowledgeDetails?.map(k => k.slug))

    const isValidKey = (resource: string, key: string) => {
      if (!key) return false
      if (resource === "tool") return true
      if (resource === "handler") return validHandlerKeys.has(key)
      if (resource === "knowledge") return true

      return false
    }

    // =============================
    // 3. VALIDATE TASK STRUCTURE
    // =============================
    if (!Array.isArray(parsed.tasks)) parsed.tasks = []

    let tasks = parsed.tasks
      .filter((t: any) => t && typeof t === "object")
      .map((t: any, i: number) => ({
        id: String(t.id ?? i + 1),
        resource: ["tool","handler","knowledge"].includes(t.resource)
          ? t.resource
          : "tool",
        key: String(t.key ?? "").trim(),
        depends_on: Array.isArray(t.depends_on)
          ? t.depends_on.map((d: any) => String(d))
          : []
      }))

    // =============================
    // 4. REMOVE UNKNOWN RESOURCE KEYS
    // =============================
    const beforeFilter = tasks.length
    tasks = tasks.filter((t: any) => isValidKey(t.resource, t.key))
    debugMeta.removedInvalidTasks += beforeFilter - tasks.length

    // =============================
    // 5. DEDUPLICATE TASKS (BY KEY)
    // =============================
    const seen = new Set<string>()
    tasks = tasks.filter((t: any) => {
      const hash = `${t.resource}:${t.key}`
      if (seen.has(hash)) {
        debugMeta.deduplicatedTasks++
        return false
      }
      seen.add(hash)
      return true
    })

    // =============================
    // 6. GLOBAL BUSINESS RULES
    // handler xls_generator wajib ada minimal 1 tool
    // =============================

    const hasTool = tasks.some((t: any) => t.resource === "tool")

    const hasXlsGenerator = tasks.some(
      (t: any) => t.resource === "handler" && t.key === "xls_generator"
    )

    if (hasXlsGenerator && !hasTool) {
      const before = tasks.length
      tasks = tasks.filter(
        (t: any) => !(t.resource === "handler" && t.key === "xls_generator")
      )
      debugMeta.removedInvalidTasks += before - tasks.length
    }

    // =============================
    // 9. IF EMPTY → CHAT MODE
    // =============================
    if (tasks.length === 0) {
      return {
        mode: "single_step",
        chat: true,
        tasks: [],
        meta: debugMeta
      }
    }

    // =============================
    // 8. VALIDATE DEPENDENCIES
    // =============================
    const ids = new Set(tasks.map((t: any) => t.id))

    tasks.forEach((task: any) => {
      const before = task.depends_on.length
      task.depends_on = task.depends_on.filter((dep: string) => ids.has(dep))
      debugMeta.removedDependencies += before - task.depends_on.length
    })

    // =============================
    // 9. CYCLE DETECTION (DFS)
    // =============================
    const graph = new Map<string, string[]>()
    tasks.forEach((t: any) => graph.set(t.id, t.depends_on))

    const visited = new Set<string>()
    const stack = new Set<string>()

    const hasCycle = (node: string): boolean => {
      if (stack.has(node)) return true
      if (visited.has(node)) return false

      visited.add(node)
      stack.add(node)

      for (const dep of graph.get(node) || []) {
        if (hasCycle(dep)) return true
      }

      stack.delete(node)
      return false
    }

    const cycleDetected = tasks.some((t: any) => hasCycle(t.id))
    if (cycleDetected) {
      debugMeta.repaired = true
      // fallback: remove all dependencies
      tasks.forEach((t: any) => t.depends_on = [])
    }

    // =============================
    // 10. DETERMINE MODE PROPERLY
    // =============================
    const isMultiStep = tasks.length > 1 || tasks.some((t: any) => t.depends_on.length > 0)

    return {
      mode: isMultiStep ? "multi_step" : "single_step",
      chat: false,
      tasks,
      meta: debugMeta
    }
  }
}

export const toolPlannerService = new ToolPlannerService()