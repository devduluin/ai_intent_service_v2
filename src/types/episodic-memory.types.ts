import type { PlannerOutput } from './planner.types'
import type { EpisodicFlowTraceItem } from './episodic-memory-write.types'

export type EpisodicMemory = {
  id: string
  user_id: string
  app_name: string
  level: "daily" | "weekly" | "monthly" | "yearly" | "story"
  intent: string
  summary: string
  toolsUsed?: PlannerOutput
  topicKey?: string | null
  topicLabel?: string | null
  flowStage?: string | null
  taskPlan?: PlannerOutput | null
  flowTrace?: EpisodicFlowTraceItem[] | null
  rerunnable?: boolean
  memoryMeta?: Record<string, unknown> | null
  created_at: Date
}
