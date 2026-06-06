import { appLogger } from '../../../utils/logger.util';
import { selfCorrectionDetectorService } from '../../self-correction-detector.service';
import type { SelfCorrectionInput, SelfCorrectionResult } from '../../../types/self-correction.types';

export class SelfCorrectionStage {
  async execute(input: SelfCorrectionInput): Promise<SelfCorrectionResult> {
    const result = selfCorrectionDetectorService.detect(input);

    if (result.shouldRecover) {
      appLogger.warn('[SelfCorrectionStage] Recovery issue detected', {
        userId: input.input.user_id,
        appName: input.input.app_name,
        recoveryType: result.recoveryType,
        action: result.action,
        confidence: result.confidence,
        reason: result.reason,
        recoveryAttempt: input.recoveryAttempt || 0
      });
    } else {
      appLogger.debug('[SelfCorrectionStage] No recovery issue detected', {
        userId: input.input.user_id,
        appName: input.input.app_name
      });
    }

    return result;
  }
}

