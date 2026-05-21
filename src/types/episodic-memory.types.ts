import type { PlannerOutput } from './planner.types'

export type EpisodicMemory = {
  id: string
  user_id: string
  app_name: string
  level: "daily" | "weekly" | "monthly" | "yearly" | "story"
  intent: string        // ⭐ slot key
  summary: string
  toolsUsed?: PlannerOutput
  created_at: Date
}