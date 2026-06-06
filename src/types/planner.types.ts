// import type { PlannerOutput as LegacyPlannerOutput } from './index';

// ============================================================
// Recent Usage Hints Type (for historical usage patterns)
// ============================================================
export interface RecentUsageHints {
  tasks: Array<{
    resource: 'tool' | 'skill' | 'knowledge';
    key: string;
  }>;
  chat?: boolean;
  hasDependencies?: boolean;
}

// ============================================================
// PlannerOutput Type (for execution plans)
// ============================================================

// NEW FORMAT: Task-based planning with dependencies
export type PlannerOutput = {
  mode: "single_step" | "multi_step";
  chat: boolean;
  tasks: PlannerTask[];
  reasoning?: string;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  strategy?: 'execute' | 'clarify' | 'partial';
  meta?: {
    repaired?: boolean;
    removedInvalidTasks?: number;
    removedDependencies?: number;
    deduplicatedTasks?: number;
    preFilterConfidence?: number;   // ✅ NEW: Original LLM quality
    postFilterConfidence?: number;  // ✅ NEW: After validation/propagation
    ambiguityScore?: number;        // ✅ NEW: Ambiguity level (0-1)
    ambiguityReasons?: string[];    // ✅ NEW: Why ambiguous
    workflowConfidence?: number;    // ✅ NEW: Overall workflow quality
  };
};

export type PlannerTask = {
  id: string;
  resource: "tool" | "skill" | "knowledge";
  key: string;
  confidence?: number;
  originalConfidence?: number;  // ✅ NEW: Before dependency propagation
  depends_on: string[];
};
