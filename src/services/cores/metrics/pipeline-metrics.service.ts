import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface PipelineMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
  intentDistribution: Record<string, number>;
  fallbackToChatCount: number;
  slotFillingCount: number;
}

// ============================================================
// PipelineMetricsService
// ============================================================

/**
 * PipelineMetricsService - Handles pipeline metrics tracking
 * 
 * Responsibilities:
 * - Record successful/failed executions
 * - Track fallback to chat and slot filling events
 * - Calculate average duration
 * - Track intent distribution
 * - Provide metrics for monitoring
 */
export class PipelineMetricsService {
  private metrics: PipelineMetrics = {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    averageDuration: 0,
    intentDistribution: {},
    fallbackToChatCount: 0,
    slotFillingCount: 0
  };

  /**
   * Record successful pipeline execution
   */
  recordSuccess(intent: string, durationMs: number): void {
    this.metrics.successfulRuns++;
    this.metrics.totalRuns++;
    this.updateAverageDuration(durationMs);
    this.trackIntentDistribution(intent);

    appLogger.debug('[PipelineMetrics] Success recorded', {
      intent,
      durationMs,
      totalRuns: this.metrics.totalRuns,
      averageDuration: this.metrics.averageDuration
    });
  }

  /**
   * Record failed pipeline execution
   */
  recordFailure(error: Error, durationMs: number): void {
    this.metrics.failedRuns++;
    this.metrics.totalRuns++;
    this.updateAverageDuration(durationMs);

    appLogger.error('[PipelineMetrics] Failure recorded', {
      error: error.message,
      durationMs,
      totalRuns: this.metrics.totalRuns,
      failedRuns: this.metrics.failedRuns
    });
  }

  /**
   * Record fallback to chat
   */
  recordFallbackToChat(): void {
    this.metrics.fallbackToChatCount++;

    appLogger.debug('[PipelineMetrics] Fallback to chat recorded', {
      fallbackToChatCount: this.metrics.fallbackToChatCount
    });
  }

  /**
   * Record slot filling event
   */
  recordSlotFilling(): void {
    this.metrics.slotFillingCount++;

    appLogger.debug('[PipelineMetrics] Slot filling recorded', {
      slotFillingCount: this.metrics.slotFillingCount
    });
  }

  /**
   * Get current metrics object
   */
  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }

  /**
   * Get average duration
   */
  getAverageDuration(): number {
    return this.metrics.averageDuration;
  }

  /**
   * Get success rate
   */
  getSuccessRate(): number {
    if (this.metrics.totalRuns === 0) return 0;
    return (this.metrics.successfulRuns / this.metrics.totalRuns) * 100;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Update average duration with exponential moving average
   */
  private updateAverageDuration(durationMs: number): void {
    const totalRuns = this.metrics.successfulRuns + this.metrics.failedRuns;
    
    if (totalRuns === 1) {
      this.metrics.averageDuration = durationMs;
    } else {
      this.metrics.averageDuration =
        (this.metrics.averageDuration * (totalRuns - 1) + durationMs) / totalRuns;
    }
  }

  /**
   * Track intent distribution
   */
  private trackIntentDistribution(intent: string): void {
    this.metrics.intentDistribution[intent] =
      (this.metrics.intentDistribution[intent] || 0) + 1;
  }
}
