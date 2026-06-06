// ============================================================
// Workflow Analyzer - Tracks multi-step workflows
// ============================================================
// Detects: "lalu export pdf", "setelah itu kirim email"
// ============================================================

import {
  WORKFLOW_PATTERNS,
  ACTION_PATTERNS,
  FORMAT_PATTERNS,
  matchesAnyPattern,
  CONTINUATION_EXPORT_PATTERNS,
} from '../../../../utils/patterns';
import type { WorkingMemoryData } from '../../../../types/working-memory.type';

// ============================================================
// Types
// ============================================================

export interface WorkflowStep {
  intent: string;
  tool?: string;
  skill?: string;
  status: 'pending' | 'completed' | 'failed';
  result?: unknown;
}

export interface WorkflowDetection {
  hasWorkflow: boolean;
  currentStep: number;
  totalSteps: number;
  nextExpectedAction?: string;
  confidence: number;
  workflowType?: 'sequential' | 'parallel' | 'conditional';
}

export interface WorkflowAnalysisResult {
  detection: WorkflowDetection;
  workflowScore: number;  // 0-1 confidence score
}

// ============================================================
// Workflow Analyzer
// ============================================================

/**
 * WorkflowAnalyzer - Detects multi-step workflow continuations
 *
 * Examples:
 * - "buatkan analisa lalu export pdf" → sequential workflow
 * - "setelah itu kirim email" → next step in workflow
 * - "kemudian simpan ke excel" → workflow continuation
 */
export class WorkflowAnalyzer {
  /**
   * Analyze user input for workflow continuation
   */
  analyze(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): WorkflowAnalysisResult {
    const detection = this.detectWorkflow(userInput, workingMemory);
    const workflowScore = detection.hasWorkflow ? detection.confidence : 0;

    return {
      detection,
      workflowScore
    };
  }

  /**
   * Detect workflow continuation
   */
  private detectWorkflow(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): WorkflowDetection {
    // Check if there's an active workflow in memory
    const hasActiveWorkflow = !!(
      workingMemory?.activeWorkflow ||
      workingMemory?.activeIntent
    );

    // Check for workflow keywords
    const hasWorkflowKeyword = matchesAnyPattern(userInput, WORKFLOW_PATTERNS);

    // Check for export after analysis
    const hasExportRequest = matchesAnyPattern(userInput, CONTINUATION_EXPORT_PATTERNS);
    const isExportAfterAnalysis = hasActiveWorkflow && hasExportRequest;

    // Check for email sending after report
    const hasEmailRequest = /kirim.*email|send.*email|email/i.test(userInput);
    const isEmailAfterReport = workingMemory?.activeIntent?.includes('report') && hasEmailRequest;

    // Check for sequential actions ("lalu", "kemudian", "setelah itu")
    const hasSequentialMarker = /lalu|kemudian|setelah.*itu|selanjutnya/i.test(userInput);

    // Determine workflow type and confidence
    if (isExportAfterAnalysis) {
      return {
        hasWorkflow: true,
        currentStep: 2,
        totalSteps: 2,
        nextExpectedAction: 'export',
        confidence: 0.90,
        workflowType: 'sequential'
      };
    }

    if (isEmailAfterReport) {
      return {
        hasWorkflow: true,
        currentStep: 2,
        totalSteps: 2,
        nextExpectedAction: 'send_email',
        confidence: 0.85,
        workflowType: 'sequential'
      };
    }

    if (hasSequentialMarker && hasActiveWorkflow) {
      return {
        hasWorkflow: true,
        currentStep: this.inferCurrentStep(workingMemory),
        totalSteps: this.estimateTotalSteps(userInput),
        confidence: 0.75,
        workflowType: 'sequential'
      };
    }

    if (hasWorkflowKeyword && hasActiveWorkflow) {
      return {
        hasWorkflow: true,
        currentStep: 1,
        totalSteps: 1,
        confidence: 0.60,
        workflowType: 'sequential'
      };
    }

    // No workflow detected
    return {
      hasWorkflow: false,
      currentStep: 0,
      totalSteps: 0,
      confidence: 0
    };
  }

  /**
   * Infer current step from working memory
   */
  private inferCurrentStep(workingMemory: WorkingMemoryData | null): number {
    if (!workingMemory) {
      return 1;
    }

    // Check metadata for execution history
    const metadata = workingMemory.metadata;
    if (metadata?.lastExecution) {
      // Already executed once, so this is step 2
      return 2;
    }

    return 1;
  }

  /**
   * Estimate total steps from input
   */
  private estimateTotalSteps(userInput: string): number {
    // Count action words
    const actionCount = ACTION_PATTERNS.filter(pattern =>
      pattern.test(userInput)
    ).length;

    // Count format requests
    const formatCount = FORMAT_PATTERNS.filter(item =>
      item.pattern.test(userInput)
    ).length;

    // Estimate: at least 2 steps if there's workflow marker
    return Math.max(2, actionCount + formatCount);
  }

  /**
   * Check if input indicates workflow completion
   */
  isWorkflowComplete(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): boolean {
    if (!workingMemory?.activeWorkflow) {
      return false;
    }

    // Check for completion markers
    const completionMarkers = [
      /\bselesai\b/i,
      /\bfinished\b/i,
      /\bcomplete\b/i,
      /\bsudah\b/i,
      /\bdone\b/i,
      /\bok\b/i,
      /\boke\b/i,
    ];

    return matchesAnyPattern(userInput, completionMarkers);
  }

  /**
   * Get next expected action based on workflow
   */
  getNextExpectedAction(
    currentIntent: string,
    workingMemory: WorkingMemoryData | null
  ): string | null {
    if (!workingMemory) {
      return null;
    }

    // Common workflow patterns
    const workflowTransitions: Record<string, string> = {
      'analyze': 'export',
      'report': 'send_email',
      'data_retrieval': 'analyze',
      'search': 'export',
      'create': 'review',
    };

    return workflowTransitions[currentIntent] || null;
  }

  /**
   * Detect if user wants to modify previous workflow step
   */
  isWorkflowModification(userInput: string): boolean {
    const modificationMarkers = [
      /\bubah\b/i,
      /\bganti\b/i,
      /\bmodify\b/i,
      /\bupdate\b/i,
      /\brevisi\b/i,
      /\bedit\b/i,
      /\bfix\b/i,
      /\bperbaiki\b/i,
    ];

    return matchesAnyPattern(userInput, modificationMarkers);
  }
}

// Singleton instance
export const workflowAnalyzer = new WorkflowAnalyzer();
