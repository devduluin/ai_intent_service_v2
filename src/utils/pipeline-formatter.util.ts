// utils/pipeline-formatter.util.ts
import type { PipelineResult, PipelineError } from '../types';

export class PipelineFormatter {
  /**
   * Membangun hasil untuk kasus awal/pre-execution 
   */
  static buildEarly(decision: { intent: string, score: number, message: string }, startTime: number): PipelineResult {
    return {
      intent: decision.intent,
      score: decision.score,
      apiResult: null,
      naturalResponse: decision.message,
      metadata: this.getMetadata(startTime)
    };
  }

  /**
   * Membangun hasil sukses setelah eksekusi
   */
  static buildSuccess(intentName: string, score: number, apiResult: any, response: string, startTime: number): PipelineResult {
    return {
      intent: intentName,
      score: score,
      apiResult,
      naturalResponse: response,
      metadata: this.getMetadata(startTime)
    };
  }

  static buildSuccessMulti(
    intentName: string,
    score: number,
    apiResult: unknown,
    naturalResponse: string,
    startTime: number
  ): PipelineResult {
    return {
      intent: intentName,
      score,
      apiResult,
      naturalResponse,
      metadata: this.getMetadata(startTime)
    }
  }

  /**
   * Membangun objek error yang terstandarisasi
   * Menggantikan makeError() di service
   */
  static buildError(stage: PipelineError['stage'], message: string, details?: unknown): PipelineError {
    return { 
      stage, 
      message, 
      details 
    };
  }

  private static getMetadata(startTime: number) {
    return {
      totalTime: Date.now() - startTime
    };
  }
}