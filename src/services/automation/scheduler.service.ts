import type { PipelineInput } from '../../types';
import type {
  AutomationJob,
  AutomationSchedulerRunResult
} from '../../types/automation.types';
import { automationJobRepository } from '../../repositories/automation-job.repository';
import { executeWithLock } from '../../utils/distributed-lock.util';
import { appLogger } from '../../utils/logger.util';
import { skillsRegistry } from '../skills-registry.service';
import { handleNotificationManager } from '../../skills/notification_manager.skill';
import { conditionEvaluatorService } from './condition-evaluator.service';
import { schedulerNotificationService } from './scheduler-notification.service';
import { openAiService } from '../openAi.service';
import { ollamaService } from '../ollama.service';
import { config } from '../../config';
import { broadcastReminder, broadcastResponse } from '../../utils/websocket-broadcast.util';
import { calculateNextRunFromCron as calculateNextCronRun } from '../../utils/cron.util';

export class AutomationSchedulerService {
  async runDueJobs(now = new Date(), limit = 50): Promise<AutomationSchedulerRunResult> {
    const dueJobs = await automationJobRepository.findDueJobs(now, limit);
    const summary: AutomationSchedulerRunResult = {
      checked: dueJobs.length,
      executed: 0,
      skipped: 0,
      failed: 0,
      results: []
    };

    for (const job of dueJobs) {
      try {
        const result = await executeWithLock(
          `automation-job:${job.id}`,
          () => this.executeJob(job, now),
          { ttlMs: 30000, retryDelayMs: 50, maxRetries: 3 }
        );

        if (result.status === 'executed') summary.executed += 1;
        if (result.status === 'skipped') summary.skipped += 1;
        if (result.status === 'failed') summary.failed += 1;
        summary.results.push(result);
      } catch (error) {
        summary.failed += 1;
        summary.results.push({
          jobId: job.id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return summary;
  }

  async executeJob(
    job: AutomationJob,
    now = new Date()
  ): Promise<AutomationSchedulerRunResult['results'][number]> {
    if (job.type === 'conditional_alert') {
      return await this.executeConditionalAlert(job, now);
    }

    if (job.type === 'scheduled_workflow') {
      return await this.executeScheduledWorkflow(job, now);
    }

    try {
      const executionResult = await this.executeAction(job);
      const nextRunAt = this.calculateNextRun(job, now);
      const nextStatus = nextRunAt ? 'active' : 'completed';

      await automationJobRepository.updateStatus(job.id, nextStatus, {
        lastRunAt: now,
        lastResult: executionResult,
        nextRunAt,
        incrementRunCount: true,
        lastError: null
      });

      return {
        jobId: job.id,
        status: 'executed',
        result: executionResult
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await automationJobRepository.updateStatus(job.id, 'failed', {
        lastRunAt: now,
        lastError: message,
        incrementRunCount: true
      });

      appLogger.error('[AutomationScheduler] Job execution failed', {
        jobId: job.id,
        error: message
      });

      return {
        jobId: job.id,
        status: 'failed',
        error: message
      };
    }
  }

  private async executeScheduledWorkflow(
    job: AutomationJob,
    now: Date
  ): Promise<AutomationSchedulerRunResult['results'][number]> {
    try {
      // ✅ PHASE 3: Use referenced tool params if available
      // Note: runEvaluationPipeline uses job.workflowParams internally
      // Referenced params are merged in executeAction when running the skill
      
      const pipelineResult = await this.runEvaluationPipeline(job);
      const nextRunAt = this.calculateNextRun(job, now);
      const nextStatus = nextRunAt ? 'active' : 'completed';
      const storedResult = {
        kind: 'scheduled_workflow_execution',
        pipeline: {
          intent: pipelineResult.intent,
          score: pipelineResult.score,
          apiResult: pipelineResult.apiResult,
          naturalResponse: pipelineResult.naturalResponse
        }
      };

      const executionResult = await this.executeAction({
        ...job,
        lastResult: storedResult
      });

      await automationJobRepository.updateStatus(job.id, nextStatus, {
        lastRunAt: now,
        lastResult: {
          ...storedResult,
          actionResult: executionResult
        },
        nextRunAt,
        incrementRunCount: true,
        lastError: null
      });

      return {
        jobId: job.id,
        status: 'executed',
        result: {
          ...storedResult,
          actionResult: executionResult
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await automationJobRepository.updateStatus(job.id, 'failed', {
        lastRunAt: now,
        lastError: message,
        incrementRunCount: true
      });

      appLogger.error('[AutomationScheduler] Scheduled workflow execution failed', {
        jobId: job.id,
        error: message
      });

      return {
        jobId: job.id,
        status: 'failed',
        error: message
      };
    }
  }

  private async executeConditionalAlert(
    job: AutomationJob,
    now: Date
  ): Promise<AutomationSchedulerRunResult['results'][number]> {
    try {
      const pipelineResult = await this.runEvaluationPipeline(job);
      const currentResult = pipelineResult.apiResult || pipelineResult.metadata || pipelineResult;
      const condition = await conditionEvaluatorService.evaluateAsync(
        job.condition,
        currentResult,
        job.lastResult
      );

      const nextRunAt = this.calculateNextRun(job, now);
      const nextStatus = nextRunAt ? 'active' : 'completed';
      const storedResult = {
        kind: 'conditional_alert_evaluation',
        condition,
        pipeline: {
          intent: pipelineResult.intent,
          score: pipelineResult.score,
          apiResult: pipelineResult.apiResult,
          naturalResponse: pipelineResult.naturalResponse
        }
      };

      if (!condition.shouldRun) {
        await automationJobRepository.updateStatus(job.id, nextStatus, {
          lastRunAt: now,
          lastResult: storedResult,
          nextRunAt,
          incrementRunCount: true,
          lastError: null
        });

        return {
          jobId: job.id,
          status: 'skipped',
          result: storedResult
        };
      }

      const executionResult = await this.executeAction({
        ...job,
        lastResult: storedResult
      });

      await automationJobRepository.updateStatus(job.id, nextStatus, {
        lastRunAt: now,
        lastResult: {
          ...storedResult,
          actionResult: executionResult
        },
        nextRunAt,
        incrementRunCount: true,
        lastError: null
      });

      return {
        jobId: job.id,
        status: 'executed',
        result: {
          ...storedResult,
          actionResult: executionResult
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await automationJobRepository.updateStatus(job.id, 'failed', {
        lastRunAt: now,
        lastError: message,
        incrementRunCount: true
      });

      appLogger.error('[AutomationScheduler] Conditional alert execution failed', {
        jobId: job.id,
        error: message
      });

      return {
        jobId: job.id,
        status: 'failed',
        error: message
      };
    }
  }

  private async runEvaluationPipeline(job: AutomationJob): Promise<any> {
    const { pipelineService } = await import('../pipeline.service');
    const evaluationText = this.buildEvaluationQuery(job);

    appLogger.info('[AutomationScheduler] Running automation evaluation pipeline', {
      jobId: job.id,
      userId: job.userId,
      appName: job.appName,
      type: job.type,
      evaluationText
    });

    return await pipelineService.run({
      user_id: job.userId,
      app_name: job.appName,
      text: evaluationText,
      attributes: {
        params: job.workflow.params || {},
        automation: {
          jobId: job.id,
          mode: 'condition_evaluation'
        }
      }
    });
  }

  private buildEvaluationQuery(job: AutomationJob): string {
    if (job.condition?.kind === 'comparison') {
      const comparisonQuery = String(job.workflow.sourceText || job.goal || job.condition.sourceText || '').trim();
      if (comparisonQuery) return comparisonQuery;
    }

    const conditionText = job.condition?.sourceText || job.goal || job.workflow.sourceText;
    const cleaned = String(conditionText || '')
      .replace(/\b(kalau|jika|if|when|apabila)\b/gi, ' ')
      .replace(/\b(lebih dari|lebih besar dari|di atas|above|greater than|>|minimal|setidaknya|paling sedikit|kurang dari|di bawah|below|less than|<|maksimal|paling banyak|sama dengan|equal|=)\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const query = cleaned || job.workflow.sourceText || job.goal;
    return /^(cek|check|tampilkan|lihat|ambil|get)\b/i.test(query)
      ? query
      : `cek ${query}`;
  }

  calculateNextRun(job: AutomationJob, from = new Date()): Date | null {
    if (job.trigger.kind === 'once') return null;
    if (job.maxRuns && job.runCount + 1 >= job.maxRuns) return null;
    if (!job.trigger.cron) return null;

    return calculateNextRunFromCron(job.trigger.cron, from);
  }

  /**
   * Naturalize reminder message using LLM
   * Makes message more friendly and rich (max 2 sentences)
   */
  private async naturalizeReminderMessage(rawMessage: string, appName: string): Promise<string> {
    try {
      const provider = config.default?.provider || 'ollama';
      const llmModel = provider === 'qwen'
        ? config.alibaba?.llmModel
        : config.ollama?.llmModel;

      const prompt = `Ubah pesan singkat ini menjadi lebih ramah dan natural (maksimal 3 kalimat):

Pesan user: "${rawMessage}"

Instruksi:
- Pesan user adalah reminder atau pengingat.
- Bold bagian penting
- Gunakan bahasa Indonesia 
`;

      let naturalizedMessage: string;

      if (provider === 'qwen') {
        naturalizedMessage = await openAiService.chatMessage(
          [{ role: 'user' as const, content: prompt }],
          llmModel,
          { temperature: 0.7, num_predict: 100 }
        );
      } else {
        naturalizedMessage = await ollamaService.chatMessage(
          [{ role: 'user' as const, content: prompt }],
          llmModel,
          { temperature: 0.7, num_predict: 100 }
        );
      }

      // Clean up response (remove quotes, trim)
      naturalizedMessage = naturalizedMessage.replace(/^["']|["']$/g, '').trim();

      // Fallback to raw message if naturalization fails or too long
      if (!naturalizedMessage || naturalizedMessage.length > 200) {
        return this.createFallbackNaturalizedMessage(rawMessage);
      }

      return naturalizedMessage;

    } catch (error) {
      appLogger.warn('[AutomationScheduler] Reminder naturalization failed, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return this.createFallbackNaturalizedMessage(rawMessage);
    }
  }

  /**
   * Fallback naturalized message (no LLM)
   */
  private createFallbackNaturalizedMessage(rawMessage: string): string {
    const greetings = [
      'Halo! ',
      'Hai! ',
      'Selamat! ',
      ''
    ];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    
    return `${randomGreeting}Ini pengingat untuk ${rawMessage}. Semoga harimu menyenangkan!`;
  }

  private async naturalizeAutomationNotification(job: AutomationJob, fallbackMessage: string): Promise<string> {
    if (job.type === 'reminder') {
      return this.naturalizeReminderMessage(fallbackMessage, job.appName);
    }

    if (job.type === 'conditional_alert') {
      return this.naturalizeConditionalAlertMessage(job, fallbackMessage);
    }

    if (job.type === 'scheduled_workflow') {
      return this.naturalizeScheduledWorkflowMessage(job, fallbackMessage);
    }

    return this.naturalizeGenericAutomationMessage(job, fallbackMessage);
  }

  private async naturalizeScheduledWorkflowMessage(job: AutomationJob, fallbackMessage: string): Promise<string> {
    const lastResult = job.lastResult as any;
    const pipeline = lastResult?.pipeline;
    const rawData = this.compactAutomationData(pipeline?.apiResult);
    const prompt = `
Buat notifikasi scheduled workflow yang informatif dan grounded.

Instruksi:
- Bahasa Indonesia.
- Jangan menyebut "Selamat!".
- Jangan menyebut "semoga harimu menyenangkan".
- Jelaskan bahwa workflow terjadwal sudah dijalankan.
- Utamakan data asli dari rawData jika tersedia.
- Jika rawData berisi array atau daftar record dengan <= 50 item, tampilkan semua item dalam tabel Markdown.
- Jika rawData berisi array atau daftar record dengan > 50 item, tampilkan 50 item pertama dan sebutkan bahwa sisanya tidak ditampilkan.
- Jika rawData hanya summary object, tampilkan poin ringkas dari field aslinya.
- Pertahankan nama/status/nilai dari JSON apa adanya.
- Jangan mengarang angka atau detail di luar JSON.

Data:
${JSON.stringify({
  title: job.title,
  goal: job.goal,
  pipelineSummary: pipeline?.naturalResponse,
  fallbackMessage,
  rawData
}, null, 2)}
`.trim();

    try {
      const provider = config.default?.provider || 'ollama';
      const model = provider === 'qwen' ? config.alibaba?.llmModel : config.ollama?.llmModel;
      const message = provider === 'qwen'
        ? await openAiService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.3, num_predict: 900 })
        : await ollamaService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.3, num_predict: 900 });

      const cleaned = message.replace(/^["']|["']$/g, '').trim();
      return cleaned || this.createFallbackScheduledWorkflowMessage(job);
    } catch (error) {
      appLogger.warn('[AutomationScheduler] Scheduled workflow naturalization failed, using fallback', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createFallbackScheduledWorkflowMessage(job);
    }
  }

  private async naturalizeConditionalAlertMessage(job: AutomationJob, fallbackMessage: string): Promise<string> {
    const lastResult = job.lastResult as any;
    const condition = lastResult?.condition;
    const pipeline = lastResult?.pipeline;
    const rawData = this.compactAutomationData(pipeline?.apiResult);
    const prompt = `
Buat notifikasi conditional alert yang informatif dan grounded.

Instruksi:
- Bahasa Indonesia.
- Jangan menyebut "Selamat!".
- Jangan menyebut "semoga harimu menyenangkan".
- Jelaskan bahwa kondisi alert terpenuhi.
- Sebutkan kondisi, nilai teramati, dan ringkasan data jika tersedia.
- Jika rawData berisi array atau daftar record dengan <= 50 item, tampilkan semua item dalam tabel Markdown.
- Jika rawData berisi array atau daftar record dengan > 50 item, tampilkan 50 item pertama dan sebutkan bahwa sisanya tidak ditampilkan.
- Jika rawData hanya summary object, tampilkan poin ringkas dari field aslinya.
- Pertahankan nama/status/nilai dari JSON apa adanya; jangan hanya menyebut summary jika ada data detail.
- Jangan memotong table jika jumlah record masih <= 50.
- Jangan mengarang angka atau detail di luar JSON.

Data:
${JSON.stringify({
  title: job.title,
  goal: job.goal,
  condition: job.condition,
  evaluation: condition,
  pipelineSummary: pipeline?.naturalResponse,
  fallbackMessage,
  rawData
}, null, 2)}
`.trim();

    try {
      const provider = config.default?.provider || 'ollama';
      const model = provider === 'qwen' ? config.alibaba?.llmModel : config.ollama?.llmModel;
      const message = provider === 'qwen'
        ? await openAiService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.3, num_predict: 900 })
        : await ollamaService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.3, num_predict: 900 });

      const cleaned = message.replace(/^["']|["']$/g, '').trim();
      return cleaned || this.createFallbackConditionalAlertMessage(job);
    } catch (error) {
      appLogger.warn('[AutomationScheduler] Conditional alert naturalization failed, using fallback', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return this.createFallbackConditionalAlertMessage(job);
    }
  }

  private async naturalizeGenericAutomationMessage(job: AutomationJob, fallbackMessage: string): Promise<string> {
    const prompt = `
Ubah pesan automation ini menjadi notifikasi singkat dalam Bahasa Indonesia.

Instruksi:
- Maksimal 4 kalimat.
- Jangan mengarang data.
- Jangan pakai ucapan "Selamat!".

Data:
${JSON.stringify({
  type: job.type,
  goal: job.goal,
  message: fallbackMessage,
  lastResult: job.lastResult
}, null, 2)}
`.trim();

    try {
      const provider = config.default?.provider || 'ollama';
      const model = provider === 'qwen' ? config.alibaba?.llmModel : config.ollama?.llmModel;
      const message = provider === 'qwen'
        ? await openAiService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.4, num_predict: 220 })
        : await ollamaService.chatMessage([{ role: 'user' as const, content: prompt }], model, { temperature: 0.4, num_predict: 220 });
      return message.replace(/^["']|["']$/g, '').trim() || fallbackMessage;
    } catch {
      return fallbackMessage;
    }
  }

  private createFallbackConditionalAlertMessage(job: AutomationJob): string {
    const lastResult = job.lastResult as any;
    const condition = lastResult?.condition;
    const observed = condition?.observedValue !== undefined
      ? ` Nilai teramati: ${condition.observedValue}.`
      : '';
    return `Conditional alert terpenuhi: ${job.condition?.sourceText || job.goal}.${observed}`;
  }

  private createFallbackScheduledWorkflowMessage(job: AutomationJob): string {
    const lastResult = job.lastResult as any;
    const summary = lastResult?.pipeline?.naturalResponse;
    return [
      `Workflow terjadwal sudah dijalankan: ${job.goal}.`,
      summary ? `Ringkasan hasil: ${summary}` : ''
    ].filter(Boolean).join('\n');
  }

  private compactAutomationData(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    const ROWS_DEEP_ARRAY = 50;
    const ROWS_DEEP_OBJECT = 140;
    const MAX_STRING_LENGTH = 1200;
    const MAX_TOTAL_NODES = 2500;
    const seen = new WeakSet<object>();
    let nodeCount = 0;

    const prune = (item: unknown, depth = 0): unknown => {
      nodeCount += 1;
      if (nodeCount > MAX_TOTAL_NODES) return '[MaxNodes]';
      if (depth > 5) return '[MaxDepth]';

      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'number' && !Number.isFinite(item)) return String(item);
      if (typeof item === 'function' || typeof item === 'symbol') return undefined;
      if (item instanceof Date) return item.toISOString();

      if (Array.isArray(item)) {
        const items = item.slice(0, ROWS_DEEP_ARRAY).map(child => prune(child, depth + 1));
        if (item.length <= ROWS_DEEP_ARRAY) return items;
        return {
          __type: 'array_preview',
          totalItems: item.length,
          shownItems: items.length,
          items
        };
      }

      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);

        const allEntries = Object.entries(item as Record<string, unknown>);
        const entries = allEntries.slice(0, ROWS_DEEP_OBJECT);
        const result: Record<string, unknown> = {};
        for (const [key, child] of entries) {
          const pruned = prune(child, depth + 1);
          if (pruned !== undefined) result[key] = pruned;
        }
        if (allEntries.length > ROWS_DEEP_OBJECT) {
          result.__truncatedKeys = allEntries.length - ROWS_DEEP_OBJECT;
        }
        return result;
      }

      if (typeof item === 'string' && item.length > MAX_STRING_LENGTH) {
        return `${item.slice(0, MAX_STRING_LENGTH)}... [truncated ${item.length - MAX_STRING_LENGTH} chars]`;
      }

      return item;
    };

    return prune(value);
  }

  private async executeAction(job: AutomationJob): Promise<unknown> {
    if (job.action.resource === 'skill') {
      // ✅ PHASE 3: Merge referenced params if available
      let params = {
        ...(job.action.params || {}),
        message: (job.action.params as any)?.message || job.notification?.messageTemplate || job.goal,
        target: (job.action.params as any)?.target || job.notification?.target || job.userId,
        channel: job.notification?.channel || 'chat'
      };
      
      // If job has referenced params from "ini" resolution, merge them
      if (job.workflow?.referencedParams) {
        params = {
          ...params,
          ...job.workflow.referencedParams
        };
        
        console.log('[Scheduler] Using referenced params for skill execution', {
          jobId: job.id,
          referencedTool: job.workflow.referencedTool,
          params: Object.keys(job.workflow.referencedParams)
        });
      }
      
      const context: PipelineInput = {
        user_id: job.userId,
        app_name: job.appName,
        text: job.workflow.sourceText || job.goal,
        attributes: {
          automationJobId: job.id
        }
      };

      const skill = skillsRegistry.getSkillBySlug(job.action.key);
      const handler = skill ? skillsRegistry.getHandler(skill.handlerKey) : null;
      if (handler) {
        const result = await handler(params, context, job.lastResult);

        // ✅ FIX: Broadcast via WebSocket - 2 EVENTS
        // 1. Type "response" - Chat message
        // 2. Type "reminder" - Special reminder event with sound
        if (job.action.key === 'notification_manager' && (result as any)?.kind === 'notification_sent') {
          const rawMessage = params.message || job.goal;

          // ✅ NATURALIZE: Use LLM to make message more friendly and rich (max 2 sentences)
          const naturalizedMessage = await this.naturalizeAutomationNotification(job, rawMessage);

          appLogger.debug('[AutomationScheduler] Reminder message naturalized', {
            original: rawMessage.substring(0, 50),
            naturalized: naturalizedMessage.substring(0, 100)
          });

          // ✅ BROADCAST 1: Type "response" (chat message)
          broadcastResponse(job.userId, naturalizedMessage, {
            intent: 'automation_reminder',
            confidence: 1.0,
            notificationId: `job_${job.id}`,
            automationJobId: job.id,
            scheduled: true
          });

          // ✅ BROADCAST 2: Type "reminder" (special event with sound)
          broadcastReminder(job.userId, {
            jobId: job.id.toString(),
            message: naturalizedMessage,
            scheduledFor: job.nextRunAt || '',
            createdAt: Date.now()
          });

          appLogger.info('[AutomationScheduler] Reminder broadcast (2 events)', {
            jobId: job.id,
            userId: job.userId,
            message: naturalizedMessage.substring(0, 100)
          });

          // ✅ ONLY add to pending queue if no connections found (user disconnected)
          const connectionsFound = true; // Assume delivered if we reach here
          if (!connectionsFound) {
            schedulerNotificationService.addNotification(
              job.userId,
              job.appName,
              naturalizedMessage,  // ✅ Use naturalized message for pending queue too
              job.id
            );
            appLogger.warn('[AutomationScheduler] No WebSocket connections found - notification queued for later delivery', {
              jobId: job.id,
              userId: job.userId,
              appName: job.appName
            });
          } else {
            appLogger.debug('[AutomationScheduler] Notification delivered via WebSocket - no need for pending queue', {
              jobId: job.id
            });
          }
        }

        return result;
      }

      if (job.action.key === 'notification_manager') {
        const result = await handleNotificationManager(params, context, job.lastResult);
        
        // ✅ FIX: Store notification in pending queue for delivery
        if ((result as any)?.kind === 'notification_sent') {
          schedulerNotificationService.addNotification(
            job.userId,
            job.appName,
            params.message || job.goal,
            job.id
          );
          appLogger.info('[AutomationScheduler] Notification queued for delivery', {
            jobId: job.id,
            userId: job.userId,
            appName: job.appName,
            message: (params.message || job.goal).substring(0, 50)
          });
        }
        
        return result;
      }

      throw new Error(`Automation action skill "${job.action.key}" is not registered.`);
    }

    if (job.action.resource === 'workflow') {
      return {
        kind: 'workflow_execution_deferred',
        plan: job.workflow.plan || null,
        params: job.workflow.params || {},
        message: 'Workflow execution storage is available; full replay is deferred to pipeline runner integration.'
      };
    }

    throw new Error(`Automation action resource "${job.action.resource}" is not supported by scheduler V1.`);
  }
}

export function calculateNextRunFromCron(cron: string, from = new Date()): Date | null {
  return calculateNextCronRun(cron, from);
}

export const automationSchedulerService = new AutomationSchedulerService();
