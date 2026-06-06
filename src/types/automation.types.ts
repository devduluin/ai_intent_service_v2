import type { PlannerOutput } from './planner.types';

export type AutomationJobType =
  | 'reminder'
  | 'scheduled_workflow'
  | 'conditional_alert';

export type AutomationTriggerKind =
  | 'once'
  | 'recurring'
  | 'condition';

export type AutomationJobStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AutomationActionResource =
  | 'skill'
  | 'tool'
  | 'workflow';

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  runAt?: string;
  cron?: string;
  timezone?: string;
  sourceText?: string;
}

export interface AutomationCondition {
  kind?: 'threshold' | 'comparison';
  sourceText?: string;
  metric?: string;
  operator?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'change_percent' | 'increase_percent' | 'decrease_percent';
  value?: number | string;
  compareTo?: 'previous_run' | 'previous_day' | 'previous_week' | 'baseline';
}

export interface AutomationWorkflowRef {
  plan?: PlannerOutput;
  params?: Record<string, unknown>;
  sourceText: string;
  reusable: boolean;
  // ✅ ADDED: For "ini" reference resolution
  referencedTool?: string | null;
  referencedParams?: Record<string, unknown>;
  referencedAt?: number;
  referencedSourceText?: string;
  scheduleInstruction?: string;
}

export interface AutomationAction {
  resource: AutomationActionResource;
  key: string;
  params?: Record<string, unknown>;
}

export interface AutomationNotification {
  target?: string;
  channel?: 'chat' | 'email' | 'webhook';
  messageTemplate?: string;
  notifyOnlyOnCondition?: boolean;
}

export interface AutomationSafety {
  requiresConfirmation: boolean;
  sideEffectLevel: 'none' | 'write' | 'external';
}

export interface AutomationJobDraft {
  id?: string;
  userId?: string;
  appName?: string;
  agentId?: string | null;
  title: string;
  goal: string;
  type: AutomationJobType;
  trigger: AutomationTrigger;
  condition?: AutomationCondition;
  workflow: AutomationWorkflowRef;
  action: AutomationAction;
  notification?: AutomationNotification;
  status: AutomationJobStatus;
  safety: AutomationSafety;
  nextRunAt?: string | null;
}

export interface AutomationJob extends AutomationJobDraft {
  id: string;
  userId: string;
  appName: string;
  runCount: number;
  maxRuns?: number | null;
  lastRunAt?: Date | null;
  lastResult?: unknown;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationManagerResult {
  kind:
    | 'automation_job_draft'
    | 'automation_job_created'
    | 'automation_clarification_required'
    | 'automation_job_failed'
    | 'confirmation_required';
  job: AutomationJobDraft;
  missing?: string[];
  error?: string;
  confirmation?: {
    type: 'automation_job_create';
    editableFields: string[];
    expiresInMs: number;
    summary: Record<string, unknown>;
  };
  recommendation: {
    messageHints: string[];
    nextActions: string[];
  };
}

export interface AutomationSchedulerRunResult {
  checked: number;
  executed: number;
  skipped: number;
  failed: number;
  results: Array<{
    jobId: string;
    status: 'executed' | 'skipped' | 'failed';
    result?: unknown;
    error?: string;
  }>;
}

export interface AutomationConditionEvaluationResult {
  shouldRun: boolean;
  reason: string;
  observedValue?: unknown;
}
