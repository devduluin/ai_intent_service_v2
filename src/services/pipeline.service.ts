import { conversationStateService } from './conversationState.service';
import { clarificationStateService } from './clarificationState.service';
import { workingMemoryService } from './workingMemory.service';
import { type ContinuationResult } from './cores/resolvers/continuation.resolver';

import { PipelineFormatter } from '../utils/pipeline-formatter.util';
import { trimChatHistory } from '../utils/trim-chat';
import { appLogger } from '../utils/logger.util';

import { episodicMemoryService } from '../services/episodic-memory.service';
import { episodicTopicResolverService } from '../services/episodic-topic-resolver.service';

import { PipelineCore, type PipelineExecutionContext, ContextMemory } from './cores/pipeline-core';
import { ContinuationStage, SlotFillingStage, ChatStage, ExecutionStage, NaturalizationStage } from './cores/stages';
import { WorkingMemoryUpdater } from './cores/memory/working-memory-updater';
import { OfferResolver } from './cores/resolvers/offer.resolver';
import { ConfirmationResolver } from './cores/resolvers/confirmation.resolver';
import { AgentLoader } from './cores/loaders/agent.loader';
import { PipelineMetricsService } from './cores/metrics/pipeline-metrics.service';
import { confirmationStateService } from './confirmation-state.service';
import { confirmationPromptService } from './confirmation-prompt.service';
import { skillsRegistry } from './skills-registry.service';
import { skillSignalService } from './skill-signal.service';
import { handleAutomationManager } from '../skills/automation_manager.skill';
import { normalizeSkillParamsToToolParams } from '../utils/resource-param-normalizer.util';
import { godModeManagerService } from './god-mode-manager.service';
import { automationJobRepository } from '../repositories/automation-job.repository';
import { automationClarificationService } from './automation/automation-clarification.service';
import { automationPretestService } from './automation/automation-pretest.service';
import { isGenericAutomationGoal } from '../utils/automation-param.util';
import { userProfileService } from './user-profile.service';
import {
  isCancellationText,
  isConfirmDeleteText
} from '../utils/text-intent-cleanup.util';


import type { PipelineInput, PipelineResult } from '../types';

import type { Agent } from '../types/agent.types';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import type { WorkingMemoryData } from '../types/working-memory.type';
import { withRetry } from '../utils/async-helpers.util';
import { ConversationUtil } from '../utils/conversation.util';

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
  private continuationStage: ContinuationStage | null = null;
  private slotFillingStage: SlotFillingStage | null = null;
  private offerResolver: OfferResolver | null = null;
  private confirmationResolver: ConfirmationResolver | null = null;
  private executionStage: ExecutionStage | null = null;
  private naturalizationStage: NaturalizationStage | null = null;

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

  private getOfferResolver(): OfferResolver {
    if (!this.offerResolver) {
      this.offerResolver = new OfferResolver();
    }
    return this.offerResolver;
  }

  private getConfirmationResolver(): ConfirmationResolver {
    if (!this.confirmationResolver) {
      this.confirmationResolver = new ConfirmationResolver();
    }
    return this.confirmationResolver;
  }

  private getExecutionStage(): ExecutionStage {
    if (!this.executionStage) {
      this.executionStage = new ExecutionStage();
    }
    return this.executionStage;
  }

  private getNaturalizationStage(): NaturalizationStage {
    if (!this.naturalizationStage) {
      this.naturalizationStage = new NaturalizationStage();
    }
    return this.naturalizationStage;
  }

  // ============================================================
  // PUBLIC ENTRYPOINT
  // ============================================================
  async run(input: PipelineInput): Promise<PipelineResult> {
    const startTotal = Date.now();
    const metricsService = this.getMetricsService();

    const trimmedHistory = trimChatHistory(input.chat_history, {
      maxMessages: 6,
      maxLength: 200,
    });

    if (trimmedHistory?.length) {
      input.chat_history = trimmedHistory;
    }

    appLogger.info('Pipeline started', {
      userId: input.user_id,
      appName: input.app_name,
      textLength: input.text.length,
      attributes: input.attributes,
      attributesParams: input.attributes?.params  // ✅ Debug log for params
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

      await userProfileService.upsertFromAttributes(input).catch(error => {
        appLogger.debug('[Pipeline] User profile attribute upsert failed (non-blocking)', {
          userId: input.user_id,
          appName: input.app_name,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      // ============================================================
      // PRE-STAGE 2 : Check for pending conversation state (slot filling)
      // ============================================================
      const pending = conversationStateService.get(input.user_id, input.app_name);
      const pendingConfirmation = await confirmationStateService.get(input.user_id, input.app_name);
      const clarificationState = clarificationStateService.get(input.user_id, input.app_name);

      if (await godModeManagerService.shouldExitActiveMode(input)) {
        await conversationStateService.clear(input.user_id, input.app_name);
        await clarificationStateService.clear(input.user_id, input.app_name);
        await confirmationStateService.clear(input.user_id, input.app_name);
        return await godModeManagerService.handle(input, startTotal);
      }

      if (this.isSlashCommand(input.text)) {
        await conversationStateService.clear(input.user_id, input.app_name);
        await clarificationStateService.clear(input.user_id, input.app_name);
        await confirmationStateService.clear(input.user_id, input.app_name);

        if (godModeManagerService.isEnterCommand(input.text)) {
          return await godModeManagerService.handle(input, startTotal);
        }

        return PipelineFormatter.buildEarly({
          intent: 'unsupported_mode_command',
          score: 1,
          message: [
            'Saya belum mengenali perintah mode itu.',
            '',
            'Gunakan `/automation manager` untuk masuk mode automation manager, atau `/me` untuk mode profil user.',
            'Kalau ingin chat biasa, tulis tanpa awalan `/`.'
          ].join('\n')
        }, startTotal);
      }

      if (
        isCancellationText(input.text) &&
        !this.shouldRouteCancellationToConfirmation(input.text, pendingConfirmation) &&
        (pending || pendingConfirmation || clarificationState)
      ) {
        await conversationStateService.clear(input.user_id, input.app_name);
        await clarificationStateService.clear(input.user_id, input.app_name);
        await confirmationStateService.clear(input.user_id, input.app_name);
        appLogger.info('[Pipeline] User cancelled active conversational state', {
          userId: input.user_id,
          appName: input.app_name,
          hadPendingSlot: !!pending,
          hadConfirmation: !!pendingConfirmation,
          hadClarification: !!clarificationState
        });

        return PipelineFormatter.buildEarly({
          intent: 'cancel',
          score: 1,
          message: pendingConfirmation?.status === 'expired'
            ? 'Draft sebelumnya sudah kedaluwarsa, jadi tidak saya lanjutkan.'
            : 'Baik, saya batalkan draftnya. Tidak ada automation baru yang disimpan.\n\nBerikutnya, Anda bisa membuat reminder atau conditional alert lain.'
        }, startTotal);
      }

      if (
        isCancellationText(input.text) &&
        !pending &&
        !pendingConfirmation &&
        !clarificationState
      ) {
        return PipelineFormatter.buildEarly({
          intent: 'cancel_noop',
          score: 1,
          message: this.buildCancelNoopMessage(input)
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

        // ✅ FIX #1: Handle all slot filling result cases
        if (result.result) {
          result.result = await this.captureAutomationClarificationIfNeeded(input, result.result);
          result.result = await this.captureConfirmationIfNeeded(input, result.result, startTotal);

          // Case 1: Execution complete OR clarification question
          if (result.isComplete && result.collectedParams) {
            // Update working memory after successful execution
            const workingMemoryUpdater = this.getWorkingMemoryUpdater();
            const pendingPlan = pending.originalPlan || { mode: 'single_step' as const, chat: false, tasks: [] };
            const activeTool = pendingPlan.tasks?.find(task => task.resource === 'tool')?.key ||
              pendingPlan.tasks?.[0]?.key ||
              pending.intentSlugs?.[0];

            await workingMemoryUpdater.update(input.user_id, input.app_name, {
              type: 'plan',
              apiResults: result.result.apiResult as Record<string, unknown>,
              plan: pendingPlan,
              params: result.collectedParams,
              sourceText: input.text,
              activeIntent: pending.intentSlugs?.[0] || activeTool || 'slot_filling',
              activeTool
            });

            appLogger.info('[Pipeline] Working memory updated after slot filling', {
              userId: input.user_id,
              appName: input.app_name,
              activeIntent: pending.intentSlugs?.[0],
              activeTool,
              memoryUpdateOwner: 'pipeline.run.slot_filling'
            });

            if (result.result.metadata?.activeOffer) {
              await workingMemoryService.setActiveOffer(
                input.user_id,
                input.app_name,
                result.result.metadata.activeOffer as any
              );
            }
          }
          
          appLogger.info('[Pipeline] Slot filling returned result', {
            userId: input.user_id,
            isComplete: result.isComplete,
            hasResult: !!result.result
          });
          
          return result.result;
        }
        
        // ✅ Case 2: Slot filling in progress (shouldContinue = true)
        if (result.shouldContinue) {
          appLogger.debug('[Pipeline] Slot filling in progress', {
            userId: input.user_id,
            retryCount: result.retryCount,
            reason: result.reason
          });
          // Don't fall back to chat - slot filling will handle the response
          return PipelineFormatter.buildEarly({
            intent: 'slot_filling',
            score: 1,
            message: result.error || 'Mohon lengkapi informasi yang diminta agar saya bisa melanjutkan.'
          }, startTotal);
        }

        // Retry exceeded or failed: re-enter main pipeline with this input.
        if (result.retryExceeded) {
          await conversationStateService.clear(input.user_id, input.app_name);
          return await this.run(input);
        }

        await conversationStateService.clear(input.user_id, input.app_name);
        return await this.run(input);
      }

      if (pendingConfirmation) {
        const confirmationResponse = await this.resolveConfirmationIfAny(input, agent as Agent, startTotal, pendingConfirmation);
        if (confirmationResponse) return confirmationResponse;
      }

      // Entrypoint God Mode - bypass entire pipeline only when mode is already active.
      if (await godModeManagerService.shouldHandle(input)) {
        return await godModeManagerService.handle(input, startTotal);
      }

      if (userProfileService.isExplicitProfileStatement(input.text)) {
        const savedProfile = await userProfileService.extractAndUpsert(input);
        return PipelineFormatter.buildEarly({
          intent: 'user_profile_saved',
          score: 1,
          message: userProfileService.formatSavedMessage(savedProfile)
        }, startTotal);
      }

      if (clarificationState) {
        if (isCancellationText(input.text)) {
          await clarificationStateService.clear(input.user_id, input.app_name);
          return PipelineFormatter.buildEarly({
            intent: 'cancel',
            score: 1,
            message: 'Oke, klarifikasi sebelumnya sudah saya batalkan. Ada lagi yang bisa saya bantu?'
          }, startTotal);
        }

        const retryCount = await clarificationStateService.incrementRetry(input.user_id, input.app_name);
        if (retryCount > clarificationState.maxRetry) {
          await clarificationStateService.clear(input.user_id, input.app_name);
          return await this.run(input);
        }

        await clarificationStateService.clear(input.user_id, input.app_name);

        const clarifiedInput: PipelineInput = {
          ...input,
          text: this.buildClarifiedQuery(clarificationState.originalText, input.text)
        };

        appLogger.info('[Pipeline] Resuming clarification state', {
          userId: input.user_id,
          appName: input.app_name,
          retryCount,
          originalText: clarificationState.originalText,
          clarificationAnswer: input.text
        });

        return await this.run(clarifiedInput);
      }

      const confirmationResponse = await this.resolveConfirmationIfAny(input, agent as Agent, startTotal, pendingConfirmation);
      if (confirmationResponse) return confirmationResponse;

      // ============================================================
      // PRE-STAGE 3 : WORKING MEMORY & CONTINUATION RESOLVER
      // ============================================================
      const workingMemory = await workingMemoryService.get(input.user_id, input.app_name);
      
      appLogger.debug('[Pipeline] Working Memory retrieved', {
        userId: input.user_id,
        appName: input.app_name,
        hasMemory: !!workingMemory,
        activeIntent: workingMemory?.activeIntent,
        activeTool: workingMemory?.activeTool,
        hasActivePlan: !!workingMemory?.activePlan,
        activePlanTaskCount: workingMemory?.activePlan?.tasks?.length || 0,
        activeEntitiesKeys: Object.keys(workingMemory?.activeEntities || {})
      });

      const offerResponse = await this.resolveActiveOfferIfAny(input, agent as Agent, workingMemory, startTotal);
      if (offerResponse) return offerResponse;

      const bypassContinuationForOrchestration = this.isStrongOrchestrationSkillInput(input.text);
      const continuationStage = this.getContinuationStage();
      const continuationInput: PipelineInput = {
        user_id: input.user_id,
        app_name: input.app_name,
        text: input.text
      };
      const continuationResult = bypassContinuationForOrchestration
        ? {
            shouldSkipPipeline: false,
            intent: {
              isContinuation: false,
              type: 'new',
              confidence: 0,
              originalText: input.text
            }
          } as any
        : await continuationStage.execute(continuationInput, workingMemory);

      if (bypassContinuationForOrchestration) {
        appLogger.info('[Pipeline] Strong orchestration skill input bypassed continuation', {
          userId: input.user_id,
          appName: input.app_name,
          text: input.text
        });
      }

      // appLogger.debug('Continuation resolution result', {
      //   userId: input.user_id,
      //   appName: input.app_name,
      //   continuationType: continuationResult.intent.type,
      //   targetTool: continuationResult.intent.targetTool,
      //   targetSkill: continuationResult.intent.targetSkill,
      //   confidence: continuationResult.intent.confidence
      // });

      if (continuationResult.shouldSkipPipeline && continuationResult.intent.isContinuation) {
        appLogger.info('[Pipeline] Continuation detected, skipping full pipeline', {
          userId: input.user_id,
          appName: input.app_name,
          continuationType: continuationResult.intent.type,
          targetTool: continuationResult.intent.targetTool,
          targetSkill: continuationResult.intent.targetSkill,
          confidence: continuationResult.intent.confidence
        });

        // Execute continuation using stages
        const continuationResponse = await this.executeContinuation(
          input,
          workingMemory?.activeIntent || 'general_chat',
          agent as Agent,
          continuationResult,
          startTotal
        );

        // ✅ FIX 2: Explicit return check - prevent fallthrough to main pipeline
        if (continuationResponse) {
          appLogger.info('[Pipeline] Continuation executed successfully, returning', {
            userId: input.user_id,
            appName: input.app_name,
            intent: continuationResponse.intent,
            hasNaturalResponse: !!continuationResponse.naturalResponse
          });
          return continuationResponse;  // ✅ Return immediately, NO FALLBACK!
        }

        // If we get here, continuation execution failed silently
        appLogger.warn('[Pipeline] Continuation returned fallback/error, falling back to main pipeline', {
          userId: input.user_id,
          appName: input.app_name
        });
        // Falls through to main pipeline only if response is invalid
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
      const userProfileContext = await userProfileService.getContext(input.user_id, input.app_name).catch(error => {
        appLogger.debug('[Pipeline] User profile context read failed (non-blocking)', {
          userId: input.user_id,
          appName: input.app_name,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      });

      const executionInput = this.withUserProfileContext(
        this.withWorkingMemoryContext(input, workingMemory),
        userProfileContext
      );
      let result = await this.executeMainPipeline(executionInput, agent, startTotal, workingMemory, episodicMemory);

      if (result.intent === 'clarification') {
        await clarificationStateService.set(input.user_id, input.app_name, {
          originalText: input.text,
          clarificationQuestion: result.naturalResponse,
          originalPlan: result.metadata?.activePlan || null
        });

        appLogger.info('[Pipeline] Clarification state stored', {
          userId: input.user_id,
          appName: input.app_name,
          question: result.naturalResponse
        });

        return result;
      }

      result = await this.captureAutomationClarificationIfNeeded(executionInput, result);
      result = await this.captureConfirmationIfNeeded(executionInput, result, startTotal);

      // ============================================================
      // POST-STAGE 1: UPDATE WORKING MEMORY SETELAH EKSEKUSI BERHASIL
      // ============================================================
      const workingMemoryUpdater = this.getWorkingMemoryUpdater();
      const resultMetadata = result.metadata;
      
      // Extract actual tool slug from executed tasks (not intent slug)
      const executedToolSlug = resultMetadata?.executedTasksDetails?.find?.(task => task.resource === 'tool')?.toolSlug ||
                               resultMetadata?.executedTasksDetails?.find?.(task => task.resource === 'tool')?.key ||
                               resultMetadata?.executedTasksDetails?.[0]?.toolSlug ||
                               resultMetadata?.executedTasksDetails?.[0]?.key ||
                               null;

      // ✅ FIX 3 & 4: Don't update working memory for general_chat fallback
      // Preserve previous context for future queries
      if (result.intent === 'general_chat') {
        appLogger.info('[Pipeline] General chat fallback detected, preserving working memory', {
          userId: input.user_id,
          appName: input.app_name,
          hasCachedContext: !!result.metadata?.hasCachedContext,
          memoryUpdateOwner: 'pipeline.run.access'
        });

        // Don't overwrite activeIntent/activeTool, just update access metadata
        await workingMemoryUpdater.update(input.user_id, input.app_name, {
          type: 'access'  // Only update lastAccessedAt, don't change intent/tool
        });
      } else {
        // Normal intent execution - update working memory
        await workingMemoryUpdater.update(input.user_id, input.app_name, {
          type: 'plan',
          apiResults: result.apiResult as Record<string, unknown>,
          plan: resultMetadata?.activePlan || undefined,
          params: resultMetadata?.resolvedParams as Record<string, unknown>,
          sourceText: input.text,
          activeIntent: result.intent || null,
          activeTool: executedToolSlug  // Use actual tool slug, not intent slug
        });

        if (result.metadata?.activeOffer) {
          await workingMemoryService.setActiveOffer(
            input.user_id,
            input.app_name,
            result.metadata.activeOffer as any
          );
        } else if (workingMemory?.activeOffer?.status === 'active' && result.metadata?.executedTasks) {
          await workingMemoryService.updateActiveOfferStatus(
            input.user_id,
            input.app_name,
            'cleared'
          );
        }

        appLogger.debug('[Pipeline] Working memory updated', {
          userId: input.user_id,
          appName: input.app_name,
          activeIntent: result.intent,
          activeTool: executedToolSlug,
          memoryUpdateOwner: 'pipeline.run'
        });
      }

      const messages = ConversationUtil.buildMessages(input, {
        memoryContext: result.naturalResponse
      });

      const writeContext = await episodicTopicResolverService.resolve({
        result,
        agent,
        workingMemory
      });

      await episodicMemoryService.summarizeWithContext({
        agent,
        userId: input.user_id,
        appName: input.app_name,
        messages,
        writeContext
      });

      // Record metrics
      const duration = Date.now() - startTotal;
      metricsService.recordSuccess(result.intent, duration);

      userProfileService.extractAndUpsertAsync(input);

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
        input: input,  // ✅ ADDED: For episodic memory lookup
        memoryContext: {
          workingMemory: workingMemory || null,
          episodicMemory: episodicMemory || null
        },
        startTotal
      };

      // Execute via PipelineCore
      const coreResult = await pipelineCore.execute(context);

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

      // Return PipelineCore result (already formatted)
      return {
        intent: coreResult.intent,
        score: coreResult.score,
        apiResult: coreResult.apiResult,
        naturalResponse: coreResult.naturalResponse,
        metadata: coreResult.metadata
      };

    } catch (err) {
      appLogger.error('Main pipeline execution failed', {
        error: err instanceof Error ? err.message : err,
        stack: err instanceof Error ? err.stack : undefined
      });
      throw err;
    }
  }

  private async resolveConfirmationIfAny(
    input: PipelineInput,
    agent: Agent,
    startTotal: number,
    existingPending?: Awaited<ReturnType<typeof confirmationStateService.get>> | null
  ): Promise<PipelineResult | null> {
    const pending = existingPending !== undefined
      ? existingPending
      : await confirmationStateService.get(input.user_id, input.app_name);
    const resolution = await this.getConfirmationResolver().resolve(input, pending);

    if (resolution.expired) {
      await confirmationStateService.clear(input.user_id, input.app_name);
      return PipelineFormatter.buildEarly({
        intent: 'confirmation_expired',
        score: 1,
        message: 'Draft konfirmasi sebelumnya sudah kedaluwarsa, jadi tidak saya lanjutkan.'
      }, startTotal);
    }

    if (!resolution.isConfirmationResponse) {
      if (pending) {
        appLogger.debug('[Pipeline] Pending confirmation ignored by resolver', {
          userId: input.user_id,
          appName: input.app_name,
          text: input.text,
          confirmationType: pending.type,
          confirmationStatus: pending.status
        });
      }
      return null;
    }

    if (resolution.shouldCancel) {
      await confirmationStateService.clear(input.user_id, input.app_name);
      return PipelineFormatter.buildEarly({
        intent: 'confirmation_cancelled',
        score: 1,
        message: resolution.message || 'Baik, saya batalkan draftnya. Tidak ada automation baru yang disimpan.'
      }, startTotal);
    }

    if (resolution.patch) {
      let updated = await confirmationStateService.patch(input.user_id, input.app_name, resolution.patch);
      if (updated && automationPretestService.shouldPretest(updated.draft)) {
        const draftWithPretest = await automationPretestService.attachPretest(
          input,
          updated.draft,
          pretestInput => this.run(pretestInput)
        );
        updated = await confirmationStateService.patch(input.user_id, input.app_name, draftWithPretest as Record<string, unknown>) || updated;
      }
      return PipelineFormatter.buildEarly({
        intent: 'confirmation_edited',
        score: 1,
        message: await confirmationPromptService.buildPrompt(updated || pending)
      }, startTotal);
    }

    if (resolution.shouldAskAgain && resolution.message) {
      return PipelineFormatter.buildEarly({
        intent: 'confirmation_rejected',
        score: 1,
        message: resolution.message
      }, startTotal);
    }

    if (resolution.shouldCommit && pending) {
      if (pending.type === 'automation_job_delete') {
        const jobId = String(pending.draft?.jobId || '');
        const deleted = jobId
          ? await automationJobRepository.deleteById(jobId)
          : null;
        await confirmationStateService.clear(input.user_id, input.app_name);

        return PipelineFormatter.buildEarly({
          intent: deleted ? 'automation_job_deleted' : 'automation_job_delete_failed',
          score: deleted ? 1 : 0.3,
          message: deleted
            ? [
                'Automation sudah saya hapus dari daftar aktif.',
                `Judul: ${deleted.title}`,
                `Goal: ${deleted.goal}`,
                '',
                'Anda masih berada di mode automation manager. Ketik "list" atau "exit" atau "kluar" untuk keluar.'
              ].join('\n')
            : 'Saya tidak menemukan automation yang akan dihapus.'
        }, startTotal);
      }

      const commitResult = await handleAutomationManager(
        {
          _confirmed: true,
          _draft: pending.draft
        },
        input
      );
      await confirmationStateService.clear(input.user_id, input.app_name);

      const message = commitResult.kind === 'automation_job_created'
        ? confirmationPromptService.buildCreatedMessage(commitResult.job)
        : `Draft sudah dikonfirmasi, tetapi gagal disimpan: ${commitResult.error || 'unknown error'}`;

      return {
        intent: commitResult.kind,
        score: commitResult.kind === 'automation_job_created' ? 1 : 0.4,
        apiResult: {
          automation_manager: commitResult
        },
        naturalResponse: message,
        metadata: {
          durationMs: Date.now() - startTotal,
          confirmation: {
            status: commitResult.kind === 'automation_job_created' ? 'confirmed' : 'failed',
            type: pending.type
          }
        }
      };
    }

    return null;
  }

  private shouldRouteCancellationToConfirmation(
    text: string,
    pendingConfirmation: Awaited<ReturnType<typeof confirmationStateService.get>> | null
  ): boolean {
    if (pendingConfirmation?.type !== 'automation_job_delete') {
      return false;
    }

    return isConfirmDeleteText(text);
  }

  private isSlashCommand(text: string): boolean {
    return /^\/[^\s/][\s\S]*$/.test(String(text || '').trim());
  }

  private withWorkingMemoryContext(
    input: PipelineInput,
    workingMemory?: WorkingMemoryData | null
  ): PipelineInput {
    if (!workingMemory) return input;

    return {
      ...input,
      attributes: {
        ...(input.attributes || {}),
        workingMemory
      }
    };
  }

  private async captureConfirmationIfNeeded(
    input: PipelineInput,
    result: PipelineResult,
    startTotal: number
  ): Promise<PipelineResult> {
    const automationResult = this.extractAutomationResult(result.apiResult);
    if (!automationResult || automationResult.kind !== 'confirmation_required' || !automationResult.job) {
      return result;
    }

    const draftWithPretest = await automationPretestService.attachPretest(
      input,
      automationResult.job,
      pretestInput => this.run(pretestInput)
    );

    const confirmation = await confirmationStateService.set(input.user_id, input.app_name, {
      type: 'automation_job_create',
      draft: draftWithPretest as Record<string, any>,
      editableFields: automationResult.confirmation?.editableFields || [
        'goal',
        'schedule',
        'trigger',
        'trigger.runAt',
        'condition',
        'notification',
        'notification.target',
        'notification.channel',
        'notification.offsetMinutes'
      ],
      commitAction: {
        resource: 'skill',
        key: 'automation_manager',
        params: {
          _confirmed: true
        }
      },
      ttlMs: automationResult.confirmation?.expiresInMs || 60 * 1000
    });

    appLogger.info('[Pipeline] Confirmation state stored', {
      userId: input.user_id,
      appName: input.app_name,
      confirmationId: confirmation.id,
      type: confirmation.type,
      expiresAt: confirmation.expiresAt
    });

    return {
      ...result,
      intent: 'confirmation_required',
      naturalResponse: await confirmationPromptService.buildPrompt(confirmation),
      metadata: {
        ...result.metadata,
        confirmation: {
          id: confirmation.id,
          type: confirmation.type,
          status: confirmation.status,
          expiresAt: confirmation.expiresAt
        },
        durationMs: Date.now() - startTotal
      }
    };
  }

  private isStrongOrchestrationSkillInput(text: string): boolean {
    const signal = skillSignalService.detect(text);
    if (!signal.hasStrongSignal || !signal.recommendedSkill) {
      return false;
    }

    const skill = skillsRegistry.getSkillBySlug(signal.recommendedSkill);
    if (!skill?.capabilities) return false;

    const actionTypes = skill.capabilities.actionTypes || [];
    const context = skill.capabilities.context || [];
    return skill.category === 'automation' ||
      actionTypes.includes('automation') ||
      actionTypes.includes('schedule') ||
      actionTypes.includes('monitor') ||
      context.includes('future_task') ||
      context.includes('scheduled_workflow') ||
      context.includes('conditional_alert');
  }

  private async captureAutomationClarificationIfNeeded(
    input: PipelineInput,
    result: PipelineResult
  ): Promise<PipelineResult> {
    const automationResult = this.extractAutomationResult(result.apiResult);
    if (!automationResult || automationResult.kind !== 'automation_clarification_required') {
      return result;
    }

    const skill = skillsRegistry.getSkillBySlug('automation_manager');
    const params = skill ? normalizeSkillParamsToToolParams(skill.paramSchema) : [];
    const missing = this.normalizeAutomationMissingParams(automationResult.missing || []);
    const collectedParams = this.extractAutomationCollectedParams(automationResult.job);

    await conversationStateService.set(input.user_id, input.app_name, {
      intentSlugs: ['automation_manager'],
      missingResourceParams: [
        {
          resource: 'skill',
          key: 'automation_manager',
          name: 'Automation Manager',
          missing,
          params
        }
      ],
      collectedParams,
      lastUserMessage: input.text,
      originalPlan: {
        mode: 'single_step',
        chat: false,
        tasks: [
          {
            id: '1',
            resource: 'skill',
            key: 'automation_manager',
            depends_on: []
          }
        ]
      }
    });

    appLogger.info('[Pipeline] Automation clarification stored as slot filling state', {
      userId: input.user_id,
      appName: input.app_name,
      missing,
      collectedParamKeys: Object.keys(collectedParams)
    });

    return {
      ...result,
      intent: 'slot_filling',
      naturalResponse: automationClarificationService.buildQuestion(missing, collectedParams),
      metadata: {
        ...result.metadata,
        missingResourceParams: [
          {
            resource: 'skill',
            key: 'automation_manager',
            name: 'Automation Manager',
            missing,
            params
          }
        ],
        collectedParams,
        originalPlan: {
          mode: 'single_step',
          chat: false,
          tasks: [
            {
              id: '1',
              resource: 'skill',
              key: 'automation_manager',
              depends_on: []
            }
          ]
        }
      }
    };
  }

  private normalizeAutomationMissingParams(missing: string[]): string[] {
    const normalized = new Set<string>();
    for (const item of missing) {
      if (item === 'time' || item === 'date') {
        normalized.add('schedule');
      } else {
        normalized.add(item);
      }
    }
    return [...normalized];
  }

  private extractAutomationCollectedParams(job: any): Record<string, unknown> {
    const collected: Record<string, unknown> = {};
    if (!job || typeof job !== 'object') return collected;

    if (job.type) collected.automation_type = job.type;
    if (job.goal && !isGenericAutomationGoal(job.goal)) collected.goal = job.goal;
    if ((job.trigger?.runAt || job.trigger?.cron) && job.trigger?.sourceText) {
      collected.schedule = job.trigger.sourceText;
    }
    if (job.condition?.sourceText) {
      collected.condition = job.condition.sourceText;
    } else if (job.condition?.expression) {
      collected.condition = job.condition.expression;
    }
    if (job.notification?.target) collected.notification_target = job.notification.target;

    return collected;
  }

  private extractAutomationResult(apiResult: unknown): any | null {
    if (!apiResult || typeof apiResult !== 'object') return null;
    const record = apiResult as Record<string, any>;
    if (record.automation_manager) return record.automation_manager;
    if (record.kind && String(record.kind).startsWith('automation_')) return record;
    if (record.kind === 'confirmation_required') return record;
    for (const value of Object.values(record)) {
      const nested = this.extractAutomationResult(value);
      if (nested) return nested;
    }
    return null;
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
  ): Promise<PipelineResult | null> {
    const continuationStage = this.getContinuationStage();
    const result = await continuationStage.executeContinuationSkill(
      input,
      activeIntent,
      agent,
      continuationResult,
      startTotal
    );

    // ✅ FIX #1: Handle continuation fallback/error by re-routing to main pipeline
    if (result.intent === 'continuation_fallback' || result.intent === 'continuation_error') {
      appLogger.info('[PipelineService] Continuation returned fallback/error', {
        intent: result.intent,
        userId: input.user_id,
        appName: input.app_name
      });

      // Re-execute via main pipeline (this will update episodic memory, working memory, etc.)
      return null;
    }

    return result;
  }

  private buildClarifiedQuery(originalText: string, clarificationAnswer: string): string {
    const original = String(originalText || '').trim();
    const answer = String(clarificationAnswer || '').trim();

    if (!original) return answer;
    if (!answer) return original;

    return `${original}. Klarifikasi user: ${answer}`;
  }

  private withUserProfileContext(
    input: PipelineInput,
    userProfileContext: unknown
  ): PipelineInput {
    if (!userProfileContext) return input;
    return {
      ...input,
      attributes: {
        ...(input.attributes || {}),
        userProfileContext
      }
    };
  }

  private async executeAcceptedOffer(
    input: PipelineInput,
    agent: Agent,
    plan: any,
    params: Record<string, unknown>,
    offer: any,
    startTotal: number
  ): Promise<PipelineResult> {
    const executionResult = await this.getExecutionStage().execute(
      plan,
      input,
      params,
      {
        cacheResults: true,
        userId: input.user_id,
        appName: input.app_name
      }
    );

    const naturalResponse = await this.getNaturalizationStage().execute(
      executionResult.results,
      input,
      agent,
      {
        contextCache: {
          entities: params,
          originalQuery: input.text
        }
      }
    );

    await this.getWorkingMemoryUpdater().update(input.user_id, input.app_name, {
      type: 'plan',
      apiResults: executionResult.results,
      plan,
      params,
      activeIntent: `offer:${offer.type}`,
      activeTool: plan.tasks?.find((task: any) => task.resource === 'tool')?.key || null,
      activeSkill: plan.tasks?.find((task: any) => task.resource === 'skill')?.key || null
    });

    return {
      intent: `offer:${offer.type}`,
      score: offer.confidence || 1,
      apiResult: executionResult.results,
      naturalResponse,
      metadata: {
        durationMs: Date.now() - startTotal,
        executedTasks: executionResult.metrics.executedTasks,
        totalTasks: executionResult.metrics.totalTasks,
        executedTasksDetails: executionResult.metrics.executedTasksDetails || [],
        activePlan: plan,
        resolvedParams: params,
        acceptedOffer: offer
      }
    };
  }

  private async resolveActiveOfferIfAny(
    input: PipelineInput,
    agent: Agent,
    workingMemory: WorkingMemoryData | null,
    startTotal: number
  ): Promise<PipelineResult | null> {
    if (
      workingMemory?.activeOffer?.status === 'active' &&
      workingMemory.activeOffer.expiresAt <= Date.now()
    ) {
      await workingMemoryService.updateActiveOfferStatus(input.user_id, input.app_name, 'expired');
      appLogger.info('[Pipeline] Active offer expired, continuing normal pipeline', {
        userId: input.user_id,
        appName: input.app_name,
        offerType: workingMemory.activeOffer.type
      });
      return null;
    }

    const offerResolution = await this.getOfferResolver().resolve(input, workingMemory);
    if (!offerResolution.isOfferResponse) {
      if (workingMemory?.activeOffer?.status === 'active' && this.shouldClearIgnoredOffer(input.text)) {
        await workingMemoryService.updateActiveOfferStatus(input.user_id, input.app_name, 'cleared');
        appLogger.info('[Pipeline] Active offer ignored by new user intent, clearing offer', {
          userId: input.user_id,
          appName: input.app_name,
          offerType: workingMemory.activeOffer.type
        });
      }
      return null;
    }

    appLogger.info('[Pipeline] Active offer response detected', {
      userId: input.user_id,
      appName: input.app_name,
      accepted: offerResolution.accepted,
      offerType: offerResolution.offer?.type,
      offerStatus: offerResolution.offer?.status,
      shouldExecute: offerResolution.shouldExecute
    });

    if (offerResolution.accepted && offerResolution.shouldExecute && offerResolution.plan) {
      await workingMemoryService.updateActiveOfferStatus(input.user_id, input.app_name, 'accepted');
      return await this.executeAcceptedOffer(
        input,
        agent,
        offerResolution.plan,
        offerResolution.params || {},
        offerResolution.offer!,
        startTotal
      );
    } else {
      await workingMemoryService.updateActiveOfferStatus(input.user_id, input.app_name, 'rejected');
    }

    const naturalResponse = await this.getNaturalizationStage().execute(
      {
        active_offer: {
          status: 'rejected',
          message: offerResolution.message || 'Lanjutkan tanpa menjalankan penawaran sebelumnya.'
        }
      },
      input,
      agent,
      {
        contextCache: {
          originalQuery: input.text
        }
      }
    );

    return PipelineFormatter.buildEarly({
      intent: 'active_offer',
      score: 1,
      message: naturalResponse || offerResolution.message || 'Baik, saya lanjut tanpa menjalankan penawaran sebelumnya.'
    }, startTotal);
  }

  private shouldClearIgnoredOffer(text: string): boolean {
    const normalized = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;

    const shortOfferTokens = new Set([
      'ya', 'iya', 'iy', 'y', 'ok', 'oke', 'yes', 'boleh', 'lanjut',
      'tampilkan', 'lihat', 'show', 'tidak', 'no', 'batal', 'jangan'
    ]);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length <= 3 && tokens.some(token => shortOfferTokens.has(token))) {
      return false;
    }

    return true;
  }

  private buildCancelNoopMessage(input: PipelineInput): string {
    const recentCancelCount = (input.chat_history || [])
      .filter(item => item.role === 'user' && isCancellationText(item.content))
      .length;

    if (recentCancelCount >= 1) {
      return [
        'Masih tidak ada proses aktif yang perlu dibatalkan.',
        '',
        'Kita bisa lanjut dari awal. Silakan tulis kebutuhan baru, atau ketik `/automation manager` kalau ingin mengelola automation.'
      ].join('\n');
    }

    const variants = [
      'Tidak ada proses aktif yang perlu dibatalkan. Silakan tulis kebutuhan berikutnya.',
      'Saat ini tidak ada draft, pengisian data, atau konfirmasi yang sedang berjalan. Apa yang ingin Anda lakukan berikutnya?',
      'Belum ada proses yang sedang menunggu pembatalan. Anda bisa langsung menulis permintaan baru.'
    ];

    const index = Math.abs(this.hashText(`${input.user_id}:${input.app_name}:${input.text}`)) % variants.length;
    return variants[index];
  }

  private hashText(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(index);
      hash |= 0;
    }
    return hash;
  }
}

export const pipelineService = new PipelineService();
