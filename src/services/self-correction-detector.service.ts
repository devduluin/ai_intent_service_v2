import type { SelfCorrectionInput, SelfCorrectionResult, RecoveryTrace, RecoveryType, RecoveryAction } from '../types/self-correction.types';
import {
  countToolResults,
  hasAnalyzerFailure,
  hasOnlyResource,
  hasTask,
  hasTinyGenericResult
} from '../utils/recovery-signal.util';

class SelfCorrectionDetectorService {
  detect(input: SelfCorrectionInput): SelfCorrectionResult {
    const trace: RecoveryTrace[] = [];

    const issue = this.detectFirstIssue(input);
    if (!issue) {
      return {
        shouldRecover: false,
        confidence: 1,
        action: 'continue',
        trace
      };
    }

    const item = this.toTrace(issue.type, issue.action, issue.reason, issue.confidence);
    trace.push(item);

    return {
      shouldRecover: issue.action !== 'continue',
      recoveryType: issue.type,
      reason: issue.reason,
      confidence: issue.confidence,
      action: issue.action,
      clarificationQuestion: issue.clarificationQuestion,
      trace,
      recoveryContext: {
        detectedIssue: issue.type,
        reason: issue.reason,
        recovered: false,
        blockedSuccessClaim: issue.action === 'block_success_claim',
        trace
      }
    };
  }

  private detectFirstIssue(input: SelfCorrectionInput): {
    type: RecoveryType;
    action: RecoveryAction;
    reason: string;
    confidence: number;
    clarificationQuestion?: string;
  } | null {
    const operations = input.perceptionFrame?.operations || [];
    const frameType = input.perceptionFrame?.type;
    const temporalCount = input.decompositionResult?.signals?.temporalDetails?.length || 0;
    const isComparison = frameType === 'comparison'
      || operations.includes('compare')
      || input.decompositionResult?.signals?.comparison?.isComparison === true
      || temporalCount >= 2;

    if (isComparison && (countToolResults(input.executionResult) < 2 || hasAnalyzerFailure(input.executionResult))) {
      return {
        type: 'temporal_mismatch',
        action: 'ask_clarification',
        reason: 'User requested comparison, but execution did not produce both baseline and comparison datasets.',
        confidence: 0.86,
        clarificationQuestion: 'Saya menangkap Anda ingin membandingkan dua periode, tetapi baru satu data yang berhasil saya ambil. Mau saya ambil periode pembandingnya sekarang?'
      };
    }

    if (
      frameType === 'automation_request'
      && input.perceptionFrame?.confidence
      && input.perceptionFrame.confidence >= 0.65
      && hasOnlyResource(input.plan, 'tool')
      && !hasTask(input.plan, 'skill', 'automation_manager')
    ) {
      return {
        type: 'wrong_resource',
        action: 'ask_clarification',
        reason: 'Perception detected automation request, but planner selected only operational tool tasks.',
        confidence: 0.82,
        clarificationQuestion: 'Saya menangkap ini sebagai automation, tetapi rencana yang terbentuk masih menjalankan data sekarang. Mau saya buatkan automation dari permintaan ini?'
      };
    }

    const hasDataSkillWithDependency = (input.plan.tasks || []).some(task =>
      task.resource === 'skill'
      && task.depends_on?.length > 0
      && /analy(z|s)er|analysis|trend|xls|export/i.test(task.key)
    );

    if (hasDataSkillWithDependency && hasAnalyzerFailure(input.executionResult)) {
      return {
        type: 'missing_dependency_result',
        action: 'ask_clarification',
        reason: 'A data-dependent skill failed because dependency results were incomplete or empty.',
        confidence: 0.8,
        clarificationQuestion: 'Skill analisis membutuhkan data sumber, tetapi data dependensinya belum lengkap. Mau saya ambil ulang data sumbernya dulu?'
      };
    }

    if (hasTinyGenericResult(input.executionResult)) {
      return {
        type: 'result_irrelevant',
        action: 'ask_clarification',
        reason: 'Execution result is too generic to answer the operational request.',
        confidence: 0.72,
        clarificationQuestion: 'Hasil yang saya dapat belum berisi data operasional yang sesuai. Data apa yang ingin saya cek secara spesifik?'
      };
    }

    return null;
  }

  private toTrace(type: RecoveryType, action: RecoveryAction, reason: string, confidence: number): RecoveryTrace {
    return {
      type,
      action,
      reason,
      confidence,
      timestamp: Date.now()
    };
  }
}

export const selfCorrectionDetectorService = new SelfCorrectionDetectorService();

