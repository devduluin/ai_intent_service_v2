import type { PlannerOutput, PlannerTask } from '../../../types/planner.types';
import type { PipelineInput } from '../../../types';
import { executionContext } from '../../../utils/strategies/execution-context';
import { circuitBreaker } from '../../../utils/circuit-breaker.util';
import { paramExtractorService } from '../../paramExtractor.service';
import { paramHydratorService } from '../../param-hydrator.service';
import { toolService } from '../../tools.service';
import { knowledgeHelper } from '../../knowledge-helper.service';
import { toolResultCache } from '../../memories/toolResultCache.service';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface ExecutionStageOptions {
  cacheResults?: boolean;
  userId?: string;
  appName?: string;
}

export interface ExecutionResult {
  results: Record<string, unknown>;
  metrics: {
    totalTasks: number;
    executedTasks: number;
    failedTasks: number;
  };
}

// ============================================================
// ExecutionStage
// ============================================================

/**
 * ExecutionStage - Executes planned tasks (tools, handlers, knowledge)
 * 
 * Responsibilities:
 * - Execute tools/handlers/knowledge
 * - Handle dependencies between tasks
 * - Cache results
 */
export class ExecutionStage {
  /**
   * Execute a plan
   * 
   * @param plan - PlannerOutput with tasks to execute
   * @param input - Pipeline input
   * @param params - Collected parameters
   * @param options - Optional configuration
   * @returns ExecutionResult with results and metrics
   */
  async execute(
    plan: PlannerOutput,
    input: PipelineInput,
    params: Record<string, unknown>,
    options?: ExecutionStageOptions
  ): Promise<ExecutionResult> {
    const cacheResults = options?.cacheResults ?? true;
    const userId = options?.userId;
    const appName = options?.appName;

    // Validate plan
    if (!plan || !plan.tasks || plan.tasks.length === 0) {
      if (plan.chat) {
        return {
          results: {},
          metrics: { totalTasks: 0, executedTasks: 0, failedTasks: 0 }
        };
      }
      throw new Error('Invalid plan: no tasks provided');
    }

    appLogger.info('ExecutionStage: Executing plan', {
      mode: plan.mode,
      totalTasks: plan.tasks.length,
      hasDependencies: plan.tasks.some(t => t.depends_on.length > 0)
    });

    let results: Record<string, unknown>;

    // Execute based on mode
    if (plan.mode === 'multi_step') {
      results = await this.executeWithDependencies(plan.tasks, input, params);
    } else {
      results = await this.executeParallel(plan.tasks, input, params);
    }

    appLogger.info('ExecutionStage: Plan execution completed', {
      mode: plan.mode,
      totalTasks: plan.tasks.length,
      results: results
    });
    
    // Cache results if enabled
    if (cacheResults && userId && appName && Object.keys(results).length > 0) {
      await this.cacheResults(results, userId, appName, params, plan.tasks);
    }

    return {
      results,
      metrics: {
        totalTasks: plan.tasks.length,
        executedTasks: Object.keys(results).length,
        failedTasks: 0
      }
    };
  }

  // ============================================================
  // Multi-Step Execution (with dependencies)
  // ============================================================

  private async executeWithDependencies(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    // Topological sort for dependency order
    const sortedTasks = this.topologicalSort(tasks);

    for (const task of sortedTasks) {
      // Wait for dependencies
      const dependencyResults: Record<string, unknown> = {};
      for (const depId of task.depends_on) {
        if (results[depId]) {
          dependencyResults[depId] = results[depId];
        }
      }

      // Execute task - use task.key as the result key for consistency
      const taskResult = await this.executeTask(task, input, dependencyResults);
      results[task.key] = taskResult;
    }

    return results;
  }

  // ============================================================
  // Parallel Execution (no dependencies)
  // ============================================================

  private async executeParallel(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    // Group by resource type
    const toolTasks = tasks.filter(t => t.resource === 'tool');
    const handlerTasks = tasks.filter(t => t.resource === 'handler');
    const knowledgeTasks = tasks.filter(t => t.resource === 'knowledge');

    // Execute in parallel within each group
    const [toolResults, handlerResults, knowledgeResults] = await Promise.all([
      toolTasks.length > 0 ? this.executeToolTasks(toolTasks, input, params) : {},
      handlerTasks.length > 0 ? this.executeHandlerTasks(handlerTasks, input, params) : {},
      knowledgeTasks.length > 0 ? this.executeKnowledgeTasks(knowledgeTasks, input, params) : {}
    ]);

    return { ...toolResults, ...handlerResults, ...knowledgeResults };
  }

  // ============================================================
  // Task Execution
  // ============================================================

  private async executeTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (task.resource) {
      case 'tool':
        return await this.executeToolTask(task, input, params);
      case 'handler':
        return await this.executeHandlerTask(task, input, params);
      case 'knowledge':
        return await this.executeKnowledgeTask(task, input, params);
      default:
        throw new Error(`Unknown task resource: ${task.resource}`);
    }
  }

  private async executeToolTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const tools = await circuitBreaker.call(
      () => toolService.getToolsBySlugs([task.key])
    );

    if (tools.length === 0) {
      throw new Error(`Tool not found: ${task.key}`);
    }

    const tool = tools[0];
    const toolParams = toolService.getToolParams(tool);

    // Extract params for this tool
    const extractionResult = await paramExtractorService.extractAll(
      input.text,
      toolParams
    );

    // Merge params
    const mergedParams = paramHydratorService.hydrate(
      { ...params, ...extractionResult.params },
      input.attributes ?? {}
    );

    // Check for missing required params
    const missingParams = toolService.getMissingParamsFromTool(tool, mergedParams);
    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters for tool ${task.key}: ${missingParams.join(', ')}`);
    }

    // Execute tool
    const toolResults = await circuitBreaker.call(
      () => executionContext.run('tool', [tool], mergedParams, input)
    );

    return toolResults[task.key] || toolResults;
  }

  private async executeHandlerTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const handlerResults = await circuitBreaker.call(
      () => executionContext.run('handler', [task.key], params, input)
    );
    return handlerResults[task.key] || handlerResults;
  }

  private async executeKnowledgeTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const knowledge = await circuitBreaker.call(
      () => knowledgeHelper.getKnowledgeBySlugs([task.key])
    );

    if (knowledge.length === 0) {
      throw new Error(`Knowledge not found: ${task.key}`);
    }

    const knowledgeResult = await executionContext.run('knowledge', knowledge, {}, input);
    return knowledgeResult;
  }

  private async executeToolTasks(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      try {
        results[task.key] = await this.executeToolTask(task, input, params);
      } catch (error) {
        appLogger.error('ExecutionStage: Tool task failed', {
          task: task.key,
          error: error instanceof Error ? error.message : error
        });
        results[task.key] = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    return results;
  }

  private async executeHandlerTasks(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      try {
        results[task.key] = await this.executeHandlerTask(task, input, params);
      } catch (error) {
        appLogger.error('ExecutionStage: Handler task failed', {
          task: task.key,
          error: error instanceof Error ? error.message : error
        });
        results[task.key] = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    return results;
  }

  private async executeKnowledgeTasks(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      try {
        results[task.key] = await this.executeKnowledgeTask(task, input, params);
      } catch (error) {
        appLogger.error('ExecutionStage: Knowledge task failed', {
          task: task.key,
          error: error instanceof Error ? error.message : error
        });
        results[task.key] = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    return results;
  }

  // ============================================================
  // Utilities
  // ============================================================

  private topologicalSort(tasks: PlannerTask[]): PlannerTask[] {
    const sorted: PlannerTask[] = [];
    const visited = new Set<string>();

    const visit = (task: PlannerTask) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);

      // Visit dependencies first
      for (const depId of task.depends_on) {
        const depTask = tasks.find(t => t.id === depId);
        if (depTask) {
          visit(depTask);
        }
      }

      sorted.push(task);
    };

    for (const task of tasks) {
      visit(task);
    }

    return sorted;
  }

  private async cacheResults(
    results: Record<string, unknown>,
    userId: string,
    appName: string,
    params: Record<string, unknown>,
    tasks?: PlannerTask[]
  ): Promise<void> {
    const sessionKey = `${userId}:${appName}`;
    const entities = this.extractEntitiesFromParams(params);

    // Create task map for looking up resource types
    const taskMap = new Map(tasks?.map(t => [t.key, t]) || []);

    for (const [taskKey, result] of Object.entries(results)) {
      if (result !== undefined && result !== null && !(typeof result === 'object' && 'error' in result)) {
        // Determine resource type (default to 'tool' for backward compatibility)
        const task = taskMap.get(taskKey);
        const resourceType = task?.resource || 'tool';

        // Cache tools and knowledge
        if (resourceType === 'tool' || resourceType === 'knowledge') {
          await toolResultCache.store(
            sessionKey,
            taskKey,
            'executed_intent',
            result,
            entities,
            { ttl: 30 * 60 * 1000 }
          ).catch((error: Error) => {
            appLogger.warn('ExecutionStage: Failed to cache result', {
              taskKey,
              resourceType,
              sessionKey,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          });
        }
      }
    }
  }

  private extractEntitiesFromParams(params: Record<string, unknown>): Record<string, unknown> {
    const entities: Record<string, unknown> = {};

    // Extract common entity patterns
    if (params.date) entities.date = params.date;
    if (params.dateStart) entities.dateStart = params.dateStart;
    if (params.dateEnd) entities.dateEnd = params.dateEnd;
    if (params.location) entities.location = params.location;

    return entities;
  }
}
