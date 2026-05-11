// services/task.types.ts

export type TaskStatus =
  | 'waiting_input'
  | 'ready_to_execute'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TaskPlan {
  tools: string[]
  knowledge: string[]
  chat: boolean
}

export interface TaskIntent {
  slug: string
  name: string
  executionType: string
}

export interface MissingParamsEntry {
  intentSlug: string
  missing: string[]
}

export interface TaskState {
  taskId: string
  userId: string
  agentSlug: string

  status: TaskStatus
  createdAt: number
  updatedAt: number

  // planner result
  plan: TaskPlan
  intents: TaskIntent[]

  // slot filling
  params: Record<string, any>
  missingParamsMap: MissingParamsEntry[]

  retryCount: number
  maxRetry: number

  results?: any
  lastUserMessage?: string
}