import { naturalizationService } from '../../naturalization.service';
import { userProfileService } from '../../user-profile.service';
import type { PipelineInput } from '../../../types';
import type { Agent } from '../../../types/agent.types';
import type { ContextCache } from './types/context-cache';
import { appLogger } from '../../../utils/logger.util';
import { withTimeout } from '../../../utils/async-helpers.util';

const NATURALIZATION_TIMEOUT = 15000;

// ============================================================
// Types
// ============================================================

export interface NaturalizationStageOptions {
  timeout?: number;
  contextCache?: ContextCache;
}

// ============================================================
// NaturalizationStage
// ============================================================

/**
 * NaturalizationStage - Converts API results to natural language
 * 
 * Responsibilities:
 * - Convert API result to natural language
 * - Use LLM for naturalization
 * - Handle different result types
 */
export class NaturalizationStage {
  /**
   * Execute naturalization
   * 
   * @param result - API execution result to naturalize
   * @param input - Original pipeline input
   * @param agent - Agent context
   * @param options - Optional configuration
   * @returns Natural language response string
   */
  async execute(
    result: unknown,
    input: PipelineInput,
    agent: Agent,
    options?: NaturalizationStageOptions
  ): Promise<string> {
    const timeout = options?.timeout ?? NATURALIZATION_TIMEOUT;

    try {
      // Resolve user name: user profile > input.attributes.name > 'User'
      let userName = 'User';
      try {
        const profile = await userProfileService.getContext(input.user_id, input.app_name);
        if (profile?.identity?.name) {
          userName = profile.identity.name;
        } else if (input.attributes?.name) {
          userName = input.attributes.name as string;
        }
      } catch {
        userName = (input.attributes?.name as string) || 'User';
      }

      const naturalResponse = await withTimeout(
        naturalizationService.naturalize(
          agent,
          result,
          input,
          userName,
          input.language || 'Indonesia',
          options?.contextCache
        ),
        timeout,
        'naturalizationService.naturalize'
      );

      appLogger.debug('NaturalizationStage: Response naturalized', {
        userId: input.user_id,
        appName: input.app_name,
        responseLength: naturalResponse.length
      });

      return naturalResponse;

    } catch (error) {
      appLogger.error('NaturalizationStage: Naturalization failed', {
        error: error instanceof Error ? error.message : error,
        userId: input.user_id,
        appName: input.app_name
      });

      // Fallback: return raw result as string
      return this.fallbackNaturalization(result);
    }
  }

  /**
   * Fallback naturalization when LLM fails
   */
  private fallbackNaturalization(result: unknown): string {
    if (result === null || result === undefined) {
      return 'Tidak ada hasil untuk ditampilkan.';
    }

    if (typeof result === 'string') {
      return result;
    }

    if (typeof result === 'number' || typeof result === 'boolean') {
      return String(result);
    }

    if (typeof result === 'object') {
      try {
        return JSON.stringify(result, null, 2);
      } catch {
        return '[Object result]';
      }
    }

    return String(result);
  }
}
