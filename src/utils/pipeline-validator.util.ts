// utils/pipeline-validator.util.ts
import type { ToolParam } from '../types';
import type { Agent } from '../types/agent.types';

export class PipelineValidator {
  /**
   * Validate agent existence and status
   */
  static validateAgent(agent: Agent | null, slug: string): void {
    if (!agent) {
      throw new Error(`Agent '${slug}' tidak ditemukan`);
    }
    if (!agent.isActive) {
      throw new Error(`Agent '${agent.name}' sedang tidak aktif`);
    }
  }

  /**
   * Get missing parameters from a list of tool parameters
   * @param toolParams - Array of tool parameters to check
   * @param collectedParams - Already collected parameter values
   * @returns Array of missing required parameter names
   */
  static getMissingParamsFromTools(
    toolParams: ToolParam[],
    collectedParams: Record<string, any>
  ): string[] {
    if (!toolParams || toolParams.length === 0) {
      return [];
    }

    return toolParams
      .filter(p => p.isRequired && !collectedParams[p.name])
      .map(p => p.name);
  }

  /**
   * Check if user is answering a parameter question or starting a new query
   */
  static isUserAnsweringParameter(text: string): boolean {
    const t = text.toLowerCase().trim();

    // Very short messages are likely answers
    if (t.length <= 20) {
      return true;
    }

    // Pure numbers are likely answers
    if (/^\d+$/.test(t)) {
      return true;
    }

    // Simple yes/no answers
    if (/^(ya|tidak|gak|nggak|iya|yes|no)$/i.test(t)) {
      return true;
    }

    // Single word answers (likely a city, name, etc.)
    if (t.split(' ').length === 1 && t.length < 30) {
      return true;
    }

    // Check if this looks like a new question
    const questionIndicators = [
      'apa', 'bagaimana', 'kenapa', 'siapa', 'tolong', 'bisa', 'help',
      'what', 'how', 'why', 'who', 'please', 'can you'
    ];

    if (questionIndicators.some(q => t.startsWith(q))) {
      return false;
    }

    // Default: assume it's an answer
    return true;
  }

  /**
   * Validate if a value matches the expected parameter type
   */
  static validateParamValue(param: ToolParam, value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    switch (param.type) {
      case 'string':
        return typeof value === 'string' && value.trim().length > 0;

      case 'number':
        const num = Number(value);
        return !isNaN(num);

      case 'boolean':
        return typeof value === 'boolean' ||
               ['true', 'false', '1', '0', 'yes', 'no'].includes(String(value).toLowerCase());

      default:
        return true;
    }
  }

  /**
   * Validate that all required parameters for a list of tools are present
   */
  static validateRequiredParamsForTools(
    tools: Array<{ parameters?: ToolParam[] }>,
    collectedParams: Record<string, any>
  ): { isValid: boolean; missingParams: string[] } {
    const allParams: ToolParam[] = [];

    for (const tool of tools) {
      if (tool.parameters && Array.isArray(tool.parameters)) {
        allParams.push(...tool.parameters);
      }
    }

    const missing = this.getMissingParamsFromTools(allParams, collectedParams);

    return {
      isValid: missing.length === 0,
      missingParams: missing
    };
  }

  /**
   * Validate pipeline input structure
   */
  static validatePipelineInput(input: {
    user_id: string;
    app_name: string;
    text: string;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!input.user_id || input.user_id.trim().length === 0) {
      errors.push('user_id is required');
    }

    if (!input.app_name || input.app_name.trim().length === 0) {
      errors.push('app_name is required');
    }

    if (!input.text || input.text.trim().length === 0) {
      errors.push('text is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if planner output is valid and safe to execute
   */
  static validatePlannerOutput(plan: {
    handlers?: string[];
    tools?: string[];
    knowledge?: string[];
    chat?: boolean;
  }): { valid: boolean; reason?: string } {
    if (!plan) {
      return { valid: false, reason: 'Planner output is null/undefined' };
    }

    const hasHandlers = plan.handlers && plan.handlers.length > 0;
    const hasTools = plan.tools && plan.tools.length > 0;
    const hasKnowledge = plan.knowledge && plan.knowledge.length > 0;
    const isChat = plan.chat === true;

    // Chat should not have other execution types
    if (isChat && (hasHandlers || hasTools || hasKnowledge)) {
      return {
        valid: false,
        reason: 'Invalid state: chat=true but has handlers/tools/knowledge'
      };
    }

    // At least one execution type should be present
    if (!isChat && !hasHandlers && !hasTools && !hasKnowledge) {
      return {
        valid: false,
        reason: 'Invalid state: no execution type specified'
      };
    }

    return { valid: true };
  }
}
