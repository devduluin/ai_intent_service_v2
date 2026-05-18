// types/agent.types.ts
import { ILlmModel } from './model.type'

export interface Agent {
  id: string

  name: string
  slug: string
  description: string | null

  isActive: boolean

  // 🧠 PROMPT SYSTEM
  systemPrompt: string | null
  customPrompt: string | null

  // ⚙️ LLM CONFIG
  modelId: string | null
  llmModel?: ILlmModel | null

  temperature: number
  maxTokens: number | null
  memoryEnabled: boolean

  // 🧠 ADVANCED CONTEXT
  metadata: Record<string, any> | null

  createdAt: Date
  updatedAt: Date
}

export interface AgentCreateInput {
  name: string
  slug: string
  description?: string | null

  isActive?: boolean

  // 🧠 PROMPT
  systemPrompt?: string | null
  customPrompt?: string | null

  // ⚙️ LLM
  modelId?: string | null
  temperature?: number
  maxTokens?: number | null
  memoryEnabled?: boolean

  metadata?: Record<string, any> | null
}

export interface AgentUpdateInput {
  name?: string
  slug?: string
  description?: string | null

  isActive?: boolean

  systemPrompt?: string | null
  customPrompt?: string | null

  llmModelId?: string | null
  temperature?: number
  maxTokens?: number | null
  memoryEnabled?: boolean

  metadata?: Record<string, any> | null
}

export interface AgentFilters {
  isActive?: boolean
  search?: string
  limit?: number
  offset?: number
}