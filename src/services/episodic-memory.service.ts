import { openAiService } from './openAi.service'
import { PlannerOutput, ChatMessage } from '../types'
import { Agent } from '../types/agent.types'
import { config } from '../config'
import { trimChatHistory } from '../utils/trim-chat'

type EpisodicMemory = {
  id: string
  user_id: string
  app_name: string
  memory_key: string        // ⭐ slot key
  summary: string
  planSeen?: PlannerOutput
  created_at: Date
}

type MenuMemory = {
  user_id: string
  app_name: string
  menu: string[]
  created_at: Date
}

class EpisodicMemoryService {

  // replace with Redis later
  private storeDb: EpisodicMemory[] = []
  private lastMenuDb: MenuMemory[] = []

  private MAX_SLOTS_PER_USER = 1

  // ============================================================
  // 1️⃣ SAVE MENU (AI show numbered menu)
  // ============================================================
  saveMenu(userId: string, app: string, menu: string[]) {
    this.lastMenuDb = this.lastMenuDb.filter(
      m => !(m.user_id === userId && m.app_name === app)
    )

    this.lastMenuDb.push({
      user_id: userId,
      app_name: app,
      menu,
      created_at: new Date()
    })

    console.log('[Memory] Menu stored:', menu)
  }

  // ============================================================
  // 2️⃣ DETECT MENU SELECTION ("1" → rewrite intent)
  // ============================================================
  rewriteIfMenuSelection(userId: string, app: string, text: string): string {
    const clean = text.trim()

    if (!/^[1-9]$/.test(clean)) return text

    const lastMenu = this.lastMenuDb.find(
      m => m.user_id === userId && m.app_name === app
    )
    if (!lastMenu) return text

    const index = Number(clean) - 1
    const selected = lastMenu.menu[index]
    if (!selected) return text

    const rewritten = `Saya memilih menu: ${selected}`
    console.log('[Memory] Menu detected → rewrite:', rewritten)

    return rewritten
  }

  // ============================================================
  // 3️⃣ CLASSIFY MEMORY SLOT (SUPER IMPORTANT)
  // ============================================================
  private async classifyMemoryKey(
    provider: string,
    llmModel: string,
    summary: string,
    planSeen?: PlannerOutput
  ): Promise<string> {

    // ⭐ jika pakai tool → slot by tool
    if (planSeen?.tools?.length) {
      return `tool_${planSeen.tools.join('_')}`
    }

    // ⭐ jika pure chat → LLM classify topic
    const prompt = `
Klasifikasikan memory berikut ke kategori pendek snake_case.

Contoh kategori:
user_profile
weather_query
time_query
travel_interest
attendance_issue
general_chat

Memory:
"${summary}"

Jawab hanya nama kategori.
`

    try {
      const key = await openAiService.chat(provider, llmModel, prompt)
      return key.trim().toLowerCase().replace(/\s/g, '_')
    } catch {
      return 'general_chat'
    }
  }

  // ============================================================
  // 4️⃣ UPSERT MEMORY SLOT ⭐ CORE FEATURE ⭐
  // ============================================================
  private async upsertMemory(
    provider: string,
    llmModel: string,
    userId: string,
    app: string,
    summary: string,
    planSeen?: PlannerOutput
  ) {

    const memoryKey = await this.classifyMemoryKey(provider, llmModel, summary, planSeen)

    const existingIndex = this.storeDb.findIndex(m =>
      m.user_id === userId &&
      m.app_name === app &&
      m.memory_key === memoryKey
    )

    const memory: EpisodicMemory = {
      id: crypto.randomUUID(),
      user_id: userId,
      app_name: app,
      memory_key: memoryKey,
      summary,
      planSeen,
      created_at: new Date()
    }

    if (existingIndex >= 0) {
      this.storeDb[existingIndex] = memory
      console.log('[Memory] Updated slot:', memoryKey)
    } else {
      this.storeDb.push(memory)
      console.log('[Memory] Created slot:', memoryKey)
    }

    // ⭐ limit slot per user
    this.limitSlots(userId, app)
  }

  // ============================================================
  // 5️⃣ LIMIT SLOT PER USER
  // ============================================================
  private limitSlots(userId: string, app: string) {
    const userMemories = this.storeDb
      .filter(m => m.user_id === userId && m.app_name === app)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())

    if (userMemories.length <= this.MAX_SLOTS_PER_USER) return

    const toRemove = userMemories.slice(this.MAX_SLOTS_PER_USER)

    this.storeDb = this.storeDb.filter(
      m => !toRemove.includes(m)
    )

    console.log('[Memory] Old slots pruned:', toRemove.length)
  }

  // ============================================================
  // 6️⃣ SUMMARIZE CONVERSATION → STORE MEMORY
  // ============================================================
  async summarize(
    agent: Agent,
    userId: string,
    app: string,
    chatHistory: ChatMessage[],
    planSeen?: PlannerOutput
  ): Promise<string | null> {

    if (!chatHistory || chatHistory.length < 2) return null

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'
    
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    console.log('[Memory] Summarizing conversation...')
    const trimmedHistory = trimChatHistory(chatHistory, {
      maxMessages: 10,
      maxLength: 200
    })
    const conversationText = trimmedHistory
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')

    const prompt = `
ROLE: AI Memory.

Ringkas percakapan berikut menjadi 1 kalimat.
Fokus:
- tujuan user
- info penting user
- tool yang digunakan

Percakapan:
${conversationText}
`

    try {
      const summary = (await openAiService.chat(provider, llmModel, prompt)).trim()

      await this.upsertMemory(provider, llmModel,userId, app, summary, planSeen)

      return summary
    } catch (err) {
      console.error('[Memory] summarize failed', err)
      return null
    }
  }

  // ============================================================
  // 7️⃣ CONTEXT INJECTION (UNTUK RAG / PLANNER)
  // ============================================================
  async getRecentContext(
    userId: string,
    app: string,
    limit = 5
  ): Promise<string> {

    const memories = this.storeDb
      .filter(m => m.user_id === userId && m.app_name === app)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit)

    if (memories.length === 0) return ''

    const joined = memories
      .map(m => `• ${m.summary}`)
      .join('\n')

    console.log('[Memory] Injecting slots:', memories.length)

    return `
Context percakapan sebelumnya:
${joined}

Pesan saat ini:
`
  }

async getToolUsageHints(
  userId: string,
  app: string
): Promise<PlannerOutput> {

  const memories = this.storeDb
    .filter(m => m.user_id === userId && m.app_name === app)

  // default empty planner
  const merged: PlannerOutput = {
    handlers: [],
    tools: [],
    knowledge: [],
    chat: false
  }

  for (const memory of memories) {
    const plan = memory.planSeen
    if (!plan) continue

    if (plan.handlers?.length) {
      merged.handlers.push(...plan.handlers)
    }

    if (plan.tools?.length) {
      merged.tools.push(...plan.tools)
    }

    if (plan.knowledge?.length) {
      merged.knowledge.push(...plan.knowledge)
    }

    // kalau pernah chat → anggap pernah
    if (plan.chat === true) {
      merged.chat = true
    }
  }

  // remove duplicates
  merged.handlers = [...new Set(merged.handlers)]
  merged.tools = [...new Set(merged.tools)]
  merged.knowledge = [...new Set(merged.knowledge)]

  return merged
}

  // ============================================================
  // OPTIONAL
  // ============================================================
  async clearUserMemory(userId: string, app: string) {
    this.storeDb = this.storeDb.filter(
      m => !(m.user_id === userId && m.app_name === app)
    )
  }

  debugDump() {
    return this.storeDb
  }
}

export const episodicMemoryService = new EpisodicMemoryService()