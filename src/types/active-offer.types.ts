import type { PlannerOutput } from './planner.types';

export type ActiveOfferType =
  | 'refine_param'
  | 'compare_period'
  | 'analyze_result'
  | 'export_result'
  | 'drilldown_tool'
  | 'rerun_memory_task'
  | 'show_capabilities';

export type ActiveOfferStatus =
  | 'active'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cleared';

export interface ActiveOffer {
  id: string;
  status: ActiveOfferStatus;
  type: ActiveOfferType;
  label: string;
  suggestedText?: string;
  reason: string;
  source: {
    resource: 'tool' | 'skill' | 'knowledge';
    key: string;
    planTaskId?: string;
  };
  target: {
    resource: 'tool' | 'skill';
    key: string;
    paramsPatch?: Record<string, unknown>;
    clearParams?: string[];
    inheritParams?: boolean;
    dependsOnLastResult?: boolean;
  };
  expectedAnswer: 'boolean' | 'select';
  confidence: number;
  safety: {
    requiresConfirmation: boolean;
    sideEffectLevel: 'none' | 'write' | 'external';
  };
  expiresAt: number;
  createdAt: number;
}

export interface OfferHistoryItem {
  id: string;
  type: ActiveOfferType;
  status: Exclude<ActiveOfferStatus, 'active'>;
  timestamp: number;
}

export interface AllowedOfferNaturalization {
  label: string;
  reason: string;
  suggestedText: string;
}

export interface OfferResolutionResult {
  isOfferResponse: boolean;
  accepted?: boolean;
  expired?: boolean;
  offer?: ActiveOffer;
  shouldExecute?: boolean;
  plan?: PlannerOutput;
  params?: Record<string, unknown>;
  message?: string;
}
