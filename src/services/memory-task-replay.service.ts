// ============================================================
// Memory Task Replay Service
// ============================================================
// Orchestrates the recall → select → execute flow for
// memory_task_replay perception frames.
//
// Flow:
//   PerceptionFrame (type=memory_task_replay)
//     ↓
//   recall from episodic memory
//     ↓
//   select rerunnable tasks (has taskPlan, not memory_replay)
//     ↓
//   if exactly 1 safe → return single replay target
//   if more than 1 → return clarification candidates
//   if none → return grounded empty
// ============================================================

import { memoryRecallService } from './memory-recall.service';
import { episodicMemoryRepository } from '../repositories/episodic-memory.repository';
import { toolRepository } from '../repositories/tool.repository';
import { skillsRegistry } from './skills-registry.service';
import { appLogger } from '../utils/logger.util';
import type { PerceptionFrame } from '../types/perception.types';
import type { PipelineInput, PipelineResult } from '../types';
import type { MemoryRecallResult, MemoryRecallItem } from '../types/memory-recall.types';
import type { PlannerOutput, PlannerTask } from '../types/planner.types';

// ============================================================
// Types
// ============================================================

export type ReplayDecision =
  | 'auto_execute'
  | 'clarify_multiple'
  | 'no_rerunnable';

export interface RerunnableTask {
  memoryItem: MemoryRecallItem;
  taskPlan: NonNullable<MemoryRecallItem['taskPlan']>;
  /** Whether the tool/skill referenced in the taskPlan still exists */
  toolStillExists: boolean;
  /** Safety: side effect level */
  sideEffectLevel: 'none' | 'write' | 'external';
}

export interface ReplaySingleResult {
  decision: 'auto_execute';
  task: RerunnableTask;
  reasoning: string;
}

export interface ReplayClarifyResult {
  decision: 'clarify_multiple';
  candidates: RerunnableTask[];
  reasoning: string;
}

export interface ReplayNoneResult {
  decision: 'no_rerunnable';
  recallResult: MemoryRecallResult;
  reasoning: string;
}

export type MemoryTaskReplayResult =
  | ReplaySingleResult
  | ReplayClarifyResult
  | ReplayNoneResult;

export interface MemoryTaskReplayInput {
  frame: PerceptionFrame;
  input: PipelineInput;
}

// ============================================================
// Service
// ============================================================

class MemoryTaskReplayService {
  /**
   * Main entry point: recall + select rerunnable task
   *
   * @param input - Frame with temporal scope and user input context
   * @returns Structured replay decision
   */
  async recallAndSelect(input: MemoryTaskReplayInput): Promise<MemoryTaskReplayResult> {
    const { frame, input: pipelineInput } = input;

    appLogger.info('[MemoryTaskReplay] Starting recall + select', {
      userId: pipelineInput.user_id,
      appName: pipelineInput.app_name,
      temporalScope: frame.temporalScope,
      confidence: frame.confidence
    });

    // Step 1: Execute memory recall
    const recallResult = await this.executeRecall(frame, pipelineInput);

    if (recallResult.isEmpty || recallResult.items.length === 0) {
      appLogger.info('[MemoryTaskReplay] No memory items recalled');
      return {
        decision: 'no_rerunnable',
        recallResult,
        reasoning: 'Tidak ada riwayat percakapan yang ditemukan untuk jangka waktu tersebut.'
      };
    }

    // Step 2: Filter to rerunnable tasks
    const rerunnable = await this.selectRerunnableTasks(recallResult.items);

    if (rerunnable.length === 0) {
      appLogger.info('[MemoryTaskReplay] No rerunnable tasks found', {
        totalItems: recallResult.items.length
      });
      return {
        decision: 'no_rerunnable',
        recallResult,
        reasoning: this.buildNoRerunnableReasoning(recallResult.items)
      };
    }

    // Step 3: Decision
    if (rerunnable.length === 1) {
      const task = rerunnable[0];
      const willAutoExecute = this.isSafeToAutoExecute(task);

      if (willAutoExecute) {
        appLogger.info('[MemoryTaskReplay] Single rerunnable task → auto_execute', {
          topicKey: task.memoryItem.topicKey,
          intent: task.memoryItem.intent
        });
        return {
          decision: 'auto_execute',
          task,
          reasoning: `Menemukan 1 tugas yang bisa dijalankan ulang: "${task.memoryItem.topicLabel || task.memoryItem.summary}".`
        };
      } else {
        // Single task but unsafe → treat as no_rerunnable with explanation
        return {
          decision: 'no_rerunnable',
          recallResult,
          reasoning: `Tugas ditemukan tetapi memerlukan konfirmasi karena memiliki efek samping (${task.sideEffectLevel}).`
        };
      }
    }

    // Multiple candidates → clarify
    appLogger.info('[MemoryTaskReplay] Multiple rerunnable tasks → clarify', {
      candidateCount: rerunnable.length
    });
    return {
      decision: 'clarify_multiple',
      candidates: rerunnable,
      reasoning: `Ditemukan ${rerunnable.length} tugas yang bisa dijalankan ulang. Pilih salah satu.`
    };
  }

  // ============================================================
  // Recall
  // ============================================================

  private async executeRecall(
    frame: PerceptionFrame,
    pipelineInput: PipelineInput
  ): Promise<MemoryRecallResult> {
    const temporalScope = frame.temporalScope;

    // Build recall params from frame temporal scope
    const params: Record<string, unknown> = {
      recall_mode: 'recent',
      limit: 5
    };

    if (temporalScope?.relativeOffsetDays) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - temporalScope.relativeOffsetDays);
      const dateStr = targetDate.toISOString().split('T')[0];
      params.recall_mode = 'date';
      params.date = dateStr;
    } else if (temporalScope?.startDate && temporalScope?.endDate) {
      params.recall_mode = 'range';
      params.start_date = temporalScope.startDate;
      params.end_date = temporalScope.endDate;
    }

    return memoryRecallService.recall({
      userId: pipelineInput.user_id,
      appName: pipelineInput.app_name,
      query: pipelineInput.text,
      params,
      timezone: pipelineInput.attributes?.timezone as string | undefined
    });
  }

  // ============================================================
  // Rerunnable Task Selection
  // ============================================================

  private async selectRerunnableTasks(items: MemoryRecallItem[]): Promise<RerunnableTask[]> {
    const candidates = items.filter(item => {
        // Must have a taskPlan to be rerunnable
        if (!item.taskPlan || !item.taskPlan.tasks || item.taskPlan.tasks.length === 0) {
          return false;
        }

        // Skip memory_replay entries (prevent replay loop — BUG-003)
        if (item.flowStage === 'memory_replay') {
          appLogger.debug('[MemoryTaskReplay] Skipping memory_replay entry to prevent loop', {
            topicKey: item.topicKey
          });
          return false;
        }

        return true;
      });

    const result: RerunnableTask[] = [];
    for (const item of candidates) {
      result.push({
        memoryItem: item,
        taskPlan: item.taskPlan!,
        toolStillExists: await this.verifyToolsExist(item.taskPlan!.tasks),
        sideEffectLevel: await this.assessSideEffectLevel(item.taskPlan!)
      });
    }

    return result;
  }

  /**
   * Verify that all tools/skills referenced in the task plan still exist.
   * Stale tool detection — prevents replay of deleted tools.
   */
  private async verifyToolsExist(tasks: PlannerTask[]): Promise<boolean> {
    const toolSlugs = tasks
      .filter(task => task.resource === 'tool')
      .map(task => task.key);

    if (toolSlugs.length > 0) {
      const tools = await toolRepository.findBySlugs(toolSlugs);
      const available = new Set(tools.map(tool => tool.slug));
      const missing = toolSlugs.filter(slug => !available.has(slug));
      if (missing.length > 0) {
        appLogger.warn('[MemoryTaskReplay] Tool no longer exists or is inactive', {
          missingTools: missing
        });
        return false;
      }
    }

    for (const task of tasks) {
      if (task.resource === 'skill') {
        const skill = skillsRegistry.getSkillBySlug(task.key);
        if (!skill) {
          appLogger.warn('[MemoryTaskReplay] Skill no longer exists', {
            skillKey: task.key
          });
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Assess side effect level of a task plan for safety decisions.
   */
  private async assessSideEffectLevel(taskPlan: NonNullable<MemoryRecallItem['taskPlan']>): Promise<'none' | 'write' | 'external'> {
    if (!taskPlan || !taskPlan.tasks) return 'none';

    const hasExternalSkill = taskPlan.tasks.some(t => {
      if (t.resource !== 'skill') return false;
      const skill = skillsRegistry.getSkillBySlug(t.key);
      // External skills: automation category or context includes 'future_task'
      return skill?.category === 'automation' ||
             skill?.capabilities?.context?.includes('future_task') ||
             false;
    });

    if (hasExternalSkill) return 'external';

    const toolSlugs = taskPlan.tasks
      .filter(task => task.resource === 'tool')
      .map(task => task.key);

    if (toolSlugs.length > 0) {
      const tools = await toolRepository.findBySlugs(toolSlugs);
      const hasWriteTool = tools.some(tool => tool.method !== 'GET');
      if (hasWriteTool) return 'write';
    }

    return 'none';
  }

  /**
   * Determine if a task is safe to auto-execute without confirmation.
   */
  private isSafeToAutoExecute(task: RerunnableTask): boolean {
    // Must have existing tool
    if (!task.toolStillExists) return false;

    // Must have safe side effect level
    if (task.sideEffectLevel === 'external') return false;
    if (task.sideEffectLevel === 'write') return false;

    // Must have at least one task
    if (!task.taskPlan.tasks || task.taskPlan.tasks.length === 0) return false;

    return true;
  }

  /**
   * Build reasoning for when no rerunnable tasks are found.
   */
  private buildNoRerunnableReasoning(items: MemoryRecallItem[]): string {
    const taskPlanCount = items.filter(i => i.taskPlan?.tasks?.length).length;
    const replayCount = items.filter(i => i.flowStage === 'memory_replay').length;
    const parts: string[] = [];

    if (items.length === 0) {
      return 'Tidak ada riwayat yang ditemukan.';
    }

    parts.push(`Ditemukan ${items.length} riwayat percakapan`);

    if (taskPlanCount === 0) {
      parts.push('tetapi tidak ada yang memiliki rencana tugas (taskPlan) yang bisa dijalankan ulang.');
    } else if (replayCount > 0 && taskPlanCount === replayCount) {
      parts.push('tetapi semuanya adalah hasil replay sebelumnya (hindari pengulangan berulang).');
    } else {
      parts.push('tetapi tidak ada yang bisa dijalankan ulang secara otomatis.');
    }

    return parts.join(', ');
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const memoryTaskReplayService = new MemoryTaskReplayService();
