import { conversationStateService } from './conversationState.service';
import { workingMemoryService, type WorkingMemoryData } from './workingMemory.service';
import { type ContinuationResult } from './continuationResolver.service';

import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { appLogger } from '../utils/logger.util';

import { episodicMemoryService } from '../services/episodic-memory.service';

import { PipelineCore, type PipelineExecutionContext } from './cores/pipeline-core';
import { ExecutionStage, NaturalizationStage, ContinuationStage, SlotFillingStage, ChatStage } from './cores/stages';
import { WorkingMemoryUpdater } from './cores/memory/working-memory-updater';
import { AgentLoader } from './cores/loaders/agent.loader';
import { PipelineMetricsService } from './cores/metrics/pipeline-metrics.service';


import type { PipelineInput, PipelineResult, PendingIntentState } from '../types';

import type { Agent } from '../types/agent.types';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import { withRetry } from '../utils/async-helpers.util';

// ============================================================
// Pipeline Service Class
// ============================================================

class PipelineService {
  // Core module instances
  private pipelineCore: PipelineCore | null = null;
  private workingMemoryUpdater: WorkingMemoryUpdater | null = null;
  private agentLoader: AgentLoader | null = null;
  private metricsService: PipelineMetricsService | null = null;
  private chatStage: ChatStage | null = null;
  private executionStage: ExecutionStage | null = null;
  private naturalizationStage: NaturalizationStage | null = null;
  private continuationStage: ContinuationStage | null = null;
  private slotFillingStage: SlotFillingStage | null = null;

  // Lazy initialization
  private getPipelineCore(): PipelineCore {
    if (!this.pipelineCore) {
      this.pipelineCore = new PipelineCore();
    }
    return this.pipelineCore;
  }

  private getWorkingMemoryUpdater(): WorkingMemoryUpdater {
    if (!this.workingMemoryUpdater) {
      this.workingMemoryUpdater = new WorkingMemoryUpdater();
    }
    return this.workingMemoryUpdater;
  }

  private getAgentLoader(): AgentLoader {
    if (!this.agentLoader) {
      this.agentLoader = new AgentLoader();
    }
    return this.agentLoader;
  }

  private getMetricsService(): PipelineMetricsService {
    if (!this.metricsService) {
      this.metricsService = new PipelineMetricsService();
    }
    return this.metricsService;
  }

  private getChatStage(): ChatStage {
    if (!this.chatStage) {
      this.chatStage = new ChatStage();
    }
    return this.chatStage;
  }

  private getExecutionStage(): ExecutionStage {
    if (!this.executionStage) {
      this.executionStage = new ExecutionStage();
    }
    return this.executionStage;
  }

  private getContinuationStage(): ContinuationStage {
    if (!this.continuationStage) {
      this.continuationStage = new ContinuationStage();
    }
    return this.continuationStage;
  }

  private getSlotFillingStage(): SlotFillingStage {
    if (!this.slotFillingStage) {
      this.slotFillingStage = new SlotFillingStage();
    }
    return this.slotFillingStage;
  }

  // ============================================================
  // PUBLIC ENTRYPOINT
  // ============================================================
  async run(input: PipelineInput): Promise<PipelineResult> {
    const startTotal = Date.now();
    const metricsService = this.getMetricsService();

    appLogger.info('Pipeline started', {
      userId: input.user_id,
      appName: input.app_name,
      textLength: input.text.length
    });

    try {
      // ============================================================
      // PRE-STAGE 1 : Get agent by slug from input.app_name
      // ============================================================
      const agentLoader = this.getAgentLoader();
      const agent = await withRetry(
        () => agentLoader.loadBySlug(input.app_name),
        'agentLoader.loadBySlug'
      );

      // ============================================================
      // PRE-STAGE 2 : Check for pending conversation state (slot filling)
      // ============================================================
      const pending = conversationStateService.get(input.user_id, input.app_name);

      // Clear state jika user mengirim pesan "cancel"
      if (input.text.toLowerCase() === 'cancel' || input.text.toLowerCase() === 'batal') {
        await conversationStateService.clear(input.user_id, input.app_name);
        appLogger.info('User cancelled pending intent', {
          userId: input.user_id,
          appName: input.app_name
        });

        return PipelineFormatter.buildEarly({
          intent: 'cancel',
          score: 1,
          message: 'Oke, permintaan sebelumnya sudah saya batalkan. Ada lagi yang bisa saya bantu?'
        }, startTotal);
      }

      if (pending) {
        appLogger.debug('Resuming pending intent', {
          userId: input.user_id,
          intentSlugs: pending.intentSlugs
        });

        metricsService.recordSlotFilling();
        const slotFillingStage = this.getSlotFillingStage();
        const result = await slotFillingStage.resume(input, pending, agent, startTotal);
        
        if (result.result) {
          return result.result;
        }
        return await this.getChatStage().execute(input, agent, startTotal);
      }

      // ============================================================
      // PRE-STAGE 3 : WORKING MEMORY & CONTINUATION RESOLVER
      // ============================================================
      const workingMemory = await workingMemoryService.get(input.user_id, input.app_name);
      
      appLogger.debug('[Pipeline] Working Memory retrieved', {
        userId: input.user_id,
        appName: input.app_name,
        hasMemory: !!workingMemory,
        activeIntent: workingMemory?.activeIntent,
        activeTool: workingMemory?.activeTool
      });

      const continuationStage = this.getContinuationStage();
      const continuationInput: PipelineInput = {
        user_id: input.user_id,
        app_name: input.app_name,
        text: input.text
      };
      const continuationResult = await continuationStage.execute(continuationInput, workingMemory);

      appLogger.debug('Continuation resolution result', {
        userId: input.user_id,
        appName: input.app_name,
        continuationType: continuationResult.intent.type,
        targetTool: continuationResult.intent.targetHandler,
        confidence: continuationResult.intent.confidence
      });

      if (continuationResult.shouldSkipPipeline && continuationResult.intent.isContinuation) {
        appLogger.info('[Pipeline] Continuation detected, skipping full pipeline', {
          userId: input.user_id,
          appName: input.app_name,
          continuationType: continuationResult.intent.type,
          targetTool: continuationResult.intent.targetHandler,
          confidence: continuationResult.intent.confidence
        });

        // Execute continuation using stages
        return await this.executeContinuation(
          input,
          workingMemory?.activeIntent || 'general_chat',
          agent as Agent,
          continuationResult,
          startTotal
        );
      }

      // ============================================================
      // PRE-STAGE 4 : GET EPISODIC MEMORY
      // ============================================================
      const episodicMemory = await episodicMemoryService.getLastContext(
        input.user_id,
        input.app_name
      );


      // ============================================================
      // STAGE 0: MAIN PIPELINE FLOW (uses PipelineCore)
      // ============================================================
      const result = await this.executeMainPipeline(input, agent, startTotal, workingMemory, episodicMemory);


      // ============================================================
      // POST-STAGE 1: UPDATE WORKING MEMORY SETELAH EKSEKUSI BERHASIL
      // ============================================================
      const workingMemoryUpdater = this.getWorkingMemoryUpdater();
      await workingMemoryUpdater.update(input.user_id, input.app_name, {
        type: 'plan',
        apiResults: result.apiResult as Record<string, unknown>,
        plan: { mode: 'single_step', chat: false, tasks: [] },
        activeIntent: result.intent || null
      });

      // Record metrics
      const duration = Date.now() - startTotal;
      metricsService.recordSuccess(result.intent, duration);

      return result;

    } catch (err) {
      const duration = Date.now() - startTotal;
      metricsService.recordFailure(
        err instanceof Error ? err : new Error('Unknown error'),
        duration
      );

      appLogger.error('Pipeline failed', {
        userId: input.user_id,
        appName: input.app_name,
        error: err instanceof Error ? err.message : err,
        durationMs: duration
      });

      // Return error response instead of throwing
      return PipelineFormatter.buildEarly({
        intent: 'error',
        score: 0,
        message: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.'
      }, startTotal);
    }
  }

  // ============================================================
  // MAIN PIPELINE EXECUTION
  // ============================================================
  private async executeMainPipeline(
    input: PipelineInput,
    agent: Agent | null,
    startTotal: number,
    workingMemory?: WorkingMemoryData | null,
    episodicMemory?: EpisodicMemory | null
  ): Promise<PipelineResult> {
    try {
      if (!agent) {
        appLogger.warn('Agent is null, using default behavior');
      }

      // ============================================================
      // USE PIPELINECORE FOR MAIN EXECUTION
      // ============================================================
      const pipelineCore = this.getPipelineCore();

      const context: PipelineExecutionContext = {
        agent: agent as Agent,
        workingMemory: workingMemory || null,
        episodicMemory: episodicMemory || null,
        startTotal
      };

      // Execute via PipelineCore
      const coreResult = await pipelineCore.execute(input, context);

      // Handle slot filling response from PipelineCore
      const slotFillingStage = this.getSlotFillingStage();
      const slotFillingResult = await slotFillingStage.handleCoreResult(
        coreResult,
        input,
        agent as Agent,
        startTotal
      );

      if (slotFillingResult) {
        return slotFillingResult;
      }

      // Handle chat fallback
      if (coreResult.intent === 'general_chat') {
        return await this.getChatStage().execute(input, agent as Agent, startTotal);
      }

      // ============================================================
      // POST-PIPELINECORE: Update working memory
      // ============================================================
      const workingMemoryUpdater = this.getWorkingMemoryUpdater();
      await workingMemoryUpdater.update(input.user_id, input.app_name, {
        type: 'plan',
        apiResults: coreResult.apiResult as Record<string, unknown>,
        activeIntent: coreResult.intent || null
      });

      // Return PipelineCore result (already formatted)
      // Note: PipelineCore returns metadata with durationMs, but PipelineResult expects number values
      return {
        intent: coreResult.intent,
        score: coreResult.score,
        apiResult: coreResult.apiResult,
        naturalResponse: coreResult.naturalResponse,
        metadata: coreResult.metadata as Record<string, number>
      };

    } catch (err) {
      appLogger.error('Main pipeline execution failed', {
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined
      });
      throw err;
    }
  }

  // ============================================================
  // PRE-STAGE 3.1 — CONTINUATION EXECUTION (Uses ContinuationStage)
  // ============================================================
  private async executeContinuation(
    input: PipelineInput,
    activeIntent: string,
    agent: Agent,
    continuationResult: ContinuationResult,
    startTotal: number
  ): Promise<PipelineResult> {
    const continuationStage = this.getContinuationStage();
    return await continuationStage.executeContinuationHandler(
      input,
      activeIntent,
      agent,
      continuationResult,
      startTotal
    );
  }
}

export const pipelineService = new PipelineService();
