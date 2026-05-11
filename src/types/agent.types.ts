// types/agent.types.ts
export interface AgentResponse {
  id: string
  name: string
  slug: string
  description: string | null
  isActive: boolean
  metadata: Record<string, any> | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateAgentDTO {
  name: string
  slug: string
  description?: string | null
  isActive?: boolean
  metadata?: Record<string, any> | null
}

export interface UpdateAgentDTO {
  name?: string
  slug?: string
  description?: string | null
  isActive?: boolean
  metadata?: Record<string, any> | null
}

export interface AgentFilters {
  isActive?: boolean
  search?: string
  limit?: number
  offset?: number
}