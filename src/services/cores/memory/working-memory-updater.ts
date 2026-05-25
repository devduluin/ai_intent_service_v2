import { workingMemoryService, type WorkingMemoryData } from '../../workingMemory.service';
import type { PlannerOutput } from '../../../types/planner.types';
import type { ContinuationIntent } from '../../continuationResolver.service';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface WorkingMemoryPlanContext {
  type: 'plan';
  apiResults: Record<string, unknown>;
  params?: Record<string, unknown>;
  plan?: PlannerOutput;
  activeIntent?: string | null;
}

export interface WorkingMemoryContinuationContext {
  type: 'continuation';
  apiResults?: Record<string, unknown>;
  intent: ContinuationIntent;
  activeIntent?: string | null;
}

export interface WorkingMemoryChatContext {
  type: 'chat';
  chatResponse: string;
  activeIntent?: string | null;
}

export interface WorkingMemoryAccessContext {
  type: 'access';
}

export type WorkingMemoryUpdateContext =
  | WorkingMemoryPlanContext
  | WorkingMemoryContinuationContext
  | WorkingMemoryChatContext
  | WorkingMemoryAccessContext;

// ============================================================
// Working Memory Updater
// ============================================================

/**
 * WorkingMemoryUpdater - Handles all working memory update logic
 * 
 * Responsibilities:
 * - Infer workflow from tool slugs
 * - Extract entities from params
 * - Infer continuation hints from API results
 * - Update working memory for different contexts (plan, continuation, chat, access)
 */
export class WorkingMemoryUpdater {
  /**
   * Update working memory based on context type
   */
  async update(
    userId: string,
    appName: string,
    context: WorkingMemoryUpdateContext
  ): Promise<void> {
    try {
      const existing = await workingMemoryService.get(userId, appName);
      const updates = await this.buildUpdates(existing, context);

      if (Object.keys(updates).length > 0) {
        await workingMemoryService.update(userId, appName, updates);
      }
    } catch (error) {
      appLogger.error('[WorkingMemoryUpdater] Failed to update', {
        userId,
        appName,
        contextType: context.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - WM update failure should not break the pipeline
    }
  }

  /**
   * Build updates object based on context
   */
  private async buildUpdates(
    existing: WorkingMemoryData | null,
    context: WorkingMemoryUpdateContext
  ): Promise<Partial<WorkingMemoryData>> {
    switch (context.type) {
      case 'plan':
        return this.buildPlanUpdates(existing, context);
      case 'continuation':
        return this.buildContinuationUpdates(existing, context);
      case 'chat':
        return this.buildChatUpdates(existing, context);
      case 'access':
        return this.buildAccessUpdates(existing);
      default:
        return {};
    }
  }

  // ============================================================
  // Plan Execution Updates
  // ============================================================

  private async buildPlanUpdates(
    existing: WorkingMemoryData | null,
    context: WorkingMemoryPlanContext
  ): Promise<Partial<WorkingMemoryData>> {
    const toolSlugs = context.plan?.tasks
      ? context.plan.tasks.filter(t => t.resource === 'tool').map(t => t.key)
      : Object.keys(context.apiResults);

    const activeWorkflow = this.inferWorkflowFromTools(toolSlugs);
    const activeTool = toolSlugs[0];
    const activeEntities = this.extractEntitiesFromParams(context.params || {});
    const continuationHints = this.inferContinuationHints(context.apiResults);

    appLogger.info('[WorkingMemoryUpdater] Updated from plan execution', {
      activeWorkflow,
      activeTool,
      entitiesCount: Object.keys(activeEntities).length
    });

    return {
      ...(context.activeIntent ? { activeIntent: context.activeIntent } : {}),
      ...(activeWorkflow ? { activeWorkflow } : {}),
      ...(activeTool ? { activeTool } : {}),
      activeEntities: {
        ...existing?.activeEntities,
        ...activeEntities
      },
      continuationHints,
      metadata: {
        ...existing?.metadata,
        lastAccessedAt: Date.now(),
        accessCount: (existing?.metadata?.accessCount || 0) + 1,
        lastExecution: {
          timestamp: Date.now(),
          results: context.apiResults,
          type: 'full_pipeline',
          planMode: context.plan?.mode || 'single_step'
        }
      }
    };
  }

  // ============================================================
  // Continuation Updates
  // ============================================================

  private async buildContinuationUpdates(
    existing: WorkingMemoryData | null,
    context: WorkingMemoryContinuationContext
  ): Promise<Partial<WorkingMemoryData>> {
    const mergedEntities = existing?.activeEntities || {};
    if (context.intent.extractedParams && Object.keys(context.intent.extractedParams).length > 0) {
      Object.assign(mergedEntities, context.intent.extractedParams);
    }

    // C-009 FIX: Determine if targetHandler is actually a handler or tool
    // Handlers: xls_generator, pdf_generator, data_analyzer (executionType: 'handler')
    // Tools: get_time, get_weather (executionType: 'tool')
    const targetHandler = context.intent.targetHandler;
    const isHandler = targetHandler && (
      targetHandler.includes('_generator') || 
      targetHandler.includes('_analyzer') ||
      targetHandler === 'xls_generator' ||
      targetHandler === 'pdf_generator' ||
      targetHandler === 'data_analyzer'
    );

    // Set activeTool only for actual tools, not handlers
    const activeTool = isHandler ? undefined : (targetHandler || existing?.activeTool);
    const activeHandler = isHandler ? targetHandler : undefined;
    const finalActiveIntent = context.activeIntent || existing?.activeIntent || `continuation:${context.intent.type}`;

    appLogger.info('[WorkingMemoryUpdater] Updated from continuation', {
      continuationType: context.intent.type,
      targetHandler,
      isHandler,
      activeTool: activeTool || 'none',
      activeHandler: activeHandler || 'none'
    });

    return {
      activeEntities: mergedEntities,
      ...(activeTool ? { activeTool } : {}),
      ...(activeHandler ? { activeHandler } : {}),
      ...(finalActiveIntent ? { activeIntent: finalActiveIntent } : {}),
      continuationHints: context.intent.type === 'export'
        ? { ...existing?.continuationHints, canExport: false, canSummarize: true }
        : existing?.continuationHints,
      metadata: {
        ...existing?.metadata,
        lastAccessedAt: Date.now(),
        accessCount: (existing?.metadata?.accessCount || 0) + 1,
        lastExecution: {
          timestamp: Date.now(),
          results: context.apiResults || {},
          type: 'continuation',
          continuationType: context.intent.type,
          targetHandler
        }
      }
    };
  }

  // ============================================================
  // Chat Updates
  // ============================================================

  private async buildChatUpdates(
    existing: WorkingMemoryData | null,
    context: WorkingMemoryChatContext
  ): Promise<Partial<WorkingMemoryData>> {
    appLogger.debug('[WorkingMemoryUpdater] Updated for chat');

    return {
      activeIntent: context.activeIntent || 'general_chat',
      activeWorkflow: undefined,
      activeTool: undefined,
      continuationHints: {
        canExport: false,
        canSummarize: true,
        canModify: false,
        canCancel: false
      },
      metadata: {
        ...existing?.metadata,
        lastAccessedAt: Date.now(),
        accessCount: (existing?.metadata?.accessCount || 0) + 1,
        lastChatResponse: context.chatResponse
      }
    };
  }

  // ============================================================
  // Access Only Updates
  // ============================================================

  private async buildAccessUpdates(
    existing: WorkingMemoryData | null
  ): Promise<Partial<WorkingMemoryData>> {
    if (!existing) {
      return {};
    }

    return {
      metadata: {
        ...existing.metadata,
        lastAccessedAt: Date.now(),
        accessCount: (existing.metadata?.accessCount || 0) + 1
      }
    };
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  /**
   * Infer workflow from tool slugs
   */
  private inferWorkflowFromTools(toolSlugs: string[]): string | undefined {
    if (toolSlugs.length === 0) return undefined;

    const firstTool = toolSlugs[0];
    const parts = firstTool.split('_');

    if (parts.length > 1) {
      return parts.slice(0, -1).join('_');
    }

    return firstTool;
  }

  /**
   * Extract entities from params
   */
  private extractEntitiesFromParams(params: Record<string, unknown>): Record<string, unknown> {
    const entities: Record<string, unknown> = {};
    
    if (params.date) entities.date = params.date;
    if (params.dateStart) entities.dateStart = params.dateStart;
    if (params.dateEnd) entities.dateEnd = params.dateEnd;
    if (params.location) entities.location = params.location;

    return entities;
  }

  /**
   * Infer continuation hints from API results
   */
  private inferContinuationHints(apiResults: Record<string, unknown>): Record<string, boolean> {
    const hints: Record<string, boolean> = {
      canExport: false,
      canSummarize: false,
      canModify: false,
      canCancel: false
    };

    const hasDataResult = Object.values(apiResults).some(
      v => v && typeof v === 'object' && !('error' in (v as any))
    );

    if (hasDataResult) {
      hints.canExport = true;
      hints.canSummarize = true;
    }

    hints.canModify = true;
    hints.canCancel = true;

    return hints;
  }
}
