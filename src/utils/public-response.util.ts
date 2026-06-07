import type { PipelineMetadata } from '../types';

export function sanitizePublicMetadata(
  metadata: PipelineMetadata | undefined | null,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    totalTime: metadata?.totalTime ?? metadata?.durationMs ?? 0,
    ...(extra || {})
  };
}
