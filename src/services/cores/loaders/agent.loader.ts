import { agentRepository } from '../../../repositories/agent.repository';
import { appLogger } from '../../../utils/logger.util';
import type { Agent } from '../../../types/agent.types';

// ============================================================
// AgentLoader
// ============================================================

/**
 * AgentLoader - Handles agent loading and validation
 * 
 * Responsibilities:
 * - Fetch agent from repository by slug
 * - Validate agent exists
 * - Validate agent is active
 * - Throw descriptive errors on failure
 */
export class AgentLoader {
  /**
   * Load agent by slug with validation
   * 
   * @param slug - Agent slug/identifier
   * @returns Validated Agent object
   * @throws Error if agent not found or inactive
   */
  async loadBySlug(slug: string): Promise<Agent> {
    try {
      const agent = await agentRepository.findBySlug(slug);

      if (!agent) {
        throw new Error(`Agent '${slug}' not found`);
      }

      if (!agent.isActive) {
        throw new Error(`Agent '${agent.name}' is not active`);
      }

      appLogger.debug('[AgentLoader] Agent loaded successfully', {
        slug,
        agentId: agent.id,
        agentName: agent.name,
        isActive: agent.isActive
      });

      return agent;

    } catch (error) {
      if (error instanceof Error && (error.message.includes('not found') || error.message.includes('not active'))) {
        throw error;
      }

      appLogger.error('[AgentLoader] Failed to load agent', {
        slug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new Error(`Failed to load agent '${slug}': ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
