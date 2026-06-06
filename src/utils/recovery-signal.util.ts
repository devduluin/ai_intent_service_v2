import type { PlannerOutput } from '../types/planner.types';
import type { ExecutionResult } from '../services/cores/stages/execution.stage';

const WRITE_SUCCESS_WORDS = [
  'berhasil dibuat',
  'sudah dibuat',
  'berhasil dihapus',
  'sudah dihapus',
  'berhasil dikirim',
  'sudah dikirim',
  'successfully created',
  'successfully deleted',
  'successfully sent'
];

export function hasTask(plan: PlannerOutput | null | undefined, resource: 'tool' | 'skill' | 'knowledge', key?: string): boolean {
  return !!plan?.tasks?.some(task => task.resource === resource && (!key || task.key === key));
}

export function hasOnlyResource(plan: PlannerOutput | null | undefined, resource: 'tool' | 'skill' | 'knowledge'): boolean {
  const tasks = plan?.tasks || [];
  return tasks.length > 0 && tasks.every(task => task.resource === resource);
}

export function countToolResults(executionResult: ExecutionResult | null | undefined): number {
  if (!executionResult?.results) return 0;
  return Object.keys(executionResult.results).filter(key => !key.endsWith('_analyzer')).length;
}

export function hasAnalyzerFailure(executionResult: ExecutionResult | null | undefined): boolean {
  const values = Object.values(executionResult?.results || {});
  return values.some(value => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    const errorText = String(record.error || record.message || '').toLowerCase();
    return record.success === false && (
      errorText.includes('data') ||
      errorText.includes('baseline') ||
      errorText.includes('comparison') ||
      errorText.includes('dependency')
    );
  });
}

export function hasTinyGenericResult(executionResult: ExecutionResult | null | undefined): boolean {
  const values = Object.values(executionResult?.results || {});
  if (values.length === 0) return false;

  return values.every(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length > 0 && keys.length <= 2 && keys.every(key => ['totalTime', 'durationMs', 'success', 'message'].includes(key));
  });
}

export function containsWriteSuccessClaim(text: string): boolean {
  const normalized = text.toLowerCase();
  return WRITE_SUCCESS_WORDS.some(word => normalized.includes(word));
}

export function hasWriteProof(executionResult: ExecutionResult | null | undefined): boolean {
  const values = Object.values(executionResult?.results || {});
  return values.some(value => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return record.success === true || !!record.id || !!record.deleted || !!record.created || !!record.sent;
  });
}

