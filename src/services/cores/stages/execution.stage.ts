import type { PlannerOutput, PlannerTask } from '../../../types/planner.types';
import type { PipelineExecutedTaskDetail, PipelineInput, Tool } from '../../../types';
import { executionContext } from '../../../utils/strategies/execution-context';
import { circuitBreaker } from '../../../utils/circuit-breaker.util';
import { toolService } from '../../tools.service';
import { knowledgeHelper } from '../../knowledge-helper.service';
import { toolResultCache } from '../../memories/toolResultCache.service';
import { appLogger } from '../../../utils/logger.util';
import { PipelineValidator } from '../../../utils/pipeline-validator.util';
import { skillsRegistry } from '../../skills-registry.service';
import { normalizeSkillParamsToToolParams } from '../../../utils/resource-param-normalizer.util';

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
    executedTasksDetails?: PipelineExecutedTaskDetail[];
  };
}

export interface DependencyExecutionData {
  byId: Record<string, unknown>;
  byKey: Record<string, unknown>;
  values: unknown[];
  primary?: unknown;
}

// ============================================================
// ExecutionStage
// ============================================================

/**
 * ExecutionStage - Executes planned tasks (tools, skills, knowledge)
 * 
 * Responsibilities:
 * - Execute tools/skills/knowledge
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
      results: results,
      parameters: params
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
        failedTasks: Object.values(results).filter(r => typeof r === 'object' && r !== null && 'error' in (r as Record<string, unknown>)).length,
        executedTasksDetails: plan.tasks.map(task => ({
          key: task.key as string,
          resource: task.resource,
          toolSlug: task.resource === 'tool' ? task.key : undefined
        }))
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
    const resultById: Record<string, unknown> = {};
    const taskById = new Map(tasks.map(task => [task.id, task]));

    // Topological sort for dependency order
    const sortedTasks = this.topologicalSort(tasks);

    for (const task of sortedTasks) {
      const dependencyById: Record<string, unknown> = {};
      const dependencyByKey: Record<string, unknown> = {};
      const dependencyValues: unknown[] = [];
      for (const depId of task.depends_on) {
        if (resultById[depId] !== undefined) {
          const depResult = resultById[depId];
          const depTask = taskById.get(depId);

          dependencyById[depId] = depResult;
          dependencyValues.push(depResult);

          if (depTask?.key) {
            dependencyByKey[depTask.key] = depResult;
          }
        }
      }

      // Dependency outputs are passed through `data`, not merged into params.
      const taskParams = { ...params };

      const dependencyData: DependencyExecutionData | undefined = dependencyValues.length > 0
        ? {
          byId: dependencyById,
          byKey: dependencyByKey,
          values: dependencyValues,
          primary: dependencyValues.length === 1 ? dependencyValues[0] : dependencyValues
        }
        : undefined;

      appLogger.debug('[ExecutionStage] Executing task with params', {
        taskId: task.id,
        taskKey: task.key,
        resource: task.resource,
        baseParamCount: Object.keys(params).length,
        dependencyCount: dependencyValues.length,
        dependencyKeys: Object.keys(dependencyByKey),
        taskParamCount: Object.keys(taskParams).length
      });

      // Execute task - use task.key as the result key for consistency
      const taskResult = await this.executeTask(task, input, taskParams, dependencyData);
      resultById[task.id] = taskResult;
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

    // Group by resource type
    const toolTasks = tasks.filter(t => t.resource === 'tool');
    const skillTasks = tasks.filter(t => t.resource === 'skill');
    const knowledgeTasks = tasks.filter(t => t.resource === 'knowledge');

    // Execute in parallel within each group
    const [toolResults, skillResults, knowledgeResults] = await Promise.all([
      toolTasks.length > 0 ? this.executeToolTasks(toolTasks, input, params) : {},
      skillTasks.length > 0 ? this.executeSkillTasks(skillTasks, input, params) : {},
      knowledgeTasks.length > 0 ? this.executeKnowledgeTasks(knowledgeTasks, input, params) : {}
    ]);

    return { ...toolResults, ...skillResults, ...knowledgeResults };
  }

  // ============================================================
  // Task Execution
  // ============================================================

  private async executeTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Promise<unknown> {
    switch (task.resource) {
      case 'tool':
        return await this.executeToolTask(task, input, params, dependencyData);
      case 'skill':
        return await this.executeSkillTask(task, input, params, dependencyData);
      case 'knowledge':
        return await this.executeKnowledgeTask(task, input, params, dependencyData);
      default:
        throw new Error(`Unknown task resource: ${task.resource}`);
    }
  }

  private async executeToolTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Promise<unknown> {
    // ✅ Validate params against tool requirements
    const validatedParams = await this.validateParamsForTask(task, input, params);

    appLogger.debug('[ExecutionStage] Executing tool with params', {
      toolSlug: task.key,
      inputAttributes: input.attributes,
      inputAttributesParams: input.attributes?.params,  // ✅ Debug log
      validatedParamsCount: Object.keys(validatedParams).length
    });

    const tools = await circuitBreaker.call(
      () => toolService.getToolsBySlugs([task.key])
    );

    if (tools.length === 0) {
      throw new Error(`Tool not found: ${task.key}`);
    }

    const tool = tools[0];

    // Params are already resolved in PipelineCore; execution only validates them.
    appLogger.debug('[ExecutionStage] Validated params', {
      toolSlug: task.key,
      inputAttributes: input.attributes,
      inputAttributesParams: input.attributes?.params,  // ✅ Debug log
      validatedParams: validatedParams
    });

    return await this.executeToolWithTemporalRetry(tool, task.key, input, validatedParams, dependencyData);
  }

  private async executeSkillTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Promise<unknown> {
    const validatedParams = this.validateParamsForSkillTask(task, params, dependencyData);

    appLogger.debug('[ExecutionStage] Executing skill with params', {
      skillSlug: task.key,
      validatedParamsCount: Object.keys(validatedParams).length,
      inputParamCount: Object.keys(params).length,
      hasDependencyData: this.hasDependencyData(dependencyData)
    });

    const skillResults = await circuitBreaker.call(
      () => executionContext.run('skill', [task.key], validatedParams, input, dependencyData)
    );
    return skillResults[task.key] || skillResults;
  }

  private async executeKnowledgeTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Promise<unknown> {
    const knowledge = await circuitBreaker.call(
      () => knowledgeHelper.getKnowledgeBySlugs([task.key])
    );

    if (knowledge.length === 0) {
      throw new Error(`Knowledge not found: ${task.key}`);
    }

    const knowledgeResult = await executionContext.run('knowledge', knowledge, {}, input, dependencyData);
    return knowledgeResult;
  }

  private async executeToolWithTemporalRetry(
    tool: Tool,
    toolSlug: string,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData,
    retryCount = 0
  ): Promise<unknown> {
    const MAX_TEMPORAL_RETRY = 1;
    const result = await this.executeSingleTool(tool, toolSlug, input, params, dependencyData);

    if (retryCount >= MAX_TEMPORAL_RETRY) {
      return result;
    }

    const temporalQuestionType = this.getTemporalQuestionType(input.text);
    if (!temporalQuestionType || !this.isEmptyToolResult(result)) {
      return result;
    }

    const retryParams = this.removeTemporalFilterParams(params);
    if (this.paramsEqual(params, retryParams)) {
      return result;
    }

    appLogger.info('[ExecutionStage] Temporal question empty result, retrying without temporal filters', {
      toolSlug,
      temporalQuestionType,
      retryCount: retryCount + 1,
      maxRetry: MAX_TEMPORAL_RETRY,
      removedFilters: Object.keys(params).filter(key => !(key in retryParams)),
      firstParamKeys: Object.keys(params),
      retryParamKeys: Object.keys(retryParams)
    });

    return await this.executeToolWithTemporalRetry(
      tool,
      toolSlug,
      input,
      retryParams,
      dependencyData,
      retryCount + 1
    );
  }

  private async executeSingleTool(
    tool: Tool,
    toolSlug: string,
    input: PipelineInput,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Promise<unknown> {
    const toolResults = await circuitBreaker.call(
      () => executionContext.run('tool', [tool], params, input, dependencyData)
    );

    return toolResults[toolSlug] || toolResults;
  }

  private getTemporalQuestionType(text: string): 'date' | 'month' | 'year' | null {
    const normalized = text.toLowerCase().replace(/[?.,;:!]+/g, ' ').replace(/\s+/g, ' ').trim();

    if (/\b(tanggal|tgl)\s+berapa\b/.test(normalized) || /\bkapan\b/.test(normalized)) {
      return 'date';
    }

    if (/\bbulan\s+(apa|berapa)\b/.test(normalized)) {
      return 'month';
    }

    if (/\btahun\s+berapa\b/.test(normalized)) {
      return 'year';
    }

    return null;
  }

  private removeTemporalFilterParams(params: Record<string, unknown>): Record<string, unknown> {
    const temporalKeys = new Set([
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun'
    ]);

    return Object.fromEntries(
      Object.entries(params).filter(([key]) => !temporalKeys.has(key))
    );
  }

  private paramsEqual(
    left: Record<string, unknown>,
    right: Record<string, unknown>
  ): boolean {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
  }

  private isEmptyToolResult(result: unknown): boolean {
    if (Array.isArray(result)) {
      return result.length === 0;
    }

    if (!result || typeof result !== 'object') {
      return false;
    }

    const record = result as Record<string, unknown>;
    if ('error' in record) {
      return false;
    }

    for (const key of ['data', 'rows', 'items', 'result', 'results', 'records']) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.length === 0;
      }
    }

    if (record.total === 0 || record.count === 0) {
      return true;
    }

    return false;
  }

  private async executeToolTasks(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      try {
        appLogger.info('ExecutionStage: Executing tool task', {
          taskKey: task.key,
          resource: task.resource,
          parameters: params
        });
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

  private async executeSkillTasks(
    tasks: PlannerTask[],
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const task of tasks) {
      try {
        results[task.key] = await this.executeSkillTask(task, input, params);
      } catch (error) {
        appLogger.error('ExecutionStage: Skill task failed', {
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

    // Create task map for looking up resource types
    const taskMap = new Map(tasks?.map(t => [t.key, t]) || []);

    for (const [taskKey, result] of Object.entries(results)) {
      if (result !== undefined && result !== null && !(typeof result === 'object' && 'error' in result)) {
        // Determine resource type (default to 'tool' for backward compatibility)
        const task = taskMap.get(taskKey);
        const resourceType = task?.resource || 'tool';

        // Cache tools and knowledge WITH PARAMS for entity-specific caching
        if (resourceType === 'tool' || resourceType === 'knowledge') {
          // ✅ Get entities from params (for storage in cache)
          // const entities = this.extractEntitiesFromParams(params);

          await toolResultCache.store(
            sessionKey,
            taskKey,
            'executed_intent',
            result,
            {},       // ✅ Entities extracted from params
            params,         // ✅ Params for entity-specific cache key
            { ttl: 15 * 1000 }
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

  /**
   * Validate params against tool requirements from paramCacheService
   */
  private async validateParamsForTask(
    task: PlannerTask,
    input: PipelineInput,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Only validate tools (not skills/knowledge)
    if (task.resource !== 'tool') {
      return params;
    }

    try {
      // ✅ Get tool definition with required params
      const tools = await toolService.getToolsBySlugs([task.key]);
      const tool = tools.find(t => t.slug === task.key);

      if (!tool) {
        appLogger.warn('[ExecutionStage] Tool not found for validation', {
          toolSlug: task.key
        });
        return params;  // Skip validation if tool not found
      }

      // ✅ Get required params from toolService
      const toolParams = toolService.getToolParams(tool);
      const requiredParams = toolParams.filter(p => p.isRequired);
      const optionalParams = toolParams.filter(p => !p.isRequired);

      appLogger.debug('[ExecutionStage] Validating params for tool', {
        toolSlug: task.key,
        requiredParams: requiredParams.map(p => p.name),
        providedParams: Object.keys(params)
      });

      // ✅ Validate each required param
      const validatedParams: Record<string, unknown> = {};
      const missingParams: string[] = [];

      for (const param of requiredParams) {
        if (PipelineValidator.validateParamValue(param, params[param.name])) {
          validatedParams[param.name] = params[param.name];
        } else if (params.__dateBlind === true && this.isTemporalFilterParam(param.name)) {
          appLogger.debug('[ExecutionStage] Skipping required temporal param because query is date-blind', {
            toolSlug: task.key,
            paramName: param.name,
            temporalQuestionType: params.__temporalQuestionType
          });
        } else {
          missingParams.push(param.name);
        }
      }

      // ✅ Add optional params if provided
      for (const param of optionalParams) {
        if (PipelineValidator.validateParamValue(param, params[param.name])) {
          validatedParams[param.name] = params[param.name];
        }
      }

      // ✅ If missing required params, throw error with details
      if (missingParams.length > 0) {
        const errorMessage = `Missing required parameters for tool ${task.key}: ${missingParams.join(', ')}`;
        appLogger.error('[ExecutionStage] Param validation failed', {
          toolSlug: task.key,
          missingParams,
          providedParams: Object.keys(params)
        });

        throw new Error(errorMessage);
      }

      appLogger.info('[ExecutionStage] Params validated successfully', {
        toolSlug: task.key,
        validatedParamsCount: Object.keys(validatedParams).length
      });

      return validatedParams;

    } catch (error) {
      // Re-throw validation errors
      if (error instanceof Error && error.message.includes('Missing required parameters')) {
        throw error;
      }

      // Log other errors but continue with original params
      appLogger.error('[ExecutionStage] Param validation error', {
        toolSlug: task.key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return params;  // Fallback to original params
    }
  }

  private validateParamsForSkillTask(
    task: PlannerTask,
    params: Record<string, unknown>,
    dependencyData?: DependencyExecutionData
  ): Record<string, unknown> {
    if (task.resource !== 'skill') {
      return params;
    }

    const skill = skillsRegistry.getSkillBySlug(task.key);
    if (!skill) {
      throw new Error(`Skill not found: ${task.key}`);
    }

    const skillParams = normalizeSkillParamsToToolParams(skill.paramSchema || []);
    const requiredParams = skillParams.filter(param => param.isRequired);

    if (requiredParams.length === 0) {
      return params;
    }

    const missingParams = requiredParams
      .filter(param => {
        if (param.name === 'data' && this.hasDependencyData(dependencyData)) {
          return false;
        }

        return !PipelineValidator.validateParamValue(param, params[param.name]);
      })
      .map(param => param.name);

    if (missingParams.length > 0) {
      appLogger.error('[ExecutionStage] Skill param validation failed', {
        skillSlug: task.key,
        missingParams,
        providedParams: Object.keys(params)
      });

      throw new Error(`Missing required parameters for skill ${task.key}: ${missingParams.join(', ')}`);
    }

    appLogger.debug('[ExecutionStage] Skill params validated successfully', {
      skillSlug: task.key,
      requiredParams: requiredParams.map(param => param.name),
      providedParams: Object.keys(params)
    });

    return params;
  }

  private hasDependencyData(dependencyData?: DependencyExecutionData): boolean {
    return !!dependencyData && dependencyData.values.some(value => value !== undefined && value !== null);
  }

  private isTemporalFilterParam(name: string): boolean {
    return [
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun'
    ].includes(name);
  }

}
