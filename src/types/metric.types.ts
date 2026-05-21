export interface PipelineMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  intentDistribution: Record<string, number>;
  fallbackToChatCount: number;
  slotFillingCount: number;
}