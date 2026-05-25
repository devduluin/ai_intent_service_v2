import type { PlannerOutput } from '../../../types/planner.types';
import type { ConfidenceDecision } from '../../confidence-decision.service';
import type { UserMessageSignals } from '../../query-decomposition.service';

/**
 * ValidationResult - Result of plan validation
 */
export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  errors?: string[];
}

/**
 * PlanValidator - Validates planner output and execution decisions
 * 
 * Responsible for:
 * - Checking if plan has valid tasks
 * - Detecting planner failures (e.g., realtime request but no tasks)
 * - Determining if fallback to chat is needed
 */
export class PlanValidator {
  /**
   * Validate planner output structure and content
   */
  validate(plan: PlannerOutput): ValidationResult {
    if (!plan) {
      return {
        isValid: false,
        reason: 'Planner output is null/undefined',
        errors: ['Plan is missing']
      };
    }

    const errors: string[] = [];

    // Check for valid mode
    if (!plan.mode || !['single_step', 'multi_step'].includes(plan.mode)) {
      errors.push(`Invalid mode: ${plan.mode}`);
    }

    // Check tasks array exists
    if (!Array.isArray(plan.tasks)) {
      errors.push('Tasks must be an array');
    }

    // Chat-only plan is valid
    if (plan.chat === true) {
      if (plan.tasks && plan.tasks.length > 0) {
        errors.push('Invalid state: chat=true but has tasks');
      }
      return {
        isValid: errors.length === 0,
        reason: errors.length > 0 ? errors.join('; ') : 'Valid chat-only plan',
        errors: errors.length > 0 ? errors : undefined
      };
    }

    // Non-chat plan must have tasks
    if (!plan.tasks || plan.tasks.length === 0) {
      errors.push('Invalid state: no tasks and chat=false');
    }

    // Validate task structure
    if (plan.tasks && plan.tasks.length > 0) {
      plan.tasks.forEach((task, index) => {
        if (!task.resource || !['handler', 'tool', 'knowledge'].includes(task.resource)) {
          errors.push(`Task ${index}: invalid resource type`);
        }
        if (!task.key) {
          errors.push(`Task ${index}: missing key`);
        }
        if (!Array.isArray(task.depends_on)) {
          errors.push(`Task ${index}: depends_on must be an array`);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      reason: errors.length > 0 ? errors.join('; ') : 'Valid plan',
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Check if should fallback to pure chat mode
   * 
   * Fallback conditions:
   * - Decision action is 'chat'
   * - Plan is chat-only (chat=true) with no tasks
   */
  shouldFallbackToChat(plan: PlannerOutput, decision: ConfidenceDecision): boolean {
    // Explicit chat decision from confidence engine
    if (decision.action === 'chat') {
      return true;
    }

    // Plan indicates chat-only mode
    if (plan.chat === true && (!plan.tasks || plan.tasks.length === 0)) {
      return true;
    }

    return false;
  }

  /**
   * Detect if planner failed to generate tasks for a realtime/data request
   * 
   * This happens when:
   * - User asks for realtime data (signals.asksForRealtimeData = true)
   * - But planner returned chat=true or empty tasks
   */
  detectPlannerFailure(plan: PlannerOutput, signals: UserMessageSignals): boolean {
    // User asked for realtime data
    if (signals.asksForRealtimeData) {
      // But planner returned chat mode
      if (plan.chat === true || (!plan.tasks || plan.tasks.length === 0)) {
        return true;
      }
    }

    // User asked for file generation
    if (signals.asksForFile) {
      if (plan.chat === true || (!plan.tasks || plan.tasks.length === 0)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate plan has required execution resources
   */
  hasExecutionResources(plan: PlannerOutput): boolean {
    if (!plan.tasks || plan.tasks.length === 0) {
      return plan.chat === true;
    }

    return plan.tasks.some(t => 
      t.resource === 'handler' || 
      t.resource === 'tool' || 
      t.resource === 'knowledge'
    );
  }

  /**
   * Check if plan is safe to execute
   */
  isSafeToExecute(plan: PlannerOutput, decision: ConfidenceDecision): boolean {
    // Not safe if should fallback to chat
    if (this.shouldFallbackToChat(plan, decision)) {
      return false;
    }

    // Not safe if plan is invalid
    const validation = this.validate(plan);
    if (!validation.isValid) {
      return false;
    }

    // Not safe if no execution resources
    if (!this.hasExecutionResources(plan)) {
      return false;
    }

    return true;
  }
}
