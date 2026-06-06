import type { PlannerOutput } from './planner.types';

export interface ClarificationState {
  userId: string;
  appName: string;
  version: number;
  originalText: string;
  clarificationQuestion: string;
  originalPlan?: PlannerOutput | null;
  retryCount: number;
  maxRetry: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
