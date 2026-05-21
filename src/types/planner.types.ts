// import type { PlannerOutput as LegacyPlannerOutput } from './index';

// NEW FORMAT: Task-based planning with dependencies
export type PlannerOutput = {
  mode: "single_step" | "multi_step"
  chat: boolean
  tasks: PlannerTask[]
  meta?: {
    repaired: boolean
    removedInvalidTasks: number
    removedDependencies: number
    deduplicatedTasks: number
  }
}

export type PlannerTask = {
  id: string
  resource: "tool" | "handler" | "knowledge"
  key: string
  depends_on: string[]
}